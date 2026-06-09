import sys, asyncio, sqlite3
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"


def load_sc(month):
    con = sqlite3.connect(PR)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT order_name, revenue, status_category, payment_status, skus FROM profit_orders WHERE month=?",
        (month,),
    ).fetchall()
    con.close()
    return {
        r[0]: dict(rev=r[1] or 0, cat=r[2], pay=r[3], skus=r[4] or "") for r in rows
    }


async def run(month):
    sc = load_sc(month)
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
                   financial_status, payment_gateway, line_items
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": names},
            )
        ).all()
    awb = {}
    for r in rows:
        (onum, suid, tp, sub, agg, fin, pg, li) = r
        awb[onum] = dict(
            store=store.get(suid, suid),
            tp=float(tp or 0),
            sub=float(sub or 0),
            cat=classify(agg),
            fin=fin,
            pg=pg,
            li=li,
        )

    deliv_zero = [n for n in awb if awb[n]["tp"] == 0 and awb[n]["cat"] == "delivered"]
    # true revenue suppressed = sum of line_item price for delivered-zero
    true_rev = 0.0
    for n in deliv_zero:
        li = awb[n]["li"]
        if isinstance(li, list):
            for it in li:
                if isinstance(it, dict):
                    try:
                        true_rev += float(it.get("price") or 0) * int(
                            it.get("quantity") or 1
                        )
                    except Exception:
                        pass
    # total delivered revenue (AWB topline) for context
    total_deliv_rev = sum(awb[n]["tp"] for n in awb if awb[n]["cat"] == "delivered")
    cancel_zero = [
        n
        for n in awb
        if awb[n]["tp"] == 0 and awb[n]["cat"] != "delivered" and sc[n]["rev"] > 0
    ]
    print(f"--- {month} ---")
    print(
        f"matched={len(awb)}  delivered-zero={len(deliv_zero)}  true_rev_suppressed(li-price)={true_rev:,.0f} RON"
    )
    print(
        f"  AWB total delivered revenue = {total_deliv_rev:,.0f} RON  => suppressed is {true_rev / total_deliv_rev * 100:.2f}% of topline"
    )
    print(
        f"  delivered-zero by store: {dict(Counter(awb[n]['store'] for n in deliv_zero))}"
    )
    print(
        f"  cancelled/returned-zero with SC>0 (the 'mismatch sample', NOT in P&L): {len(cancel_zero)}"
    )
    return month, len(deliv_zero), true_rev, len(cancel_zero)


async def main():
    res = []
    for m in ("2026-04", "2026-05"):
        res.append(await run(m))
    print("\n=== SUMMARY ===")
    for m, dz, tr, cz in res:
        print(
            f"  {m}: delivered-zero={dz} (~{tr:,.0f} RON true revenue suppressed in BOTH P&Ls), "
            f"cancelled-zero-mismatch={cz}"
        )


asyncio.run(main())
print("DONE")
