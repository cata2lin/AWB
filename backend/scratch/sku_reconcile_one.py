import sys, asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify
from datetime import datetime
from collections import Counter, defaultdict

LO = datetime(2026, 3, 31, 21, 0, 0)
HI = datetime(2026, 4, 30, 20, 59, 59)
SKU = "manusa-magica"  # single-currency RON, single-store -> cleanest


async def main():
    async with AsyncSessionLocal() as db:
        store = {
            r[0]: r[1]
            for r in (await db.execute(text("SELECT uid,name FROM stores"))).all()
        }
        rows = (
            await db.execute(
                text("""
            SELECT order_number, store_uid, currency, aggregated_status,
                   financial_status, fulfillment_status, line_items
            FROM orders
            WHERE frisbo_created_at >= :lo AND frisbo_created_at <= :hi
        """),
                {"lo": LO, "hi": HI},
            )
        ).all()
    # AWB: by financial_status, how many manusa-magica units
    fin_units = Counter()
    fin_orders = Counter()
    cat_units = Counter()
    storeset = Counter()
    total_q = 0
    for onum, suid, cur_, agg_status, fin, ful, li in rows:
        if not isinstance(li, list):
            continue
        q_here = 0
        for it in li:
            if not isinstance(it, dict):
                continue
            inv = it.get("inventory_item") or {}
            sku = inv.get("sku") if isinstance(inv, dict) else None
            if sku != SKU:
                continue
            q_here += float(it.get("quantity") or 1)
        if q_here:
            fin_units[(fin or "").upper()] += q_here
            fin_orders[(fin or "").upper()] += 1
            cat_units[classify(agg_status)] += q_here
            storeset[store.get(suid, suid)] += q_here
            total_q += q_here
    print(f"AWB {SKU}: total units (all statuses) = {total_q:.0f}")
    print("  by financial_status (units / orders):")
    for k, v in fin_units.most_common():
        print(f"    {k or '(none)':<20} {v:>8.0f}  / {fin_orders[k]} orders")
    print("  by aggregated category (units):")
    for k, v in cat_units.most_common():
        print(f"    {k:<14} {v:>8.0f}")
    print("  by store (units):")
    for k, v in storeset.most_common():
        print(f"    {k:<26} {v:>8.0f}")


asyncio.run(main())
print("DONE")
