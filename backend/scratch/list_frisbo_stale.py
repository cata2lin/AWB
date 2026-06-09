"""
List every order with a STALE status in Frisbo.

Definition (authoritative, independent of AWB's reconciliation state):
  Frisbo's LIVE store-view status is non-terminal (fulfilled / waiting_for_courier / …)
  BUT the courier feed (via Scripturi's `profit_orders.status_category`) has already
  SETTLED the order (Livrata→delivered / Refuzata→returned / Anulata→cancelled).

Those are the orders where Frisbo is "lying" — it froze the status and never reflected
the real outcome. AWB mirrors Frisbo, which is why they go stale.

Re-uses the aggressive parallel fetch from fast_full_sync (all orgs in parallel, pooled
connections, concurrent pagination, no rate limiter). Writes a CSV and prints a summary.

Run:
  cd backend && ./venv/Scripts/python.exe -u scratch/list_frisbo_stale.py [--concurrency 20] [--out PATH]
"""

import sys
import csv
import time
import asyncio
import argparse
import logging
import sqlite3
from datetime import datetime, timezone
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.services.frisbo.parser import parse_order  # noqa: E402
from app.core.status_classification import classify  # noqa: E402

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("app.services.frisbo.client").setLevel(logging.WARNING)

PAGE = 100
TERMINAL = {"delivered", "returned", "cancelled"}
PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
# Scripturi courier status_category (RO) -> the real terminal outcome
SC_TERMINAL = {"Livrata": "delivered", "Refuzata": "returned", "Anulata": "cancelled"}
DEFAULT_OUT = r"c:/Users/Admin/Desktop/AWB Print/frisbo_stale_orders.csv"


def _orders(resp):
    if not isinstance(resp, dict):
        return []
    data = resp.get("data", {})
    if isinstance(data, dict):
        return data.get("orders", []) or []
    if isinstance(data, list):
        return data
    return []


async def fetch_org(org, concurrency):
    """All orders for one org's stores — pooled client, concurrent block pagination."""
    name = org.get("name", "org")
    headers = {
        "Authorization": f"Bearer {org['token']}",
        "Content-Type": "application/json",
    }
    limits = httpx.Limits(
        max_connections=concurrency + 5, max_keepalive_connections=concurrency + 5
    )
    collected = []
    async with httpx.AsyncClient(
        base_url=settings.frisbo_api_url, headers=headers, timeout=60.0, limits=limits
    ) as client:

        async def page(skip):
            try:
                r = await client.get(
                    "/orders/search", params={"skip": skip, "limit": PAGE}
                )
                return _orders(r.json()) if r.status_code == 200 else []
            except Exception:
                return []

        skip = 0
        while True:
            skips = [skip + i * PAGE for i in range(concurrency)]
            batches = await asyncio.gather(*[page(s) for s in skips])
            for b in batches:
                collected.extend(b)
            if any(len(b) < PAGE for b in batches):
                break
            skip += concurrency * PAGE
    print(f"  [{name}] {len(collected):,} orders", flush=True)
    return name, collected


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    orgs = [o for o in settings.get_org_tokens() if o.get("token")]
    print(f"=== LIST FRISBO-STALE ORDERS ===  {len(orgs)} orgs in parallel\n")

    t0 = time.time()
    results = await asyncio.gather(*[fetch_org(o, args.concurrency) for o in orgs])

    # Frisbo's live status per order_number (last write wins; orders are unique anyway).
    frisbo = {}
    for _name, raw in results:
        for ro in raw:
            if not isinstance(ro, dict):
                continue
            try:
                p = parse_order(ro)
            except Exception:
                continue
            on = p.get("order_number")
            if on:
                frisbo[on] = p.get("aggregated_status")
    print(
        f"Fetched {len(frisbo):,} unique orders from Frisbo in {time.time() - t0:.1f}s\n",
        flush=True,
    )

    # Courier truth from Scripturi (only the terminal outcomes).
    con = sqlite3.connect(PR)
    sc = {
        n: SC_TERMINAL[c]
        for n, c in con.execute("SELECT order_name, status_category FROM profit_orders")
        if c in SC_TERMINAL
    }
    con.close()
    print(f"Scripturi courier-settled orders available: {len(sc):,}", flush=True)

    # STALE = Frisbo live non-terminal AND courier already settled it.
    stale = {}  # order_number -> (frisbo_status, courier_truth)
    for on, fstat in frisbo.items():
        if not fstat or classify(fstat) in TERMINAL:
            continue
        truth = sc.get(on)
        if truth:
            stale[on] = (fstat, truth)
    print(
        f"Frisbo-STALE orders (Frisbo non-terminal, courier settled): {len(stale):,}\n",
        flush=True,
    )

    # Enrich from AWB (store, date, revenue, current AWB status, tracking).
    ons = list(stale.keys())
    awb = {}
    async with AsyncSessionLocal() as db:
        for i in range(0, len(ons), 5000):
            rows = (
                await db.execute(
                    text(
                        """
                SELECT o.order_number, COALESCE(s.name, o.store_uid) AS store,
                       o.aggregated_status, o.frisbo_created_at, o.total_price,
                       o.currency, o.tracking_number
                FROM orders o
                LEFT JOIN stores s ON s.uid = o.store_uid
                WHERE o.order_number = ANY(:o)
                """
                    ),
                    {"o": ons[i : i + 5000]},
                )
            ).all()
            for r in rows:
                awb[r[0]] = r

    now = datetime.now(timezone.utc)
    out_rows = []
    for on, (fstat, truth) in stale.items():
        a = awb.get(on)
        store = a[1] if a else ""
        awb_status = a[2] if a else "(not in AWB)"
        created = a[3] if a else None
        age = (
            (now - created.replace(tzinfo=timezone.utc)).days
            if created is not None
            else ""
        )
        out_rows.append(
            {
                "order_number": on,
                "store": store,
                "frisbo_status_STALE": fstat,
                "courier_truth": truth,
                "awb_status": awb_status,
                "reconciled_in_awb": "yes"
                if classify(awb_status) in TERMINAL
                else "no",
                "order_date": created.date().isoformat() if created else "",
                "age_days": age,
                "revenue": round(float(a[4]), 2) if a and a[4] is not None else "",
                "currency": (a[5] if a else "") or "",
                "tracking_number": (a[6] if a else "") or "",
            }
        )

    # Newest-first, then by store.
    out_rows.sort(
        key=lambda r: (
            r["store"],
            -(r["age_days"] if isinstance(r["age_days"], int) else 0),
        )
    )

    with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(
            f,
            fieldnames=list(out_rows[0].keys())
            if out_rows
            else [
                "order_number",
                "store",
                "frisbo_status_STALE",
                "courier_truth",
                "awb_status",
                "reconciled_in_awb",
                "order_date",
                "age_days",
                "revenue",
                "currency",
                "tracking_number",
            ],
        )
        w.writeheader()
        w.writerows(out_rows)

    # ── Summary ──
    by_truth = Counter(r["courier_truth"] for r in out_rows)
    by_store = Counter(r["store"] for r in out_rows)
    recon = Counter(r["reconciled_in_awb"] for r in out_rows)
    rev = sum(r["revenue"] for r in out_rows if isinstance(r["revenue"], (int, float)))
    print("=" * 64)
    print(f"WROTE {len(out_rows):,} Frisbo-stale orders -> {args.out}")
    print("=" * 64)
    print(f"By real (courier) outcome : {dict(by_truth)}")
    print(
        f"Already reconciled in AWB : {dict(recon)}  (yes = AWB already holds the truth)"
    )
    print(f"Total revenue on stale    : {rev:,.0f} RON")
    print("\nTop stores by stale count:")
    for store, n in by_store.most_common(12):
        print(f"  {store:<28} {n:,}")


if __name__ == "__main__":
    asyncio.run(main())
    print("\nDONE")
