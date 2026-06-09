"""
Status-classification diagnostic: pull samples for each disagreeing confusion cell
and break down by (AWB aggregated_status, Scripturi courier_status, Scripturi status_category).
"""

import sys, asyncio, sqlite3, json
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify

MONTH = sys.argv[1] if len(sys.argv) > 1 else "2026-04"
PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"

SC_CAT = {
    "Livrata": "delivered",
    "Refuzata": "returned",
    "Anulata": "cancelled",
    "In curs": "in_transit",
    "In tranzit": "in_transit",
    "Netrimisa": "other",
    "Lipsa awb": "other",
    "Probleme livrare": "problems",
    "": "other",
}


def load_scripturi(month):
    con = sqlite3.connect(PR)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT order_name, prefix, status_category, courier_status, courier_key, "
        "awb, payment_status, fulfillment_status, shopify_delivery_status, created_at, tags "
        "FROM profit_orders WHERE month=?",
        (month,),
    ).fetchall()
    con.close()
    d = {}
    for name, prefix, cat, cstat, ckey, awb, pay, ful, sdel, cre, tags in rows:
        d[name] = {
            "prefix": prefix,
            "raw_cat": cat,
            "cat": SC_CAT.get(cat, "other"),
            "courier_status": cstat,
            "courier_key": ckey,
            "awb": awb,
            "pay": pay,
            "ful": ful,
            "shopify_delivery": sdel,
            "created_at": cre,
            "tags": tags,
        }
    return d


async def load_awb(names):
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
            SELECT order_number, aggregated_status, shipment_status, fulfillment_status,
                   financial_status, awb_count, tracking_number, synced_at, frisbo_created_at
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": list(names)},
            )
        ).all()
    out = {}
    for onum, agg, ship, ful, fin, awbc, trk, syn, cre in rows:
        out[onum] = {
            "cat": classify(agg),
            "agg": agg,
            "ship": ship,
            "ful": ful,
            "fin": fin,
            "awb_count": awbc,
            "tracking": trk,
            "synced_at": str(syn),
            "frisbo_created_at": str(cre),
        }
    return out


async def main():
    sc = load_scripturi(MONTH)
    awb = await load_awb(set(sc.keys()))
    matched = [n for n in sc if n in awb]

    # Confusion cells of interest
    cells = [
        ("other", "delivered"),
        ("returned", "cancelled"),
        ("cancelled", "returned"),
        ("delivered", "returned"),
        ("cancelled", "other"),
        ("returned", "delivered"),
        ("delivered", "cancelled"),
        ("other", "cancelled"),
        ("in_transit", "other"),
        ("returned", "other"),
        ("delivered", "other"),
        ("other", "returned"),
    ]

    result = {}
    for acat, scat in cells:
        members = [n for n in matched if awb[n]["cat"] == acat and sc[n]["cat"] == scat]
        if not members:
            continue
        # breakdown by raw status pair
        bd = Counter()
        for n in members:
            key = (
                str(awb[n]["agg"]),
                str(awb[n]["ship"]),
                str(sc[n]["raw_cat"]),
                str(sc[n]["courier_status"]),
            )
            bd[key] += 1
        # synced_at recency: are AWB rows fresher than SC snapshot (~2026-06-03)?
        samples = []
        for n in members[:6]:
            samples.append(
                {
                    "order": n,
                    "awb_agg": awb[n]["agg"],
                    "awb_ship": awb[n]["ship"],
                    "awb_ful": awb[n]["ful"],
                    "awb_awb_count": awb[n]["awb_count"],
                    "awb_synced_at": awb[n]["synced_at"],
                    "sc_raw_cat": sc[n]["raw_cat"],
                    "sc_courier_status": sc[n]["courier_status"],
                    "sc_courier_key": sc[n]["courier_key"],
                    "sc_awb": sc[n]["awb"],
                    "sc_shopify_delivery": sc[n]["shopify_delivery"],
                    "sc_pay": sc[n]["pay"],
                    "sc_ful": sc[n]["ful"],
                }
            )
        result[f"{acat}|{scat}"] = {
            "count": len(members),
            "breakdown": [
                {
                    "awb_agg": k[0],
                    "awb_ship": k[1],
                    "sc_cat": k[2],
                    "sc_courier": k[3],
                    "n": v,
                }
                for k, v in bd.most_common()
            ],
            "samples": samples,
        }

    out = rf"c:/tmp/status_clusters_{MONTH}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, default=str)
    print("WROTE", out)


asyncio.run(main())
print("DONE")
