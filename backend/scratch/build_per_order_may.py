"""
Build the per-order MAY-2026 comparison dataset: AWB orders vs Scripturi profit_orders.

Month window = Bucharest-local May (exactly Scripturi's _parse_month_range semantics):
  2026-05-01 00:00 EEST = 2026-04-30 21:00 UTC  ..  2026-06-01 00:00 EEST = 2026-05-31 21:00 UTC.
AWB frisbo_created_at is naive UTC, so we filter on those UTC bounds — removing the
UTC-vs-local boundary noise the earlier comparison had.

Output: c:/tmp/per_order_may.csv with both sides' status + revenue + COGS per order.

Run: cd backend && ./venv/Scripts/python.exe -u scratch/build_per_order_may.py
"""

import sys
import csv
import sqlite3
import asyncio
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.status_classification import classify  # noqa: E402

SC_DB = r"c:/tmp/scr_new2/Scripturi/data/profitability.db"
OUT = r"c:/tmp/per_order_may.csv"
UTC_FROM = datetime(2026, 4, 30, 21, 0, 0)
UTC_TO = datetime(2026, 5, 31, 21, 0, 0)


async def awb_orders():
    sql = text(
        """
        SELECT o.order_number, o.aggregated_status, o.total_price, o.currency,
               o.tracking_number IS NOT NULL AS has_awb,
               COALESCE(SUM(COALESCE(sc.cost,0) * COALESCE((e->>'quantity')::numeric,1))
                        FILTER (WHERE e->'inventory_item'->>'sku' IS NOT NULL), 0) AS cogs
        FROM orders o
        LEFT JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(o.line_items::jsonb)='array' THEN o.line_items::jsonb ELSE '[]'::jsonb END
        ) e ON true
        LEFT JOIN sku_costs sc ON sc.sku = (e->'inventory_item'->>'sku')
        WHERE o.frisbo_created_at >= :f AND o.frisbo_created_at < :t
        GROUP BY o.order_number, o.aggregated_status, o.total_price, o.currency, o.tracking_number
        """
    )
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(sql, {"f": UTC_FROM, "t": UTC_TO})).all()
    return {
        r.order_number: {
            "status": r.aggregated_status or "",
            "cat": classify(r.aggregated_status or ""),
            "rev": round(float(r.total_price or 0), 2),
            "cur": r.currency or "RON",
            "has_awb": bool(r.has_awb),
            "cogs": round(float(r.cogs or 0), 2),
        }
        for r in rows
    }


def sc_orders():
    con = sqlite3.connect(SC_DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT order_name, prefix, status_category, revenue, currency, cogs, awb, "
        "fulfillment_status, payment_status FROM profit_orders WHERE month='2026-05'"
    ).fetchall()
    con.close()
    return {
        r["order_name"]: {
            "prefix": r["prefix"],
            "cat": r["status_category"] or "",
            "rev": round(float(r["revenue"] or 0), 2),
            "cur": r["currency"] or "RON",
            "cogs": round(float(r["cogs"] or 0), 2),
            "has_awb": bool((r["awb"] or "").strip()),
            "fstat": r["fulfillment_status"] or "",
        }
        for r in rows
    }


async def main():
    awb = await awb_orders()
    sc = sc_orders()
    print(f"AWB orders in Bucharest-May window : {len(awb):,}")
    print(f"SC  profit_orders month=2026-05    : {len(sc):,}")

    all_on = sorted(set(awb) | set(sc))
    with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "order_number",
                "in_awb",
                "in_sc",
                "awb_status",
                "awb_cat",
                "sc_cat",
                "awb_rev",
                "sc_rev",
                "awb_cogs",
                "sc_cogs",
                "awb_currency",
                "sc_currency",
                "awb_has_awb",
                "sc_has_awb",
                "sc_prefix",
                "sc_fulfillment",
            ]
        )
        for on in all_on:
            a, s = awb.get(on), sc.get(on)
            w.writerow(
                [
                    on,
                    1 if a else 0,
                    1 if s else 0,
                    a["status"] if a else "",
                    a["cat"] if a else "",
                    s["cat"] if s else "",
                    a["rev"] if a else "",
                    s["rev"] if s else "",
                    a["cogs"] if a else "",
                    s["cogs"] if s else "",
                    a["cur"] if a else "",
                    s["cur"] if s else "",
                    (1 if a["has_awb"] else 0) if a else "",
                    (1 if s["has_awb"] else 0) if s else "",
                    s["prefix"] if s else "",
                    s["fstat"] if s else "",
                ]
            )
    print(f"WROTE {OUT}  ({len(all_on):,} rows)")

    # quick headline
    both = set(awb) & set(sc)
    print(
        f"  in both: {len(both):,} | only AWB: {len(set(awb) - set(sc)):,} | only SC: {len(set(sc) - set(awb)):,}"
    )


if __name__ == "__main__":
    asyncio.run(main())
    print("DONE")
