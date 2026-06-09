import sys, asyncio, sqlite3, json
from collections import defaultdict, Counter
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

MONTH = "2026-04"
PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
PA = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/product_analytics.db"

SC_CAT = {"Livrata":"delivered","Refuzata":"returned","Anulata":"cancelled","In curs":"in_transit",
          "In tranzit":"in_transit","Netrimisa":"other","Lipsa awb":"other","Probleme livrare":"problems","":"other"}

def load_scripturi(month):
    con = sqlite3.connect(PR); cur = con.cursor()
    rows = cur.execute("SELECT order_name, prefix, revenue, currency, cogs, cogs_missing, cogs_missing_skus, status_category, skus FROM profit_orders WHERE month=?", (month,)).fetchall()
    con.close()
    d={}
    for name,prefix,rev,cur_,cogs,cmiss,cmskus,cat,skus in rows:
        d[name]={"prefix":prefix,"cogs":cogs or 0,"cogs_missing":cmiss or 0,"cogs_missing_skus":cmskus or "","cat":SC_CAT.get(cat,"other"),"skus":skus or ""}
    return d

async def main():
    sc = load_scripturi(MONTH)
    async with AsyncSessionLocal() as db:
        sku_costs_all = {r[0]: float(r[1] or 0) for r in (await db.execute(text("SELECT sku, cost FROM sku_costs"))).all()}
        excl = {r[0] for r in (await db.execute(text("SELECT sku FROM products WHERE exclude_from_stock = true AND sku IS NOT NULL"))).all()}
        sku_costs = dict(sku_costs_all)
        for e in excl: sku_costs.pop(e, None)
        names = list(sc.keys())
        rows = (await db.execute(text("""
            SELECT order_number, aggregated_status, line_items
            FROM orders WHERE order_number = ANY(:names)
        """), {"names": names})).all()
    awb = {}
    for onum, agg, li in rows:
        awb[onum] = {"cat": classify(agg), "li": li}

    # Identify the 237 AWB=0 SC>0 delivered orders, collect the SKUs that AWB couldn't cost
    missing_sku_counter = Counter()        # sku -> # orders where it appears in an AWB-zero order
    missing_sku_in_costs_all = Counter()   # sku present in sku_costs_all (so only excluded)
    missing_sku_excluded = Counter()       # sku in excl set
    missing_sku_absent = Counter()         # sku not anywhere in sku_costs_all
    missing_sku_casing = Counter()         # sku absent but case-insensitive match exists
    zero_orders = []
    lower_costs = {k.lower(): k for k in sku_costs_all}
    for n, a in awb.items():
        s = sc.get(n)
        if not s: continue
        if a["cat"]=="delivered" and s["cat"]=="delivered":
            # compute AWB cogs
            cogs=0.0; skus_in_order=[]
            li = a["li"]
            if isinstance(li, list):
                for it in li:
                    if isinstance(it, dict):
                        inv = it.get("inventory_item") or {}
                        sku = inv.get("sku") if isinstance(inv, dict) else None
                        qty = int(it.get("quantity") or 1)
                        skus_in_order.append((sku,qty))
                        if sku and sku in sku_costs:
                            cogs += sku_costs[sku]*qty
            if cogs==0 and s["cogs"]>0:
                zero_orders.append((n, s["cogs"], s["cogs_missing"], s["cogs_missing_skus"], s["skus"], skus_in_order))
                for sku,qty in skus_in_order:
                    if not sku: 
                        missing_sku_counter["<NULL-SKU>"]+=1
                        continue
                    missing_sku_counter[sku]+=1
                    if sku in excl:
                        missing_sku_excluded[sku]+=1
                    elif sku in sku_costs_all:
                        missing_sku_in_costs_all[sku]+=1  # in costs but not in filtered? shouldn't happen unless excluded
                    elif sku.lower() in lower_costs:
                        missing_sku_casing[sku]+=1
                    else:
                        missing_sku_absent[sku]+=1

    print(f"=== AWB=0 SC>0 delivered orders: {len(zero_orders)} ===")
    print(f"Distinct missing SKUs (appearing in those orders): {len(missing_sku_counter)}")
    print(f"\n-- SKU breakdown by reason (order-appearances) --")
    print(f"EXCLUDED (exclude_from_stock=true), removed from cost map: {sum(missing_sku_excluded.values())} appearances, {len(missing_sku_excluded)} distinct")
    print(f"CASE-MISMATCH (exact absent but case-insensitive match exists): {sum(missing_sku_casing.values())} appearances, {len(missing_sku_casing)} distinct")
    print(f"ABSENT entirely from sku_costs: {sum(missing_sku_absent.values())} appearances, {len(missing_sku_absent)} distinct")
    print(f"In sku_costs_all but filtered (odd): {sum(missing_sku_in_costs_all.values())}")
    print(f"NULL sku line items: {missing_sku_counter.get('<NULL-SKU>',0)}")

    print(f"\n-- top EXCLUDED skus --")
    for sku,c in missing_sku_excluded.most_common(15):
        print(f"   {sku:<30} x{c}  cost_in_all={sku_costs_all.get(sku)}")
    print(f"\n-- top CASE-MISMATCH skus (awb_sku -> actual key) --")
    for sku,c in missing_sku_casing.most_common(15):
        print(f"   {sku:<30} x{c}  -> {lower_costs.get(sku.lower())} cost={sku_costs_all.get(lower_costs.get(sku.lower()))}")
    print(f"\n-- top ABSENT skus --")
    for sku,c in missing_sku_absent.most_common(25):
        print(f"   {sku:<30} x{c}")

    # how many zero-orders are FULLY explained by exclusion (every sku in order is excluded or null)
    fully_excl=0; partially=0; no_excl=0
    for (n,sccogs,cmiss,cmskus,scskus,skus_in_order) in zero_orders:
        nonnull = [sk for sk,q in skus_in_order if sk]
        if nonnull and all(sk in excl for sk in nonnull):
            fully_excl+=1
        elif any(sk in excl for sk in nonnull):
            partially+=1
        else:
            no_excl+=1
    print(f"\n-- zero-order attribution --")
    print(f"FULLY explained by exclusion (all skus excluded): {fully_excl}")
    print(f"PARTIALLY excluded: {partially}")
    print(f"NO exclusion involved (pure missing cost): {no_excl}")

    # sample some zero orders
    print(f"\n-- sample 12 zero orders --")
    for z in zero_orders[:12]:
        n,sccogs,cmiss,cmskus,scskus,skus_in_order = z
        print(f"   {n}: SC_cogs={sccogs} cogs_missing={cmiss} missing_skus='{cmskus}' awb_skus={skus_in_order}")

asyncio.run(main())
print("DONE")
