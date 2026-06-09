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
        "SELECT order_name, revenue, status_category, skus FROM profit_orders WHERE month=?",
        (MONTH,),
    ).fetchall()
    con.close()
    return {r[0]: dict(rev=r[1] or 0, cat=r[2], skus=r[3] or "") for r in rows}


async def main():
    sc = load_sc()
    names = list(sc.keys())
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT order_number, total_price, subtotal_price, aggregated_status, line_items
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": names},
            )
        ).all()
    awb = {}
    for r in rows:
        (onum, tp, sub, agg, li) = r
        awb[onum] = dict(
            tp=float(tp or 0), sub=float(sub or 0), cat=classify(agg), li=li
        )

    nonzero = [
        n for n in awb if awb[n]["tp"] != 0 and abs(awb[n]["tp"] - sc[n]["rev"]) > 0.01
    ]
    print(f"=== {len(nonzero)} nonzero mismatches ===\n")

    # hypothesis A: AWB total - subtotal = shipping; does SC = subtotal+something or total+something?
    # check li price sum vs tp vs sub vs sc
    print("order | tp | sub | li_sum | sc_rev | tp-sub | sc-tp | sc-li")
    deltas_sc_minus_tp = Counter()
    sc_eq_lisum = 0
    for n in nonzero:
        li_sum = 0.0
        if isinstance(awb[n]["li"], list):
            for it in awb[n]["li"]:
                if isinstance(it, dict):
                    try:
                        li_sum += float(it.get("price") or 0) * int(
                            it.get("quantity") or 1
                        )
                    except Exception:
                        pass
        a = awb[n]
        d = round(sc[n]["rev"] - a["tp"], 2)
        deltas_sc_minus_tp[d] += 1
        if abs(sc[n]["rev"] - li_sum) < 0.01:
            sc_eq_lisum += 1
        print(
            f"  {n:<11} {a['tp']:>8.2f} {a['sub']:>8.2f} {li_sum:>8.2f} {sc[n]['rev']:>8.2f} "
            f"{a['tp'] - a['sub']:>+7.2f} {sc[n]['rev'] - a['tp']:>+8.2f} {sc[n]['rev'] - li_sum:>+8.2f}"
        )

    print(f"\nSC revenue == line_item price sum: {sc_eq_lisum}/{len(nonzero)}")
    print("distribution of (SC - AWB total_price):")
    for d, c in deltas_sc_minus_tp.most_common():
        print(f"   {d:>+8.2f}: {c}")

    # hypothesis: AWB tp - sub is a flat 20 (shipping). check
    flat20 = sum(
        1 for n in nonzero if abs((awb[n]["tp"] - awb[n]["sub"]) - 20.0) < 0.01
    )
    print(f"\nAWB (total - subtotal) == 20.00 (shipping fee): {flat20}/{len(nonzero)}")
    # how many AWB tp==sub (no shipping line)
    eq = sum(1 for n in nonzero if abs(awb[n]["tp"] - awb[n]["sub"]) < 0.01)
    print(f"AWB total == subtotal (no separate shipping): {eq}/{len(nonzero)}")


asyncio.run(main())
print("DONE")
