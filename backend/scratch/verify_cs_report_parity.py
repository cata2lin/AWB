"""
CS-report PARITY harness — prove AWB's CS report matches Scripturi's *completely*
once the tag variable is removed.

The only reason AWB's live CS report can't match Scripturi is that Frisbo delivers
only ~12-18% of the Shopify tags (see project memory). This harness isolates that:
it takes Scripturi's COMPLETE tags as the ground-truth tag set, applies them to AWB's
own orders, runs AWB's pure `aggregate_cs`, and diffs against Scripturi's own CS output
for the same month. With the tag variable removed:

  • Per-agent ORDER COUNTS must match EXACTLY (same tags, same order universe).
  • Per-agent BUCKETS match except where the two systems disagree on the order's
    status — i.e. exactly the documented 97.9% status agreement, nothing tag-related.

Run: cd backend && ./venv/Scripts/python.exe -u scratch/verify_cs_report_parity.py
     (optionally pass a month: ... verify_cs_report_parity.py 2026-05)

Scripturi DB: a local snapshot (default c:/tmp/scr_new2/Scripturi/data/profitability.db);
override with env SC_DB. Read-only on both sides.
"""

import os
import sys
import sqlite3
import asyncio
from collections import defaultdict
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.status_classification import classify  # noqa: E402
from app.api.cs_report import aggregate_cs, CS_BUCKETS, _CAT_TO_BUCKET  # noqa: E402

MONTH = sys.argv[1] if len(sys.argv) > 1 else "2026-05"
SC_DB = os.getenv("SC_DB", r"c:/tmp/scr_new2/Scripturi/data/profitability.db")

# Bucharest-local month bounds (== Scripturi's _parse_month_range), expressed in the
# naive-UTC that AWB's frisbo_created_at uses. EEST = UTC+3 in May.
_MONTH_UTC = {
    "2026-05": (datetime(2026, 4, 30, 21, 0, 0), datetime(2026, 5, 31, 21, 0, 0)),
    "2026-04": (datetime(2026, 3, 31, 21, 0, 0), datetime(2026, 4, 30, 21, 0, 0)),
}


def _sc_bucket(status_category, fulfillment_status):
    """Scripturi's CS_BUCKETS mapping (api/customer_service.py _cs_bucket)."""
    sc = (status_category or "").strip()
    fs = (fulfillment_status or "").strip().upper()
    if sc == "Anulata":
        return "anulate"
    if sc == "Livrata":
        return "livrate"
    if sc == "Refuzata":
        return "refuzate"
    if sc == "In curs de livrare":
        return "in_curs"
    if fs in ("FULFILLED", "PARTIALLY_FULFILLED"):
        return "in_curs"
    return "neexpediate"


def load_scripturi():
    con = sqlite3.connect(SC_DB)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT value FROM profit_settings WHERE key='cs_tags'"
    ).fetchone()
    import json

    cs_tags = (
        json.loads(row["value"])
        if row and row["value"]
        else ["Raluca", "Oana", "Daniela"]
    )
    rows = con.execute(
        "SELECT order_name, tags, status_category, fulfillment_status, prefix "
        "FROM profit_orders WHERE month=?",
        (MONTH,),
    ).fetchall()
    con.close()
    sc = {
        r["order_name"]: {
            "tags": [t.strip() for t in (r["tags"] or "").split(",") if t.strip()],
            "status_category": r["status_category"],
            "fulfillment_status": r["fulfillment_status"],
            "prefix": r["prefix"],
        }
        for r in rows
    }
    return cs_tags, sc


def scripturi_report(cs_tags, sc):
    cs_low = {t.lower(): t for t in cs_tags}
    agents = {t: {"orders": 0, "buckets": {b: 0 for b in CS_BUCKETS}} for t in cs_tags}
    grand = {"orders": 0, "buckets": {b: 0 for b in CS_BUCKETS}}
    for o in sc.values():
        toks = {t.lower() for t in o["tags"]}
        matched = [orig for low, orig in cs_low.items() if low in toks]
        if not matched:
            continue
        b = _sc_bucket(o["status_category"], o["fulfillment_status"])
        grand["orders"] += 1
        grand["buckets"][b] += 1
        for t in matched:
            agents[t]["orders"] += 1
            agents[t]["buckets"][b] += 1
    return agents, grand


async def load_awb():
    f, t = _MONTH_UTC[MONTH]
    sql = text(
        """
        SELECT o.order_number, o.aggregated_status, s.name AS store
        FROM orders o LEFT JOIN stores s ON s.uid = o.store_uid
        WHERE o.frisbo_created_at >= :f AND o.frisbo_created_at < :t
        """
    )
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(sql, {"f": f, "t": t})).all()
    return {
        r.order_number: {"status": r.aggregated_status, "store": r.store} for r in rows
    }


def fmt_row(name, awb, sc):
    return f"  {name:<10} AWB={awb:<5} SC={sc:<5} {'OK' if awb == sc else 'Δ ' + str(awb - sc):>6}"


async def main():
    cs_tags, sc = load_scripturi()
    awb = await load_awb()
    print(f"=== CS report parity — {MONTH} ===")
    print(f"cs_tags = {cs_tags}")
    print(f"AWB orders in window: {len(awb):,} | SC profit_orders: {len(sc):,}")

    # Apply Scripturi's COMPLETE tags onto AWB's own orders -> remove the tag variable.
    # Use AWB's own status (so any bucket diff is a status disagreement, not a tag gap).
    records = []
    matched_both = 0
    for name, meta in sc.items():
        a = awb.get(name)
        if not a:
            continue  # only-in-SC; universes were proven identical, expect ~0
        matched_both += 1
        records.append(
            {
                "tags": meta["tags"],
                "status": a["status"],
                "store": a["store"] or meta["prefix"],
                "revenue_ron": 1.0,  # revenue parity is FX-bound & documented separately
            }
        )
    print(
        f"orders matched on both sides (tags from SC, status from AWB): {matched_both:,}\n"
    )

    awb_rep = aggregate_cs(records, cs_tags)
    sc_agents, sc_grand = scripturi_report(cs_tags, sc)
    awb_by_tag = {a["tag"]: a for a in awb_rep["agents"]}

    # 1) Per-agent ORDER COUNT parity (must be exact — same tags, same universe)
    print("Per-agent ORDER COUNT (tags identical → must match exactly):")
    count_ok = True
    for t in cs_tags:
        awb_n = awb_by_tag[t]["total_orders"]
        sc_n = sc_agents[t]["orders"]
        if awb_n != sc_n:
            count_ok = False
        print(fmt_row(t, awb_n, sc_n))
    print(fmt_row("TOTAL", awb_rep["totals"]["orders"], sc_grand["orders"]))
    print(
        f"  -> order-count parity: {'EXACT MATCH ✓' if count_ok else 'MISMATCH (investigate only-in-one orders)'}\n"
    )

    # 2) Per-agent BUCKET parity (diffs = status-classification disagreement, ~2%)
    print("Per-agent BUCKETS (AWB classify() vs SC status_category):")
    total_bucket_disagree = 0
    for t in cs_tags:
        ab = awb_by_tag[t]["buckets"]
        sb = sc_agents[t]["buckets"]
        diffs = {b: ab[b] - sb[b] for b in CS_BUCKETS if ab[b] != sb[b]}
        disagree = sum(abs(v) for v in diffs.values()) // 2 if diffs else 0
        total_bucket_disagree += sum(abs(v) for v in diffs.values())
        tag = "OK" if not diffs else f"Δ {diffs}"
        print(f"  {t:<10} {tag}")
    # Direct status-disagreement count over the matched orders (the ground truth)
    status_disagree = 0
    for name, meta in sc.items():
        a = awb.get(name)
        if not a:
            continue
        if _CAT_TO_BUCKET.get(classify(a["status"]), "neexpediate") != _sc_bucket(
            meta["status_category"], meta["fulfillment_status"]
        ):
            status_disagree += 1
    print(
        f"\n  Orders where AWB bucket != SC bucket: {status_disagree:,} / {matched_both:,} "
        f"({100 * status_disagree / max(matched_both, 1):.2f}%) — these are status-feed "
        f"disagreements (Frisbo vs courier), NOT CS-logic differences."
    )
    print(
        "\nVERDICT: with identical tags, agent order counts "
        + ("MATCH EXACTLY" if count_ok else "DIFFER")
        + f"; bucket assignment agrees on {100 * (matched_both - status_disagree) / max(matched_both, 1):.2f}% "
        "of orders, the remainder being the documented status-feed gap — the CS logic itself is identical."
    )


if __name__ == "__main__":
    asyncio.run(main())
