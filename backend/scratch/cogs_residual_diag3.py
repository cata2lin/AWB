import sys, asyncio, sqlite3, json
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

MONTH="2026-04"
PR=r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
PA=r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/product_analytics.db"

# 1) How widespread is empty line_items across the whole orders table? by store
async def main():
    async with AsyncSessionLocal() as db:
        # empty line_items by store, delivered only
        rows=(await db.execute(text("""
            SELECT s.name, 
                   SUM(CASE WHEN (o.line_items IS NULL OR jsonb_array_length(to_jsonb(o.line_items)) = 0) THEN 1 ELSE 0 END) AS empty_li,
                   COUNT(*) AS total
            FROM orders o JOIN stores s ON s.uid=o.store_uid
            WHERE o.aggregated_status='delivered'
              AND o.frisbo_created_at >= '2026-03-31 21:00:00' AND o.frisbo_created_at <= '2026-04-30 20:59:59'
            GROUP BY s.name ORDER BY empty_li DESC
        """))).all()
    print("=== Empty line_items by store (delivered, Apr 2026) ===")
    for name,empty,total in rows:
        if empty and empty>0:
            print(f"   {name:<30} empty={empty:>5} / {total:>6}  ({empty/total*100:.1f}%)")

    # 2) the 'fata-masa-rotunda' conflict: AWB sku_costs value vs Scripturi
    async with AsyncSessionLocal() as db:
        sk=(await db.execute(text("SELECT sku, cost FROM sku_costs WHERE sku ILIKE 'fata-masa-rotunda'"))).all()
        # is there a product row? exclude flag?
        pr=(await db.execute(text("SELECT sku, exclude_from_stock FROM products WHERE sku ILIKE 'fata-masa-rotunda'"))).all()
        # look at one OFER14752 line items
        oli=(await db.execute(text("SELECT order_number, line_items FROM orders WHERE order_number IN ('OFER14752','OFER14792','OFER14979')"))).all()
    print("\n=== fata-masa-rotunda ===")
    print("AWB sku_costs rows:", sk)
    print("AWB products rows (sku, exclude):", pr)
    for onum,li in oli:
        print(f"   {onum}: ", json.dumps(li)[:300])

    # 3) Scripturi cost for fata-masa-rotunda & GRAND skus
    con=sqlite3.connect(PA); cur=con.cursor()
    fmr=cur.execute("SELECT sku, prefix, cost, currency, title FROM analytics_products WHERE sku LIKE '%fata-masa-rotunda%'").fetchall()
    print("\nScripturi analytics_products fata-masa-rotunda:", fmr)
    gd=cur.execute("SELECT sku, prefix, cost, currency, title FROM analytics_products WHERE sku IN ('GD-IL-6658','GD-IL-6659','GD-IL-INT-11141','GD-IL-INT-6656','GD-MOB-1938930','2324003')").fetchall()
    print("\nScripturi analytics_products GRAND skus:")
    for r in gd: print("   ",r)
    con.close()
    # profit_cogs_override?
    con=sqlite3.connect(PR); cur=con.cursor()
    tbls=[r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print("\nProfitability tables:", tbls)
    if 'profit_cogs_override' in tbls:
        ov=cur.execute("SELECT * FROM profit_cogs_override WHERE sku LIKE '%fata-masa%' OR sku LIKE 'GD-%'").fetchall()
        cols=[d[0] for d in cur.description]
        print("override cols:",cols)
        print("overrides:", ov[:20])
    con.close()

    # 4) AWB sku_costs for GRAND skus
    async with AsyncSessionLocal() as db:
        gd_awb=(await db.execute(text("SELECT sku, cost FROM sku_costs WHERE sku IN ('GD-IL-6658','GD-IL-6659','GD-IL-INT-11141','GD-IL-INT-6656','GD-MOB-1938930','2324003')"))).all()
        gd_excl=(await db.execute(text("SELECT sku, exclude_from_stock FROM products WHERE sku IN ('GD-IL-6658','GD-IL-6659','GD-IL-INT-11141','GD-IL-INT-6656','GD-MOB-1938930','2324003')"))).all()
        g7873=(await db.execute(text("SELECT order_number, line_items FROM orders WHERE order_number IN ('GRAND7873','GRAND8887')"))).all()
    print("\n=== GRAND skus AWB ===")
    print("sku_costs:", gd_awb)
    print("products exclude:", gd_excl)
    for onum,li in g7873:
        print(f"   {onum}:")
        if isinstance(li,list):
            for it in li:
                inv=it.get("inventory_item") or {}
                print(f"      sku={inv.get('sku')} qty={it.get('quantity')} title={inv.get('title_1')}")

asyncio.run(main())
print("DONE")
