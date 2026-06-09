import sys, asyncio, sqlite3, json
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

MONTH = "2026-04"
PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"

SC_CAT = {"Livrata":"delivered","Refuzata":"returned","Anulata":"cancelled","In curs":"in_transit",
          "In tranzit":"in_transit","Netrimisa":"other","Lipsa awb":"other","Probleme livrare":"problems","":"other"}

def load_scripturi(month):
    con = sqlite3.connect(PR); cur = con.cursor()
    rows = cur.execute("SELECT order_name, cogs, status_category, skus FROM profit_orders WHERE month=?", (month,)).fetchall()
    con.close()
    d={}
    for name,cogs,cat,skus in rows:
        d[name]={"cogs":cogs or 0,"cat":SC_CAT.get(cat,"other"),"skus":skus or ""}
    return d

async def main():
    sc = load_scripturi(MONTH)
    async with AsyncSessionLocal() as db:
        names = list(sc.keys())
        rows = (await db.execute(text("""
            SELECT order_number, aggregated_status, line_items, item_count, awb_count, synced_at
            FROM orders WHERE order_number = ANY(:names)
        """), {"names": names})).all()
    awb={}
    for onum, agg, li, ic, awbc, syncedat in rows:
        awb[onum]={"cat":classify(agg),"li":li,"ic":ic,"awbc":awbc,"synced":syncedat}

    # Among the 237 AWB=0 SC>0 delivered, count empty line_items
    empty_li=0; null_li=0; nonempty=0
    empty_examples=[]
    for n,a in awb.items():
        s=sc.get(n)
        if not s: continue
        if a["cat"]=="delivered" and s["cat"]=="delivered" and s["cogs"]>0:
            li=a["li"]
            # recompute awb cogs would be 0? only count those truly zero — check via skus presence
            # Just categorize line_items shape
            if li is None:
                # would be zero
                pass
            # We only care about the zero-cogs ones; reuse earlier: empty -> zero
    # Simpler: directly count line_items emptiness for the COV-type orders
    # Recompute full zero set
    sku_costs_all = {}
    excl=set()
    async with AsyncSessionLocal() as db:
        sku_costs_all = {r[0]: float(r[1] or 0) for r in (await db.execute(text("SELECT sku, cost FROM sku_costs"))).all()}
        excl = {r[0] for r in (await db.execute(text("SELECT sku FROM products WHERE exclude_from_stock = true AND sku IS NOT NULL"))).all()}
    sku_costs=dict(sku_costs_all)
    for e in excl: sku_costs.pop(e,None)

    zero=[]
    for n,a in awb.items():
        s=sc.get(n)
        if not s: continue
        if a["cat"]=="delivered" and s["cat"]=="delivered" and s["cogs"]>0:
            cogs=0.0; nitems=0; li=a["li"]
            if isinstance(li,list):
                nitems=len(li)
                for it in li:
                    if isinstance(it,dict):
                        inv=it.get("inventory_item") or {}
                        sku=inv.get("sku") if isinstance(inv,dict) else None
                        if sku and sku in sku_costs:
                            cogs+=sku_costs[sku]*int(it.get("quantity") or 1)
            if cogs==0:
                shape = "NULL" if li is None else ("EMPTY_LIST" if (isinstance(li,list) and len(li)==0) else "HAS_ITEMS")
                zero.append((n,shape,a["ic"],a["awbc"],nitems,str(a["synced"])[:19]))
    cnt=Counter(z[1] for z in zero)
    print(f"=== {len(zero)} zero-cogs delivered orders, line_items shape ===")
    for k,v in cnt.items():
        print(f"   {k}: {v}")
    print("\n-- samples per shape --")
    for shape in ["NULL","EMPTY_LIST","HAS_ITEMS"]:
        ex=[z for z in zero if z[1]==shape][:6]
        print(f"  {shape}:")
        for z in ex:
            print(f"     {z[0]} item_count={z[2]} awb_count={z[3]} n_li={z[4]} synced={z[5]}")

    # Now look at the actual line_items JSON for a couple of EMPTY/NULL ones to confirm
    print("\n-- raw line_items for 5 NULL/EMPTY zero orders --")
    sample_names=[z[0] for z in zero if z[1] in ("NULL","EMPTY_LIST")][:5]
    async with AsyncSessionLocal() as db:
        rr=(await db.execute(text("SELECT order_number, item_count, line_items, tracking_number, frisbo_created_at, aggregated_status FROM orders WHERE order_number = ANY(:n)"),{"n":sample_names})).all()
    for onum,ic,li,trk,fca,agg in rr:
        print(f"   {onum} ic={ic} status={agg} li={json.dumps(li)[:120] if li is not None else 'None'}")

asyncio.run(main())
print("DONE")
