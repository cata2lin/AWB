import sys, asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.status_classification import classify
from datetime import datetime
from collections import defaultdict

LO = datetime(2026, 3, 31, 21, 0, 0)
HI = datetime(2026, 4, 30, 20, 59, 59)
# Scripturi FLAT monthly rates (so the comparison uses the SAME FX both sides)
RATES = {"RON": 1.0, "CZK": 0.21, "PLN": 1.16, "BGN": 2.54, "EUR": 4.97}

TARGET = [
    "set-5-lavete-magice",
    "set-10-lavete-sarma",
    "manusa-magica",
    "oglinda",
    "71",
    "2",
    "73",
    "38",
    "4",
    "33",
    "7",
    "35",
    "91",
    "30",
    "55",
]


async def main():
    async with AsyncSessionLocal() as db:
        store = {
            r[0]: r[1]
            for r in (await db.execute(text("SELECT uid,name FROM stores"))).all()
        }
        rows = (
            await db.execute(
                text("""
            SELECT order_number, store_uid, currency, aggregated_status, line_items
            FROM orders
            WHERE frisbo_created_at >= :lo AND frisbo_created_at <= :hi
        """),
                {"lo": LO, "hi": HI},
            )
        ).all()
    agg = defaultdict(
        lambda: {
            "deliv_q": 0.0,
            "deliv_rev_ron": 0.0,
            "gross_q": 0.0,
            "gross_rev_ron": 0.0,
            "gross_orders": set(),
        }
    )
    # per-currency breakdown for the two multi-store SKUs
    split = defaultdict(lambda: defaultdict(lambda: {"q": 0.0, "rev_native": 0.0}))
    for onum, suid, cur_, agg_status, li in rows:
        cat = classify(agg_status)
        if cat == "cancelled" or not isinstance(li, list):
            continue
        curr = (cur_ or "RON").upper()
        rate = RATES.get(curr, 1.0)
        for it in li:
            if not isinstance(it, dict):
                continue
            inv = it.get("inventory_item") or {}
            sku = inv.get("sku") if isinstance(inv, dict) else None
            if not sku:
                continue
            q = float(it.get("quantity") or 1)
            p = float(it.get("price") or 0)
            a = agg[sku]
            a["gross_q"] += q
            a["gross_rev_ron"] += p * q * rate
            a["gross_orders"].add(onum)
            if cat == "delivered":
                a["deliv_q"] += q
                a["deliv_rev_ron"] += p * q * rate
            if sku in ("set-5-lavete-magice", "set-10-lavete-sarma"):
                split[sku][curr]["q"] += q
                split[sku][curr]["rev_native"] += p * q

    print(
        f"{'SKU':<26}{'grsQ':>7}{'grsRevRON':>12}{'grsOrd':>8}{'dlvQ':>7}{'dlvRevRON':>12}"
    )
    for sku in TARGET:
        a = agg.get(sku)
        if not a:
            print(f"{sku:<26}  NOT FOUND")
            continue
        print(
            f"{sku:<26}{a['gross_q']:>7.0f}{a['gross_rev_ron']:>12.0f}{len(a['gross_orders']):>8}"
            f"{a['deliv_q']:>7.0f}{a['deliv_rev_ron']:>12.0f}"
        )
    print("\n--- AWB per-currency split (gross, non-cancelled) for big SKUs ---")
    for sku, bycur in split.items():
        print(sku)
        for curr, d in sorted(bycur.items(), key=lambda kv: -kv[1]["q"]):
            print(
                f"   {curr:<5} q={d['q']:>7.0f}  rev_native={d['rev_native']:>12.0f}  rev_RON={d['rev_native'] * RATES.get(curr, 1):>11.0f}"
            )


asyncio.run(main())
print("DONE")
