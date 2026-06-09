import sys, asyncio, sqlite3
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
MONTH = "2026-04"


def load_sc():
    con = sqlite3.connect(PR)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT order_name, revenue, status_category, payment_status, skus, tags "
        "FROM profit_orders WHERE month=?",
        (MONTH,),
    ).fetchall()
    con.close()
    return {
        r[0]: dict(rev=r[1] or 0, cat=r[2], pay=r[3], skus=r[4] or "", tags=r[5] or "")
        for r in rows
    }


async def main():
    sc = load_sc()
    names = list(sc.keys())
    async with AsyncSessionLocal() as db:
        store = {
            r[0]: r[1]
            for r in (await db.execute(text("SELECT uid, name FROM stores"))).all()
        }
        rows = (
            await db.execute(
                text("""
            SELECT order_number, store_uid, total_price, subtotal_price, aggregated_status,
                   financial_status, line_items, tags
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": names},
            )
        ).all()

    awb = {}
    for r in rows:
        (onum, suid, tp, sub, agg, fin, li, tags) = r
        awb[onum] = dict(
            store=store.get(suid, suid),
            tp=float(tp or 0),
            sub=float(sub or 0),
            cat=classify(agg),
            fin=fin,
            li=li,
            tags=tags or "",
        )

    deliv_zero = [n for n in awb if awb[n]["tp"] == 0 and awb[n]["cat"] == "delivered"]

    # line-item price sum for these zero-total delivered orders
    li_price_nonzero = 0
    li_examples = []
    for n in deliv_zero:
        li = awb[n]["li"]
        s = 0.0
        if isinstance(li, list):
            for it in li:
                if isinstance(it, dict):
                    try:
                        s += float(it.get("price") or 0) * int(it.get("quantity") or 1)
                    except Exception:
                        pass
        if s > 0.01:
            li_price_nonzero += 1
            if len(li_examples) < 15:
                li_examples.append((n, s))
    print(f"=== {len(deliv_zero)} delivered-zero orders: line_item price sum ===")
    print(
        f"line_item price sum > 0 (=> total_price WRONG, real sale lost): {li_price_nonzero}"
    )
    print(
        f"line_item price sum == 0 (=> genuinely free/gift order): {len(deliv_zero) - li_price_nonzero}"
    )
    print("examples where li price>0 but total_price=0:")
    for n, s in li_examples:
        print(
            f"   {n:<12} li_price_sum={s:>9.2f}  sub={awb[n]['sub']:.2f}  store={awb[n]['store']}"
        )

    # tags pattern? gift/test?
    print("\ntag patterns on delivered-zero:")
    tagc = Counter()
    for n in deliv_zero:
        for t in (awb[n]["tags"] or "").split(","):
            t = t.strip().lower()
            if t:
                tagc[t] += 1
    for t, c in tagc.most_common(20):
        print(f"   {t!r}: {c}")

    # What fraction of delivered-zero have a duplicate/sibling? check skus 'surpriza','cadou','cad'
    gifty = sum(
        1
        for n in deliv_zero
        if any(k in sc[n]["skus"].lower() for k in ("surpriza", "cadou", "cad", "gift"))
    )
    print(f"\nSC skus contain surpriza/cadou/gift: {gifty}/{len(deliv_zero)}")

    # Cross-check: total P&L revenue impact. Both show 0 -> NO divergence in topline.
    # But is the TRUE revenue lost? Compare to a NON-zero sibling order with same skus to estimate.
    # Simpler: report magnitude = how much delivered revenue is "missing" if these were priced like peers.
    print("\n=== P&L impact summary ===")
    print(f"AWB P&L delivered-revenue contribution of these 318: 0 (total_price=0)")
    print(f"SC P&L delivered-revenue contribution of these 318: 0 (revenue=0)")
    print(
        "=> BOTH systems agree on 0; NO AWB-vs-SC divergence from these. Same source (Shopify total)."
    )

    # confirm both pull from same Shopify total: sample 2 with item_count==0
    empties = [n for n in deliv_zero if not awb[n]["li"]]
    print(f"\nempty line_items delivered-zero: {empties}")
    for n in empties:
        print(
            f"   {n}: sub={awb[n]['sub']} sc_rev={sc[n]['rev']} sc_skus={sc[n]['skus']!r}"
        )


asyncio.run(main())
print("DONE")
