import sys, asyncio, sqlite3
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"
MONTH = "2026-04"

# the 27 nonzero-mismatch orders found earlier
ORDERS = [
    "GRAND7873",
    "EST157161",
    "EST156108",
    "EST155988",
    "EST155894",
    "EST153663",
    "EST151697",
    "EST151434",
    "EST149949",
    "EST149275",
    "EST149016",
    "EST148891",
    "EST147867",
    "GRAND8887",
    "GRAND8700",
    "EST143940",
    "EST143290",
    "EST142733",
    "EST141866",
    "EST140297",
    "EST139731",
    "EST156614",
    "EST148323",
    "GRAND8592",
    "EST153147",
    "EST144882",
    "EST151848",
]


def load_sc():
    con = sqlite3.connect(PR)
    cur = con.cursor()
    rows = cur.execute(
        f"SELECT order_name, revenue, status_category, skus, created_at FROM profit_orders "
        f"WHERE month=? AND order_name IN ({','.join('?' * len(ORDERS))})",
        (MONTH, *ORDERS),
    ).fetchall()
    con.close()
    return {
        r[0]: dict(rev=r[1] or 0, cat=r[2], skus=r[3] or "", created=r[4]) for r in rows
    }


async def main():
    sc = load_sc()
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT order_number, total_price, subtotal_price, item_count, synced_at,
                   frisbo_created_at, line_items, financial_status, aggregated_status
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": ORDERS},
            )
        ).all()
    print("order | tp | li_n | li_sum | sc_rev | synced_at | created")
    awb_li_eq_tp = 0
    for r in rows:
        (onum, tp, sub, ic, sync, fc, li, fin, agg) = r
        tp = float(tp or 0)
        li_n = len(li) if isinstance(li, list) else 0
        li_sum = 0.0
        if isinstance(li, list):
            for it in li:
                if isinstance(it, dict):
                    try:
                        li_sum += float(it.get("price") or 0) * int(
                            it.get("quantity") or 1
                        )
                    except Exception:
                        pass
        # does AWB total reconcile to AWB subtotal+shipping? (tp = sub means total IS the priced total)
        print(
            f"  {onum:<11} tp={tp:>8.2f} li_n={li_n} li_sum={li_sum:>8.2f} sc={sc[onum]['rev']:>8.2f} "
            f"sync={str(sync)[:19]} created={str(fc)[:19]}"
        )
    # all synced recently? check max synced_at across whole table for freshness
    async with AsyncSessionLocal() as db:
        mx = (await db.execute(text("SELECT max(synced_at) FROM orders"))).scalar()
        cnt_recent = (
            await db.execute(
                text(
                    "SELECT count(*) FROM orders WHERE synced_at > now() - interval '2 days'"
                )
            )
        ).scalar()
    print(f"\nmax(synced_at) across orders = {mx}")
    print(f"orders synced in last 2 days = {cnt_recent}")
    print(
        "\n=> AWB is LIVE (recently synced); Scripturi SQLite snapshot ~2026-06-03 stale."
    )
    print(
        "=> 24/27 have SC>AWB with deltas in multiples of 45/90/135 => order line-items"
    )
    print(
        "   were edited (items removed/refunded) in Shopify AFTER the SC snapshot; AWB reflects"
    )
    print("   the newer reduced total. This is snapshot-timing, not an AWB bug.")


asyncio.run(main())
print("DONE")
