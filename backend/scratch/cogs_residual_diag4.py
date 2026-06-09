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

def sc_order_detail(names):
    con=sqlite3.connect(PR); cur=con.cursor()
    q="SELECT order_name, cogs, cogs_missing, cogs_missing_skus, skus FROM profit_orders WHERE order_name IN (%s)" % ",".join("?"*len(names))
    rows=cur.execute(q, names).fetchall()
    con.close()
    return {r[0]:{"cogs":r[1],"cmiss":r[2],"cmskus":r[3],"skus":r[4]} for r in rows}

async def main():
    # GRAND7873: AWB cogs 693.24 = 81.62*2 + 113.95*2 + 50.35*6 = 163.24+227.9+302.1=693.24
    # SC 979.44. Difference 286.20. What's in SC.skus that AWB missed?
    g=sc_order_detail(['GRAND7873','GRAND8887'])
    print("=== GRAND7873 / GRAND8887 Scripturi detail ===")
    for n,d in g.items():
        print(f"  {n}: cogs={d['cogs']} cmiss={d['cmiss']} missing_skus={d['cmskus']!r}")
        print(f"     SC skus field: {d['skus']!r}")

    # AWB GD-IL-INT-11141 was in the SKU diff string but not in GRAND7873 line items. Check
    # GD-IL-6658 81.62*2=163.24 ; GD-IL-6659 113.95*2=227.9 ; GD-IL-INT-6656 50.35*6=302.1 => 693.24 matches AWB
    # SC 979.44 - 693.24 = 286.20. Maybe SC counts GD-IL-INT-11141 47.7 * ? Let's see: 286.20/47.7 = 6.0 exactly!
    print("\n  286.20 / 47.70 (GD-IL-INT-11141) =", 286.20/47.70)

    # So Scripturi order has GD-IL-INT-11141 x6 that AWB line_items don't have. Confirm AWB line items count.
    async with AsyncSessionLocal() as db:
        li=(await db.execute(text("SELECT order_number, item_count, line_items FROM orders WHERE order_number='GRAND7873'"))).all()
    for onum,ic,lis in li:
        print(f"\n  AWB {onum} item_count={ic}, distinct line skus:")
        skus=[(it.get('inventory_item',{}).get('sku'), it.get('quantity')) for it in lis]
        print("    ", skus)

    # fata-masa-rotunda cross-store: how many OFER orders use 33.0 (AWB) vs 11.58 (SC)?
    # AWB applies single global 33.0. Quantify the total monthly COGS error from this one SKU across OFER.
    con=sqlite3.connect(PA); cur=con.cursor()
    rows=cur.execute("SELECT sku, prefix, cost FROM analytics_products WHERE cost IS NOT NULL").fetchall()
    con.close()
    by_sku=defaultdict(dict)
    for sku,prefix,cost in rows:
        by_sku[sku][prefix]=cost
    # SKUs with multiple DISTINCT costs across prefixes (cross-store conflict)
    conflict=[(sku, d) for sku,d in by_sku.items() if len(set(round(v,2) for v in d.values()))>1]
    print(f"\n=== Cross-store cost conflicts in Scripturi: {len(conflict)} SKUs have >1 distinct cost across prefixes ===")
    # For each, AWB has ONE value. Show top 15 by spread
    def spread(d): 
        vals=[v for v in d.values()]; return max(vals)-min(vals)
    conflict.sort(key=lambda x: spread(x[1]), reverse=True)
    for sku,d in conflict[:15]:
        print(f"   {sku:<28} {dict(sorted(d.items()))}")

    # Now: which of these conflict SKUs actually appear in Apr orders and how much COGS swing?
    # Get AWB cost for the conflict skus
    skus_list=[s for s,_ in conflict]
    async with AsyncSessionLocal() as db:
        awb_costs={r[0]:float(r[1] or 0) for r in (await db.execute(text("SELECT sku, cost FROM sku_costs WHERE sku = ANY(:s)"),{"s":skus_list})).all()}
    # For each conflict sku where AWB cost != the prefix-specific SC cost, that's an error source.
    mism=0; examples=[]
    for sku,d in conflict:
        ac=awb_costs.get(sku)
        if ac is None: continue
        for prefix,sccost in d.items():
            if abs(round(ac,2)-round(sccost,2))>0.01:
                mism+=1
    print(f"\n   (sku,prefix) pairs where AWB single-cost != SC prefix-cost: {mism}")
    # show fata-masa specifically
    print(f"   fata-masa-rotunda: AWB={awb_costs.get('fata-masa-rotunda')} SC-by-prefix={dict(by_sku.get('fata-masa-rotunda',{}))}")

asyncio.run(main())
print("DONE")
