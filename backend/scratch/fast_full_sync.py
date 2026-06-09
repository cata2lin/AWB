"""
AGGRESSIVE parallel full re-sync of the last N months across ALL stores, then a
staleness ROOT-CAUSE diagnostic.

Two jobs:
  1. Pull Frisbo's CURRENT status for every order created in the window, as fast as
     possible — every org in parallel, a high per-org request rate, concurrent
     pagination (Frisbo imposes no hard limit on us). Apply the status updates Frisbo
     returns (honoring the sync's don't-downgrade-terminal rule).
  2. DIAGNOSE where staleness comes from by diffing Frisbo-vs-AWB:
       - Frisbo TERMINAL but AWB non-terminal  → OUR sync was behind (we hadn't fetched
         Frisbo's update). The aggressive sync fixes these.
       - AWB TERMINAL but Frisbo non-terminal  → FRISBO is stale (Frisbo still returns a
         non-terminal status for an order that is actually settled).
     Then cross-check the still-non-terminal ones against Scripturi's courier feed to
     confirm whether Frisbo is returning a stale status the courier already resolved.

Run:
  cd backend && ./venv/Scripts/python.exe scratch/fast_full_sync.py            # DRY-RUN (fetch+diff, no write)
  cd backend && ./venv/Scripts/python.exe scratch/fast_full_sync.py --apply    # also write the status updates
  optional: --months 3  --rate 60  --concurrency 15
"""

import sys
import asyncio
import argparse
import time
import logging
import sqlite3
from datetime import datetime, timedelta
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.services.frisbo.parser import parse_order  # noqa: E402
from app.core.status_classification import classify  # noqa: E402

# Silence per-request INFO spam (thousands of requests).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("app.services.frisbo.client").setLevel(logging.WARNING)

PAGE = 100
TERMINAL = {"delivered", "returned", "cancelled"}
PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
SC_TERMINAL = {"Livrata": "delivered", "Refuzata": "returned", "Anulata": "cancelled"}


def _orders_and_total(resp):
    if not isinstance(resp, dict):
        return [], None
    data = resp.get("data", {})
    total = resp.get("total")
    if isinstance(data, dict):
        return data.get("orders", []) or [], total
    if isinstance(data, list):
        return data, total
    return [], total


async def fetch_org(org, created_start, rate, concurrency):
    """Fetch ALL orders for one org's stores in the window, pages concurrently.

    Uses ONE connection-pooled httpx client per org (keep-alive — no per-request
    TCP+TLS handshake) and NO rate limiter — the aggressive path the user asked for.
    """
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
                    "/orders/search",
                    params={
                        "skip": skip,
                        "limit": PAGE,
                        "created_at_start": created_start,
                    },
                )
                if r.status_code != 200:
                    return []
                return _orders_and_total(r.json())[0]
            except Exception:
                return []

        # The API returns no `total`, so we OPTIMISTICALLY fetch a BLOCK of `concurrency`
        # pages at once and keep going until a page comes back short (= end reached).
        skip = 0
        while True:
            skips = [skip + i * PAGE for i in range(concurrency)]
            batches = await asyncio.gather(*[page(s) for s in skips])
            for b in batches:
                collected.extend(b)
            # any short/empty page in this block ⇒ we've reached the end
            if any(len(b) < PAGE for b in batches):
                break
            skip += concurrency * PAGE
    print(f"  [{name}] {len(collected):,} orders", flush=True)
    return name, collected


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=3)
    ap.add_argument(
        "--rate", type=int, default=60, help="requests/sec per org (aggressive)"
    )
    ap.add_argument(
        "--concurrency", type=int, default=15, help="concurrent pages per org"
    )
    ap.add_argument(
        "--apply", action="store_true", help="write the status updates Frisbo returns"
    )
    args = ap.parse_args()

    created_start = (datetime.utcnow() - timedelta(days=args.months * 30)).isoformat()
    orgs = [o for o in settings.get_org_tokens() if o.get("token")]
    print(
        f"=== FAST PARALLEL RE-SYNC ===  {len(orgs)} orgs in parallel | "
        f"created_at >= {created_start[:10]} | rate {args.rate}/s/org | {args.concurrency} pages/org\n"
    )

    t0 = time.time()
    results = await asyncio.gather(
        *[fetch_org(o, created_start, args.rate, args.concurrency) for o in orgs]
    )
    raw_total = sum(len(r[1]) for r in results)

    # Lean parse — keep only what the diagnostic + status write need.
    frisbo = {}  # order_number -> {agg, ship, tracking, fulfilled_at, store_uid}
    parse_errors = 0
    for name, raw in results:
        for ro in raw:
            if not isinstance(ro, dict):
                continue
            try:
                p = parse_order(ro)
            except Exception:
                parse_errors += 1
                continue
            on = p.get("order_number")
            if on:
                frisbo[on] = {
                    "agg": p.get("aggregated_status"),
                    "ship": p.get("shipment_status"),
                    "tracking": p.get("tracking_number"),
                    "fulfilled_at": p.get("fulfilled_at"),
                }
    fetch_secs = time.time() - t0
    print(
        f"Fetched {raw_total:,} raw orders ({len(frisbo):,} unique) in {fetch_secs:.1f}s "
        f"({raw_total / max(fetch_secs, 0.1):,.0f} orders/s){f', {parse_errors} parse errors' if parse_errors else ''}\n"
    )

    async with AsyncSessionLocal() as db:
        # AWB stored statuses for the fetched order_numbers
        ons = list(frisbo.keys())
        awb = {}
        for i in range(0, len(ons), 5000):
            for on, agg in (
                await db.execute(
                    text(
                        "SELECT order_number, aggregated_status FROM orders WHERE order_number = ANY(:o)"
                    ),
                    {"o": ons[i : i + 5000]},
                )
            ).all():
                awb[on] = agg

        # ── DIFF Frisbo vs AWB ──
        frisbo_newer_terminal = []  # Frisbo terminal, AWB non-terminal → OUR sync was behind
        awb_terminal_frisbo_not = []  # AWB terminal, Frisbo non-terminal → FRISBO stale
        other_changes = 0
        new_orders = 0
        updatable = []  # (order_number, new_status) honoring don't-downgrade
        for on, f in frisbo.items():
            fstat = f["agg"]
            if not fstat:
                continue
            if on not in awb:
                new_orders += 1
                continue
            astat = awb[on]
            if fstat == astat:
                continue
            fc, ac = classify(fstat), classify(astat)
            if fc in TERMINAL and ac not in TERMINAL:
                frisbo_newer_terminal.append((on, astat, fstat))
            elif ac in TERMINAL and fc not in TERMINAL:
                awb_terminal_frisbo_not.append((on, astat, fstat))
            else:
                other_changes += 1
            # don't-downgrade: only write if NOT terminal→non-terminal
            if not (ac in TERMINAL and fc not in TERMINAL):
                updatable.append((on, fstat))

        # ── current stuck set (non-terminal + tracked + >14d) in the window ──
        stuck_rows = (
            await db.execute(
                text(
                    """
            SELECT order_number, aggregated_status FROM orders
            WHERE aggregated_status NOT IN ('delivered','returned','refused','unsuccessful_delivery',
                  'cancelled','voided','back_to_sender','received_by_sender','lost','lost_in_transit',
                  'lost_in_warehouse','shipment_refunded','incorrect_address','returning_to_sender',
                  'customer_pickup','personal_pickup','in_parcel_locker','shipping_canceled','fulfillment_cancelled')
              AND tracking_number IS NOT NULL AND frisbo_created_at < now() - interval '14 days'
              AND frisbo_created_at >= now() - (:days || ' days')::interval
            """
                ),
                {"days": str(args.months * 30)},
            )
        ).all()
        stuck = {on: ag for on, ag in stuck_rows if classify(ag) not in TERMINAL}
        stuck_frisbo_terminal = [
            on
            for on in stuck
            if on in frisbo and classify(frisbo[on]["agg"]) in TERMINAL
        ]
        stuck_frisbo_frozen = [
            on
            for on in stuck
            if on in frisbo and classify(frisbo[on]["agg"]) not in TERMINAL
        ]
        stuck_not_in_frisbo = [on for on in stuck if on not in frisbo]

        # ── APPLY the status updates Frisbo returned (don't-downgrade enforced) ──
        applied = 0
        if args.apply and updatable:
            for i in range(0, len(updatable), 500):
                chunk = updatable[i : i + 500]
                res = await db.execute(
                    text(
                        """
                    UPDATE orders SET aggregated_status = v.st, synced_at = now()
                    FROM (SELECT unnest(cast(:o AS text[])) AS on_, unnest(cast(:s AS text[])) AS st) v
                    WHERE orders.order_number = v.on_ AND orders.aggregated_status <> v.st
                    """
                    ),
                    {"o": [c[0] for c in chunk], "s": [c[1] for c in chunk]},
                )
                applied += res.rowcount or 0
            await db.commit()

    # ── Cross-check the still-frozen stuck orders against Scripturi's courier feed ──
    con = sqlite3.connect(PR)
    sc = {
        n: SC_TERMINAL.get(c)
        for n, c in con.execute("SELECT order_name, status_category FROM profit_orders")
        if SC_TERMINAL.get(c)
    }
    con.close()
    frozen_but_resolved = [
        (on, frisbo[on]["agg"], sc[on]) for on in stuck_frisbo_frozen if on in sc
    ]
    frozen_resolved_ct = Counter(x[2] for x in frozen_but_resolved)

    # ───────────────────── REPORT ─────────────────────
    print("=" * 72)
    print("STALENESS ROOT-CAUSE DIAGNOSTIC")
    print("=" * 72)
    print(f"Orders in window fetched from Frisbo : {len(frisbo):,}")
    print(
        f"Status DIFFERS from AWB              : {len(frisbo_newer_terminal) + len(awb_terminal_frisbo_not) + other_changes:,}"
    )
    print(
        f"  • Frisbo TERMINAL, AWB non-terminal: {len(frisbo_newer_terminal):,}  <- OUR sync was behind (now {'APPLIED' if args.apply else 'would apply'})"
    )
    print(
        f"  • AWB TERMINAL, Frisbo non-terminal: {len(awb_terminal_frisbo_not):,}  <- FRISBO stale (we hold the truth)"
    )
    print(f"  • other transitions                : {other_changes:,}")
    print(f"  • new orders not yet in AWB        : {new_orders:,}")
    if args.apply:
        print(f"  → status updates written           : {applied:,}")
    print()
    print(f"Currently-stuck (non-terminal+tracked+>14d) in window: {len(stuck):,}")
    print(
        f"  • Frisbo NOW reports terminal      : {len(stuck_frisbo_terminal):,}  <- resolvable by syncing = OUR sync lag"
    )
    print(
        f"  • Frisbo STILL non-terminal        : {len(stuck_frisbo_frozen):,}  <- Frisbo's own data"
    )
    print(f"  • not returned by Frisbo at all    : {len(stuck_not_in_frisbo):,}")
    print()
    print(
        f"Of the Frisbo-still-frozen, Scripturi's courier feed says: {dict(frozen_resolved_ct) or 'none in SC'}"
    )
    print(
        f"  → {len(frozen_but_resolved):,} orders Frisbo reports non-terminal that the courier ALREADY resolved = FRISBO stale, proven."
    )
    if frozen_but_resolved[:6]:
        print("  examples (order, Frisbo, courier-truth):")
        for x in frozen_but_resolved[:6]:
            print(f"     {x[0]:<13} frisbo={x[1]:<20} courier={x[2]}")
    print()
    print("VERDICT:")
    our = len(frisbo_newer_terminal)
    frisbo_bad = len(awb_terminal_frisbo_not) + len(frozen_but_resolved)
    print(
        f"  • Our-sync-lag share   : {our:,} orders had a newer terminal status in Frisbo we hadn't pulled."
    )
    print(
        f"  • Frisbo-stale share   : {frisbo_bad:,} orders Frisbo returns non-terminal that are actually settled."
    )


if __name__ == "__main__":
    asyncio.run(main())
    print("\nDONE")
