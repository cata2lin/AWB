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

SC_CAT={"Livrata":"delivered","Refuzata":"returned","Anulata":"cancelled","In curs":"in_transit","In tranzit":"in_transit","Netrimisa":"other","Lipsa awb":"other","Probleme livrare":"problems","":"other"}

def load_sc():
    con=sqlite3.connect(PR); cur=con.cursor()
    rows=cur.execute("SELECT order_name, prefix, cogs, status_category FROM profit_orders WHERE month=?", (MONTH,)).fetchall()
    con.close()
    return {r[0]:{"prefix":r[1],"cogs":r[2] or 0,"cat":SC_CAT.get(r[3],"other")} for r in rows}

async def main():
    sc=load_sc()
    async with AsyncSessionLocal() as db:
        sku_costs_all={r[0]:float(r[1] or 0) for r in (await db.execute(text("SELECT sku, cost FROM sku_costs"))).all()}
        excl={r[0] for r in (await db.execute(text("SELECT sku FROM products WHERE exclude_from_stock=true AND sku IS NOT NULL"))).all()}
        sku_costs=dict(sku_costs_all)
        for e in excl: sku_costs.pop(e,None)
        names=list(sc.keys())
        rows=(await db.execute(text("SELECT order_number, aggregated_status, line_items FROM orders WHERE order_number = ANY(:n)"),{"n":names})).all()

    # Decompose total COGS delta into buckets, over both-delivered orders
    bucket=Counter()
    bucket_amt=defaultdict(float)
    n_both=0
    for onum,agg,li in rows:
        s=sc.get(onum)
        if not s: continue
        acat=classify(agg)
        if acat=="delivered" and s["cat"]=="delivered":
            n_both+=1
            cogs=0.0; empty = (li is None) or (isinstance(li,list) and len(li)==0)
            had_excl=False; had_missing=False
            if isinstance(li,list):
                for it in li:
                    if isinstance(it,dict):
                        inv=it.get("inventory_item") or {}
                        sku=inv.get("sku") if isinstance(inv,dict) else None
                        qty=int(it.get("quantity") or 1)
                        if sku and sku in sku_costs:
                            cogs+=sku_costs[sku]*qty
                        elif sku and sku in excl:
                            had_excl=True
                        elif sku and sku in sku_costs_all:
                            pass
                        elif sku:
                            had_missing=True
            delta = round(cogs,2) - s["cogs"]
            if abs(delta)<0.01:
                bucket["exact"]+=1
            elif empty:
                bucket["empty_line_items"]+=1; bucket_amt["empty_line_items"]+=delta
            elif cogs==0 and had_excl:
                bucket["excluded_only"]+=1; bucket_amt["excluded_only"]+=delta
            elif had_excl:
                bucket["partial_excluded"]+=1; bucket_amt["partial_excluded"]+=delta
            elif had_missing:
                bucket["missing_cost"]+=1; bucket_amt["missing_cost"]+=delta
            else:
                # both have costs but differ -> value conflict (cross-store) OR line-item-count mismatch
                bucket["value_or_lineitem_diff"]+=1; bucket_amt["value_or_lineitem_diff"]+=delta
    print(f"=== COGS delta decomposition (both-delivered, n={n_both}) ===")
    tot=0
    for k,v in bucket.most_common():
        amt=bucket_amt.get(k,0.0)
        tot+=amt
        print(f"   {k:<26} count={v:>6}   net_delta_amt={amt:>+12,.2f}")
    print(f"   {'TOTAL non-exact delta':<26}             net={tot:>+12,.2f}  (AWB - SC)")

    # The value_or_lineitem bucket: split into pure-value (line count matches sku set) vs missing-line-item
    # Use Scripturi skus vs AWB skus count
    con=sqlite3.connect(PR); cur=con.cursor()
    scskus={r[0]:(r[1] or "") for r in cur.execute("SELECT order_name, skus FROM profit_orders WHERE month=?",(MONTH,)).fetchall()}
    con.close()
    lineitem_short=0; value_diff=0; li_amt=0.0; val_amt=0.0
    sample_val=[]; sample_li=[]
    for onum,agg,li in rows:
        s=sc.get(onum)
        if not s: continue
        if classify(agg)=="delivered" and s["cat"]=="delivered":
            cogs=0.0; awb_sku_set=set(); empty=(li is None) or (isinstance(li,list) and len(li)==0)
            if empty: continue
            ok=True
            for it in (li or []):
                inv=it.get("inventory_item") or {}
                sku=inv.get("sku") if isinstance(inv,dict) else None
                qty=int(it.get("quantity") or 1)
                if sku: awb_sku_set.add(sku)
                if sku and sku in sku_costs: cogs+=sku_costs[sku]*qty
            delta=round(cogs,2)-s["cogs"]
            if abs(delta)<0.01: continue
            sc_sku_set=set(x.strip() for x in scskus.get(onum,"").split(";") if x.strip())
            if sc_sku_set and sc_sku_set!=awb_sku_set:
                lineitem_short+=1; li_amt+=delta
                if len(sample_li)<6: sample_li.append((onum,sorted(awb_sku_set),sorted(sc_sku_set),round(cogs,2),s["cogs"]))
            else:
                value_diff+=1; val_amt+=delta
                if len(sample_val)<8: sample_val.append((onum,sorted(awb_sku_set),round(cogs,2),s["cogs"]))
    print(f"\n=== Within value/lineitem bucket ===")
    print(f"   LINE-ITEM SET MISMATCH (AWB skus != SC skus): {lineitem_short}  net_delta={li_amt:+,.2f}")
    print(f"   PURE VALUE DIFF (same skus, diff cost):        {value_diff}  net_delta={val_amt:+,.2f}")
    print("\n  sample LINE-ITEM mismatches:")
    for s in sample_li: print(f"     {s[0]} awb={s[1]} sc={s[2]} awbcogs={s[3]} sccogs={s[4]}")
    print("\n  sample VALUE diffs (cross-store cost conflict):")
    for s in sample_val: print(f"     {s[0]} skus={s[1]} awbcogs={s[2]} sccogs={s[3]}")

asyncio.run(main())
print("DONE")
