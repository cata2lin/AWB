import sys, asyncio, sqlite3, json
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
PR=r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
PA=r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/product_analytics.db"

async def main():
    # NUBRA sku '156' '163' '29' AWB=27 (9*3) SC=23.85 (7.95*3). Confirm AWB cost vs SC NUB cost
    con=sqlite3.connect(PA); cur=con.cursor()
    for sku in ['156','163','29','14','100','79','35']:
        rows=cur.execute("SELECT prefix, cost FROM analytics_products WHERE sku=? ", (sku,)).fetchall()
        print(f"  SC analytics_products sku={sku}: {rows}")
    con.close()
    async with AsyncSessionLocal() as db:
        awb=(await db.execute(text("SELECT sku, cost FROM sku_costs WHERE sku IN ('156','163','29','14','100','79','35')"))).all()
    print("  AWB sku_costs:", awb)

    # NUB store: cost should be 7.95 but AWB uses 9.0 (the EST value). cross-store collapse again.
    # surpriza-EST 41 vs surpriza-EST 84 line-item swap: stale line items vs SC. Check one.
    async with AsyncSessionLocal() as db:
        r=(await db.execute(text("SELECT order_number, line_items, synced_at FROM orders WHERE order_number='EST143315'"))).all()
    for onum,li,sy in r:
        skus=[(it.get('inventory_item',{}).get('sku'), it.get('quantity')) for it in li]
        print(f"\n  AWB {onum} synced={sy} line skus: {skus}")
    # is surpriza-EST 41 excluded but surpriza-EST 84 costed? check exclusion + cost
    async with AsyncSessionLocal() as db:
        ex=(await db.execute(text("SELECT sku, exclude_from_stock FROM products WHERE sku LIKE 'surpriza-EST%'"))).all()
        c=(await db.execute(text("SELECT sku, cost FROM sku_costs WHERE sku LIKE 'surpriza-EST%'"))).all()
    print("  surpriza-EST products exclude:", ex[:8])
    print("  surpriza-EST sku_costs:", c[:8])

    # Quantify cross-store conflict total $ impact for NUB prefix in April (the 9 vs 7.95 pattern)
    # Count NUBRA delivered orders and total delta
    con=sqlite3.connect(PR); cur=con.cursor()
    nub=cur.execute("SELECT COUNT(*), SUM(cogs) FROM profit_orders WHERE month='2026-04' AND prefix='NUB' AND status_category='Livrata'").fetchall()
    print("\n  SC NUB delivered count, total cogs:", nub)
    con.close()

    # confirm: do the SC analytics costs for EST numeric skus = 9.0 and NUB = 7.95 systematically?
    # This means AWB collapsed to EST's 9.0 for shared numeric skus. Count distinct shared numeric skus
    con=sqlite3.connect(PA); cur=con.cursor()
    rows=cur.execute("SELECT sku, prefix, cost FROM analytics_products WHERE prefix IN ('EST','NUB')").fetchall()
    con.close()
    byp=defaultdict(dict)
    for sku,prefix,cost in rows: byp[sku][prefix]=cost
    shared=[(s,d) for s,d in byp.items() if 'EST' in d and 'NUB' in d and round(d['EST'],2)!=round(d['NUB'],2)]
    print(f"\n  SKUs shared EST+NUB with DIFFERENT cost: {len(shared)} (sample: {shared[:5]})")

asyncio.run(main())
print("DONE")
