import sys, asyncio, sqlite3, json
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
        "SELECT order_name, revenue, currency, status_category, payment_status, awb, skus "
        "FROM profit_orders WHERE month=?",
        (MONTH,),
    ).fetchall()
    con.close()
    return {
        r[0]: dict(
            rev=r[1] or 0,
            cur=(r[2] or "RON").upper(),
            cat=r[3],
            pay=r[4],
            awb=r[5],
            skus=r[6] or "",
        )
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
            SELECT order_number, store_uid, total_price, subtotal_price, currency,
                   aggregated_status, financial_status, payment_gateway, line_items,
                   item_count, awb_count, tracking_number, tags
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": names},
            )
        ).all()
    awb = {}
    for r in rows:
        (onum, suid, tp, sub, cur_, agg, fin, pg, li, ic, awbc, trk, tags) = r
        awb[onum] = dict(
            store=store.get(suid, suid),
            tp=float(tp or 0),
            sub=float(sub or 0),
            cur=(cur_ or "RON").upper(),
            agg=agg,
            cat=classify(agg),
            fin=fin,
            pg=pg,
            li=li,
            ic=ic,
            awbc=awbc,
            trk=trk,
            tags=tags or "",
        )

    # === DELIVERED orders where AWB total_price == 0 ===
    deliv_zero = [n for n in awb if awb[n]["tp"] == 0 and awb[n]["cat"] == "delivered"]
    print(f"=== DELIVERED orders with AWB total_price==0 : {len(deliv_zero)} ===")
    print("by store:", dict(Counter(awb[n]["store"] for n in deliv_zero)))
    print("by fin:", dict(Counter(awb[n]["fin"] for n in deliv_zero)))
    print("by pg:", dict(Counter(str(awb[n]["pg"])[:20] for n in deliv_zero)))
    print("subtotal nonzero:", sum(1 for n in deliv_zero if awb[n]["sub"] != 0))
    print("item_count==0:", sum(1 for n in deliv_zero if (awb[n]["ic"] or 0) == 0))
    print("line_items empty:", sum(1 for n in deliv_zero if not awb[n]["li"]))
    # SC side
    sc_zero = sum(1 for n in deliv_zero if sc[n]["rev"] == 0)
    sc_pos = [n for n in deliv_zero if sc[n]["rev"] > 0]
    print(f"SC also 0: {sc_zero}; SC>0: {len(sc_pos)}")
    print(
        "SC cat distribution for these:",
        dict(Counter(sc[n]["cat"] for n in deliv_zero)),
    )
    print("SC skus empty:", sum(1 for n in deliv_zero if not sc[n]["skus"]))
    print()
    print("sample delivered-zero (order|store|fin|ic|li|sc_rev|sc_cat|sc_skus):")
    for n in deliv_zero[:20]:
        a = awb[n]
        lilen = len(a["li"]) if isinstance(a["li"], list) else "NA"
        print(
            f"  {n:<12} {a['store'][:13]:<13} fin={str(a['fin'])[:8]:<8} ic={a['ic']} li={lilen} "
            f"trk={'Y' if a['trk'] else '-'} sc_rev={sc[n]['rev']:>6} sc_cat={str(sc[n]['cat'])[:8]:<8} skus={sc[n]['skus'][:30]}"
        )

    # === Now reproduce AWB P&L delivered-revenue for COV to confirm zero-cancelled excluded ===
    print("\n=== COV prefix: P&L delivered revenue reproduction ===")
    cov = [n for n in awb if n.startswith("COV")]
    cov_deliv = [n for n in cov if awb[n]["cat"] == "delivered"]
    cov_deliv_rev = sum(awb[n]["tp"] for n in cov_deliv)
    cov_deliv_zero = [n for n in cov_deliv if awb[n]["tp"] == 0]
    print(
        f"COV matched={len(cov)} delivered={len(cov_deliv)} deliv_rev_sum={cov_deliv_rev:,.2f} "
        f"deliv&zero={len(cov_deliv_zero)}"
    )
    # the 42 cancelled-zero: confirm not delivered
    cov_cancel_zero = [
        n for n in cov if awb[n]["tp"] == 0 and awb[n]["cat"] != "delivered"
    ]
    print(f"COV zero & non-delivered (excluded from P&L rev): {len(cov_cancel_zero)}")
    print(
        f"  their SC revenue total (NOT in AWB P&L, correctly): "
        f"{sum(sc[n]['rev'] for n in cov_cancel_zero):,.2f}"
    )

    # === Do the 42 voided COD cancels also count in SC revenue topline? ===
    print("\n=== The 42 VOIDED-COD-cancelled: how SC treats them ===")
    cov_zero_mismatch = [n for n in cov if awb[n]["tp"] == 0 and sc[n]["rev"] > 0]
    print("count:", len(cov_zero_mismatch))
    print("SC cat:", dict(Counter(sc[n]["cat"] for n in cov_zero_mismatch)))
    print("SC pay:", dict(Counter(sc[n]["pay"] for n in cov_zero_mismatch)))
    # SC only counts revenue in topline for delivered (Livrata). Are any of these Livrata?
    sc_livrata = [n for n in cov_zero_mismatch if sc[n]["cat"] == "Livrata"]
    print(
        f"SC cat==Livrata (would inflate SC delivered-rev): {len(sc_livrata)} -> {sc_livrata}"
    )


asyncio.run(main())
print("DONE")
