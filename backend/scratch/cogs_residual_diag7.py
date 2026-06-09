import sys, asyncio, sqlite3, json
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify
PR=r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
SC_CAT={"Livrata":"delivered","Refuzata":"returned","Anulata":"cancelled","In curs":"in_transit","In tranzit":"in_transit","Netrimisa":"other","Lipsa awb":"other","Probleme livrare":"problems","":"other"}

def load_sc(m):
    con=sqlite3.connect(PR); cur=con.cursor()
    rows=cur.execute("SELECT order_name, cogs, status_category, skus FROM profit_orders WHERE month=?", (m,)).fetchall()
    con.close()
    return {r[0]:{"cogs":r[1] or 0,"cat":SC_CAT.get(r[2],"other"),"skus":r[3] or ""} for r in rows}

async def analyze(m):
    sc=load_sc(m)
    async with AsyncSessionLocal() as db:
        sku_costs_all={r[0]:float(r[1] or 0) for r in (await db.execute(text("SELECT sku, cost FROM sku_costs"))).all()}
        excl={r[0] for r in (await db.execute(text("SELECT sku FROM products WHERE exclude_from_stock=true AND sku IS NOT NULL"))).all()}
        sku_costs=dict(sku_costs_all)
        for e in excl: sku_costs.pop(e,None)
        rows=(await db.execute(text("SELECT order_number, aggregated_status, line_items FROM orders WHERE order_number = ANY(:n)"),{"n":list(sc.keys())})).all()
    bucket=Counter(); amt=defaultdict(float); n=0
    # within partial_excluded: which skus dominate
    excl_skus=Counter()
    for onum,agg,li in rows:
        s=sc.get(onum)
        if not s: continue
        if classify(agg)=="delivered" and s["cat"]=="delivered":
            n+=1
            cogs=0.0; empty=(li is None) or (isinstance(li,list) and len(li)==0); had_excl=False; excl_here=[]
            for it in (li or []):
                inv=it.get("inventory_item") or {}
                sku=inv.get("sku") if isinstance(inv,dict) else None
                qty=int(it.get("quantity") or 1)
                if sku and sku in sku_costs: cogs+=sku_costs[sku]*qty
                elif sku and sku in excl: had_excl=True; excl_here.append(sku)
            d=round(cogs,2)-s["cogs"]
            if abs(d)<0.01: bucket["exact"]+=1
            elif empty: bucket["empty_line_items"]+=1; amt["empty_line_items"]+=d
            elif had_excl and cogs==0: bucket["excluded_only"]+=1; amt["excluded_only"]+=d; [excl_skus.update([x]) for x in excl_here]
            elif had_excl: bucket["partial_excluded"]+=1; amt["partial_excluded"]+=d; [excl_skus.update([x]) for x in excl_here]
            else: bucket["value_or_lineitem"]+=1; amt["value_or_lineitem"]+=d
    return m, n, bucket, amt, excl_skus

async def main():
    for m in ["2026-04","2026-05"]:
        m,n,bucket,amt,excl_skus=await analyze(m)
        print(f"\n==== {m}  (both-delivered n={n}) ====")
        tot=0
        for k in ["exact","value_or_lineitem","partial_excluded","empty_line_items","excluded_only"]:
            if k in bucket:
                a=amt.get(k,0); tot+=a
                print(f"   {k:<22} count={bucket[k]:>6}  net={a:>+11,.2f}")
        print(f"   {'NET DELTA':<22}             net={tot:>+11,.2f}")
        print(f"   top excluded skus driving partial_excluded: {excl_skus.most_common(8)}")

asyncio.run(main())
print("DONE")
