import sys, asyncio, sqlite3, json
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
MONTH = sys.argv[1] if len(sys.argv) > 1 else "2026-04"


def load_sc(month):
    con = sqlite3.connect(PR)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT order_name, prefix, revenue, currency, status_category, payment_status, "
        "fulfillment_status, awb, skus, tags, created_at FROM profit_orders WHERE month=?",
        (month,),
    ).fetchall()
    con.close()
    d = {}
    for name, prefix, rev, cur_, cat, pay, ful, awb, skus, tags, cre in rows:
        d[name] = dict(
            prefix=prefix,
            revenue=rev or 0,
            currency=(cur_ or "RON").upper(),
            cat=cat,
            pay=pay,
            ful=ful,
            awb=awb,
            skus=skus or "",
            tags=tags or "",
            created=cre,
        )
    return d


async def main():
    sc = load_sc(MONTH)
    names = list(sc.keys())
    async with AsyncSessionLocal() as db:
        store = {
            r[0]: r[1]
            for r in (await db.execute(text("SELECT uid, name FROM stores"))).all()
        }
        rows = (
            await db.execute(
                text("""
            SELECT order_number, store_uid, total_price, subtotal_price, currency,
                   aggregated_status, financial_status, payment_gateway, line_items,
                   synced_at, frisbo_created_at, item_count, awb_count, tags
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": names},
            )
        ).all()

    awb = {}
    for r in rows:
        (onum, suid, tp, sub, cur_, agg, fin, pg, li, sync, fc, ic, awbc, tags) = r
        awb[onum] = dict(
            store=store.get(suid, suid),
            store_uid=suid,
            tp=float(tp or 0),
            sub=float(sub or 0),
            currency=(cur_ or "RON").upper(),
            agg=agg,
            cat=classify(agg),
            fin=fin,
            pg=pg,
            li=li,
            synced=sync,
            created=fc,
            item_count=ic,
            awb_count=awbc,
            tags=tags or "",
        )

    # ---- 1. native revenue mismatches (the 69) ----
    mismatch = []
    for n in names:
        if n in awb and abs(awb[n]["tp"] - sc[n]["revenue"]) > 0.01:
            mismatch.append(n)
    print(f"=== {MONTH}: {len(mismatch)} native-revenue mismatches ===\n")

    # split into AWB-zero vs nonzero
    awb_zero = [n for n in mismatch if awb[n]["tp"] == 0]
    awb_nonzero = [n for n in mismatch if awb[n]["tp"] != 0]
    print(f"AWB total_price==0 but SC>0 : {len(awb_zero)}")
    print(f"AWB total_price!=0, both nonzero but differ : {len(awb_nonzero)}\n")

    # ---- 2. characterize the AWB-zero set ----
    print("--- AWB total_price==0 set ---")
    by_store = Counter(awb[n]["store"] for n in awb_zero)
    print("by store:", dict(by_store))
    by_fin = Counter(awb[n]["fin"] for n in awb_zero)
    print("by financial_status:", dict(by_fin))
    by_pg = Counter(awb[n]["pg"] for n in awb_zero)
    print("by payment_gateway:", dict(by_pg))
    by_cat = Counter(awb[n]["cat"] for n in awb_zero)
    print("by AWB category:", dict(by_cat))
    by_agg = Counter(awb[n]["agg"] for n in awb_zero)
    print("by aggregated_status:", dict(by_agg))
    sub_nonzero = sum(1 for n in awb_zero if awb[n]["sub"] != 0)
    print(f"subtotal_price nonzero (while total==0): {sub_nonzero}/{len(awb_zero)}")
    # how many are delivered (counted in P&L)?
    delivered_zero = [n for n in awb_zero if awb[n]["cat"] == "delivered"]
    print(f"delivered & total==0 (BIASES P&L LOW): {len(delivered_zero)}")
    sc_rev_lost = sum(sc[n]["revenue"] for n in delivered_zero)
    print(f"  -> SC revenue on those delivered: {sc_rev_lost:,.2f} RON\n")

    # sample detail
    print(
        "sample (order | store | tp | sub | fin | pg | cat | item_count | sc_rev | sc_pay | li_len):"
    )
    for n in awb_zero[:25]:
        a = awb[n]
        li_len = len(a["li"]) if isinstance(a["li"], list) else "NA"
        print(
            f"  {n:<12} {a['store'][:14]:<14} tp={a['tp']:>6} sub={a['sub']:>7} "
            f"fin={str(a['fin'])[:10]:<10} pg={str(a['pg'])[:8]:<8} {a['cat'][:9]:<9} "
            f"ic={a['item_count']} sc={sc[n]['revenue']:>6} scpay={str(sc[n]['pay'])[:8]:<8} li={li_len}"
        )

    # ---- 3. line_items detail for a few zero orders ----
    print("\n--- line_items of first 5 zero-total orders ---")
    for n in awb_zero[:5]:
        a = awb[n]
        print(
            f"\n{n}  store={a['store']} tp={a['tp']} sub={a['sub']} fin={a['fin']} pg={a['pg']}"
        )
        print(
            f"   SC: rev={sc[n]['revenue']} pay={sc[n]['pay']} skus={sc[n]['skus'][:60]}"
        )
        if isinstance(a["li"], list):
            for it in a["li"][:6]:
                if isinstance(it, dict):
                    inv = it.get("inventory_item") or {}
                    print(
                        f"   li: sku={inv.get('sku')} qty={it.get('quantity')} price={it.get('price')} title={str(inv.get('title_1'))[:30]}"
                    )

    # ---- 4. characterize nonzero mismatches ----
    print("\n--- nonzero mismatches (both >0 but differ) ---")
    for n in awb_nonzero[:30]:
        a = awb[n]
        diff = a["tp"] - sc[n]["revenue"]
        print(
            f"  {n:<12} AWB={a['tp']:>9.2f}{a['currency']} sub={a['sub']:>9.2f} "
            f"SC={sc[n]['revenue']:>9.2f}{sc[n]['currency']} Δ={diff:>+8.2f} "
            f"fin={str(a['fin'])[:8]} cat={a['cat'][:9]}"
        )

    # ---- 5. is total_price==0 widespread beyond mismatches? ----
    all_zero = [n for n in awb if awb[n]["tp"] == 0]
    print(f"\n--- ALL AWB total_price==0 in matched set: {len(all_zero)} ---")
    print("by store:", dict(Counter(awb[n]["store"] for n in all_zero)))
    print("by cat:", dict(Counter(awb[n]["cat"] for n in all_zero)))
    # of these, how many does SC also show 0?
    sc_also_zero = sum(1 for n in all_zero if sc[n]["revenue"] == 0)
    print(f"of which SC also 0: {sc_also_zero}; SC>0: {len(all_zero) - sc_also_zero}")


asyncio.run(main())
print("DONE")
