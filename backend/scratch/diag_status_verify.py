"""
Verify the two big mechanisms behind status disagreements:
  A) other|delivered (132): is AWB Frisbo aggregated_status frozen at a pre-shipment value
     for orders that ARE delivered (real DPD AWB + Shopify DELIVERED)? Check how many of the
     whole month sit at 'fulfilled'/'waiting_for_courier' with a real AWB + tracking.
  B) Distribution of AWB aggregated_status for the WHOLE month, to size the 'fulfilled'/
     'waiting_for_courier' stuck-state population, and how many have awb_count>0 / tracking.
Also dump distinct Scripturi courier_status -> mapping coverage, and check whether AWB
classify() ever maps a real delivered-equivalent to other (vocabulary gap) vs purely lagging.
"""

import sys, asyncio, sqlite3
from collections import Counter
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

MONTH = "2026-04"
PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"

# Romanian month bounds (UTC, shifted) for April 2026 -> Apr in RO local = Mar31 21:00 UTC .. Apr30 20:59:59
LO = datetime(2026, 3, 31, 21, 0, 0)
HI = datetime(2026, 4, 30, 20, 59, 59)

out_lines = []


def p(*a):
    out_lines.append(" ".join(str(x) for x in a))


async def main():
    async with AsyncSessionLocal() as db:
        # A+B: whole-month AWB distribution by aggregated_status, with awb/tracking presence
        rows = (
            await db.execute(
                text("""
            SELECT aggregated_status, shipment_status, awb_count, tracking_number
            FROM orders
            WHERE frisbo_created_at >= :lo AND frisbo_created_at <= :hi
        """),
                {"lo": LO, "hi": HI},
            )
        ).all()
    p(f"AWB orders in RO-April window: {len(rows):,}")

    cat_counter = Counter()
    agg_counter = Counter()
    # how many 'other'-classified orders have a real AWB+tracking (=> shipped but Frisbo froze)
    other_with_awb = 0
    other_with_tracking = 0
    other_agg = Counter()
    for agg, ship, awbc, trk in rows:
        cat = classify(agg)
        cat_counter[cat] += 1
        agg_counter[(str(agg), str(ship))] += 1
        if cat == "other":
            other_agg[str(agg)] += 1
            if (awbc or 0) > 0:
                other_with_awb += 1
            if trk:
                other_with_tracking += 1

    p("\n=== AWB classify() category distribution (whole RO-April) ===")
    for c, n in cat_counter.most_common():
        p(f"  {c:<12} {n:>7,}")

    p("\n=== 'other'-classified breakdown by aggregated_status ===")
    for a, n in other_agg.most_common():
        p(f"  {a:<45} {n:>7,}")
    p(
        f"  -> of 'other' orders: {other_with_awb:,} have awb_count>0, "
        f"{other_with_tracking:,} have a tracking_number (=> physically shipped but Frisbo status frozen)"
    )

    p("\n=== top (aggregated_status, shipment_status) pairs ===")
    for (a, s), n in agg_counter.most_common(20):
        p(f"  {a:<42} {s:<22} {n:>7,}")

    # Cross-check against Scripturi: for the whole month, of AWB 'other' orders that ARE
    # in Scripturi as Livrata, count them (these are the under-counted delivered).
    con = sqlite3.connect(PR)
    cur = con.cursor()
    sc = {
        name: (cat, cstat, awb, sdel)
        for (name, cat, cstat, awb, sdel) in cur.execute(
            "SELECT order_name, status_category, courier_status, awb, shopify_delivery_status "
            "FROM profit_orders WHERE month=?",
            (MONTH,),
        ).fetchall()
    }
    con.close()

    async with AsyncSessionLocal() as db:
        rows2 = (
            await db.execute(
                text("""
            SELECT order_number, aggregated_status, awb_count, tracking_number
            FROM orders
            WHERE frisbo_created_at >= :lo AND frisbo_created_at <= :hi
        """),
                {"lo": LO, "hi": HI},
            )
        ).all()

    awb_other_sc_livrata = 0
    awb_other_sc_livrata_realawb = 0
    examples = []
    for onum, agg, awbc, trk in rows2:
        if classify(agg) == "other" and onum in sc:
            scat, cstat, scawb, sdel = sc[onum]
            if scat == "Livrata":
                awb_other_sc_livrata += 1
                if scawb:
                    awb_other_sc_livrata_realawb += 1
                if len(examples) < 8:
                    examples.append((onum, agg, awbc, bool(trk), cstat, sdel, scawb))
    p(f"\n=== AWB 'other' BUT Scripturi 'Livrata' (delivered) — full month ===")
    p(
        f"  count: {awb_other_sc_livrata:,}  (of which {awb_other_sc_livrata_realawb:,} carry a real DPD AWB in Scripturi)"
    )
    p(
        "  examples (order, awb_agg, awb_count, awb_has_tracking, sc_courier_status, sc_shopify_delivery, sc_awb):"
    )
    for e in examples:
        p("   ", e)

    with open(r"c:/tmp/status_verify_2026-04.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines))
    print("WROTE c:/tmp/status_verify_2026-04.txt")


asyncio.run(main())
print("DONE")
