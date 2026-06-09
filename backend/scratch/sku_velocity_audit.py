import sys, asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify
from datetime import datetime

# April 2026 Bucharest-local bounds in naive UTC (UTC+3 summer): 03-31 21:00 .. 04-30 20:59:59
LO = datetime(2026, 3, 31, 21, 0, 0)
HI = datetime(2026, 4, 30, 20, 59, 59)

TARGET = [
    "set-5-lavete-magice",
    "set-10-lavete-sarma",
    "manusa-magica",
    "oglinda",
    "71",
    "2",
    "73",
    "38",
    "4",
    "33",
    "7",
    "35",
    "91",
    "30",
    "55",
]


async def main():
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT order_number, store_uid, currency, aggregated_status, line_items
            FROM orders
            WHERE frisbo_created_at >= :lo AND frisbo_created_at <= :hi
        """),
                {"lo": LO, "hi": HI},
            )
        ).all()
    # aggregate by raw sku
    from collections import defaultdict

    agg = defaultdict(
        lambda: {
            "deliv_q": 0.0,
            "deliv_rev_native": 0.0,
            "gross_q": 0.0,
            "gross_rev_native": 0.0,
            "deliv_orders": set(),
            "gross_orders": set(),
            "all_q": 0.0,
            "currencies": set(),
        }
    )
    n_orders = 0
    for onum, suid, cur_, agg_status, li in rows:
        n_orders += 1
        cat = classify(agg_status)
        if not isinstance(li, list):
            continue
        for it in li:
            if not isinstance(it, dict):
                continue
            inv = it.get("inventory_item") or {}
            sku = inv.get("sku") if isinstance(inv, dict) else None
            if not sku:
                continue
            q = float(it.get("quantity") or 1)
            p = float(it.get("price") or 0)
            a = agg[sku]
            a["currencies"].add((cur_ or "RON").upper())
            a["all_q"] += q
            if cat != "cancelled":
                a["gross_q"] += q
                a["gross_rev_native"] += p * q
                a["gross_orders"].add(onum)
            if cat == "delivered":
                a["deliv_q"] += q
                a["deliv_rev_native"] += p * q
                a["deliv_orders"].add(onum)
    print(f"AWB April orders scanned: {n_orders}")
    print(
        f"{'SKU':<26}{'dlv_q':>7}{'dlv_rev':>11}{'dlv_ord':>8}{'grs_q':>7}{'grs_rev':>11}{'grs_ord':>8}  cur"
    )
    for sku in TARGET:
        a = agg.get(sku)
        if not a:
            print(f"{sku:<26}  --- NOT FOUND in AWB line_items ---")
            continue
        print(
            f"{sku:<26}{a['deliv_q']:>7.0f}{a['deliv_rev_native']:>11.0f}{len(a['deliv_orders']):>8}"
            f"{a['gross_q']:>7.0f}{a['gross_rev_native']:>11.0f}{len(a['gross_orders']):>8}  {','.join(sorted(a['currencies']))}"
        )


asyncio.run(main())
print("DONE")
