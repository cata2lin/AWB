"""
Empirical AWB-vs-Scripturi audit for a full month (default 2026-04), per ORDER.

Both systems track the same Shopify order universe for 2026 months, and both key an
order by `prefix+number` (AWB `order_number` == Scripturi `order_name`, e.g. APR10610).
So we JOIN on that id and compare, per order:
  - revenue (native currency)         -> reveals revenue/source differences
  - status category                   -> AWB classify(aggregated_status) vs Scripturi status_category
  - COGS (delivered-only)             -> AWB sku_costs lookup vs Scripturi precomputed cogs

Scripturi's reported P&L lives in profitability.db/profit_orders (per-order, precomputed).
AWB's lives in Postgres + the live endpoint. Output: console summary + JSON dump for the
downstream diagnostic agents.

Run:  cd backend && ./venv/Scripts/python.exe scratch/full_audit_2026_04.py [YYYY-MM]
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
OUT = rf"c:/tmp/audit_{MONTH}.json"

# Scripturi status_category (RO) -> AWB-vocabulary bucket
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
        "SELECT order_name, prefix, revenue, currency, cogs, cogs_missing, status_category, "
        "payment_status, fulfillment_status, awb, skus, tags "
        "FROM profit_orders WHERE month=?",
        (month,),
    ).fetchall()
    rates = {
        c.upper(): r
        for c, r in cur.execute(
            "SELECT currency, rate_to_ron FROM profit_exchange_rates WHERE month=?",
            (month,),
        )
    }
    rates["RON"] = 1.0
    con.close()
    d = {}
    for name, prefix, rev, cur_, cogs, cmiss, cat, pay, ful, awb, skus, tags in rows:
        d[name] = {
            "prefix": prefix,
            "revenue": rev or 0,
            "currency": (cur_ or "RON").upper(),
            "cogs": cogs or 0,
            "cogs_missing": cmiss or 0,
            "cat": SC_CAT.get(cat, "other"),
            "raw_cat": cat,
            "awb": awb,
            "skus": skus or "",
            "tags": tags or "",
        }
    return d, rates


async def load_awb(names):
    """AWB rows for the exact Scripturi order_name set + the sku_cost map + exclusions."""
    async with AsyncSessionLocal() as db:
        sku_costs = {
            r[0]: float(r[1] or 0)
            for r in (await db.execute(text("SELECT sku, cost FROM sku_costs"))).all()
        }
        excl = {
            r[0]
            for r in (
                await db.execute(
                    text(
                        "SELECT sku FROM products WHERE exclude_from_stock = true AND sku IS NOT NULL"
                    )
                )
            ).all()
        }
        for e in excl:
            sku_costs.pop(e, None)
        store = {
            r[0]: r[1]
            for r in (await db.execute(text("SELECT uid, name FROM stores"))).all()
        }
        rows = (
            await db.execute(
                text("""
            SELECT order_number, store_uid, total_price, currency, aggregated_status,
                   transport_cost, line_items
            FROM orders WHERE order_number = ANY(:names)
        """),
                {"names": list(names)},
            )
        ).all()
    out = {}
    for onum, suid, tp, cur_, agg, tcost, li in rows:
        cat = classify(agg)
        cogs = 0.0
        if cat == "delivered" and isinstance(li, list):
            for it in li:
                if isinstance(it, dict):
                    inv = it.get("inventory_item") or {}
                    sku = inv.get("sku") if isinstance(inv, dict) else None
                    if sku and sku in sku_costs:
                        cogs += sku_costs[sku] * int(it.get("quantity") or 1)
        out[onum] = {
            "store": store.get(suid, suid),
            "revenue": float(tp or 0),
            "currency": (cur_ or "RON").upper(),
            "cat": cat,
            "raw_status": agg,
            "transport_cost": float(tcost or 0),
            "cogs": round(cogs, 2),
        }
    return out, sku_costs


async def main():
    print(f"=== AWB vs Scripturi empirical audit — {MONTH} ===\n")
    sc, rates = load_scripturi(MONTH)
    print(f"Scripturi profit_orders: {len(sc):,} orders   FX→RON {rates}")
    awb, sku_costs = await load_awb(set(sc.keys()))
    print(
        f"AWB matched on order_number: {len(awb):,}   ({len(awb) / len(sc) * 100:.1f}% of Scripturi)\n"
    )

    matched = [n for n in sc if n in awb]
    sc_only = [n for n in sc if n not in awb]

    # --- match rate by prefix (universe / coverage) ---
    by_prefix = defaultdict(lambda: {"sc": 0, "matched": 0})
    for n, r in sc.items():
        by_prefix[r["prefix"]]["sc"] += 1
        if n in awb:
            by_prefix[r["prefix"]]["matched"] += 1
    print("Match rate by prefix (Scripturi -> found in AWB):")
    for p in sorted(by_prefix):
        b = by_prefix[p]
        print(
            f"  {p:<7} {b['matched']:>7,}/{b['sc']:>7,}  {b['matched'] / b['sc'] * 100:5.1f}%"
        )

    # --- status confusion matrix (matched orders) ---
    confusion = Counter()
    for n in matched:
        confusion[(awb[n]["cat"], sc[n]["cat"])] += 1
    cats = ["delivered", "returned", "cancelled", "in_transit", "other", "problems"]
    print("\nStatus confusion (rows=AWB, cols=Scripturi), matched orders:")
    print("           " + "".join(f"{c[:9]:>11}" for c in cats))
    for a in cats:
        line = f"  {a:<9}" + "".join(f"{confusion.get((a, s), 0):>11,}" for s in cats)
        print(line)
    status_disagree = sum(v for (a, s), v in confusion.items() if a != s)
    print(
        f"  -> status disagreements: {status_disagree:,} / {len(matched):,} "
        f"({status_disagree / len(matched) * 100:.2f}%)"
    )

    # --- revenue (native currency) on matched ---
    rev_mismatch = []
    for n in matched:
        a, s = awb[n], sc[n]
        if abs(a["revenue"] - s["revenue"]) > 0.01:
            rev_mismatch.append(
                (n, a["currency"], a["revenue"], s["currency"], s["revenue"])
            )
    print(
        f"\nRevenue (native) mismatches on matched: {len(rev_mismatch):,} / {len(matched):,}"
    )
    for r in rev_mismatch[:10]:
        print(f"   {r[0]:<12} AWB {r[2]:>10.2f} {r[1]}   SC {r[4]:>10.2f} {r[3]}")

    # --- COGS on matched DELIVERED orders (both compute delivered-only) ---
    cogs_rows = []
    for n in matched:
        a, s = awb[n], sc[n]
        if a["cat"] == "delivered" and s["cat"] == "delivered":
            cogs_rows.append((n, a["cogs"], s["cogs"], a["cogs"] - s["cogs"]))
    n_cogs = len(cogs_rows)
    exact = sum(1 for _, _, _, d in cogs_rows if abs(d) < 0.01)
    awb_zero_sc_pos = sum(1 for _, ac, scc, _ in cogs_rows if ac == 0 and scc > 0)
    sc_zero_awb_pos = sum(1 for _, ac, scc, _ in cogs_rows if scc == 0 and ac > 0)
    tot_awb_cogs = sum(ac for _, ac, _, _ in cogs_rows)
    tot_sc_cogs = sum(scc for _, _, scc, _ in cogs_rows)
    print(f"\nCOGS on both-delivered matched ({n_cogs:,} orders):")
    print(f"   exact(±0.01): {exact:,} ({exact / max(n_cogs, 1) * 100:.1f}%)")
    print(
        f"   AWB total COGS {tot_awb_cogs:,.0f}  vs  Scripturi {tot_sc_cogs:,.0f}  "
        f"(Δ {tot_awb_cogs - tot_sc_cogs:+,.0f})"
    )
    print(
        f"   AWB=0 but SC>0: {awb_zero_sc_pos:,}   SC=0 but AWB>0: {sc_zero_awb_pos:,}"
    )
    biggest = sorted(cogs_rows, key=lambda x: abs(x[3]), reverse=True)[:10]
    print("   biggest per-order COGS diffs (order, AWB, SC, Δ):")
    for n, ac, scc, d in biggest:
        print(
            f"     {n:<12} {ac:>9.2f} {scc:>9.2f} {d:>+9.2f}   skus={sc[n]['skus'][:40]}"
        )

    # --- delivered revenue in RON, per prefix (the P&L topline) ---
    def to_ron(v, cur_):
        return v * rates.get(cur_, 1.0)

    rev_ron = defaultdict(lambda: {"awb": 0.0, "sc": 0.0, "awb_n": 0, "sc_n": 0})
    for n in matched:
        a, s = awb[n], sc[n]
        if a["cat"] == "delivered":
            rev_ron[s["prefix"]]["awb"] += to_ron(a["revenue"], a["currency"])
            rev_ron[s["prefix"]]["awb_n"] += 1
        if s["cat"] == "delivered":
            rev_ron[s["prefix"]]["sc"] += to_ron(s["revenue"], s["currency"])
            rev_ron[s["prefix"]]["sc_n"] += 1
    print("\nDelivered revenue in RON (matched), per prefix:")
    ta = tsr = 0
    for p in sorted(rev_ron):
        b = rev_ron[p]
        ta += b["awb"]
        tsr += b["sc"]
        print(
            f"   {p:<7} AWB {b['awb']:>12,.0f} ({b['awb_n']:>6,})  SC {b['sc']:>12,.0f} ({b['sc_n']:>6,})  Δ{b['awb'] - b['sc']:>+11,.0f}"
        )
    print(
        f"   {'TOTAL':<7} AWB {ta:>12,.0f}            SC {tsr:>12,.0f}            Δ{ta - tsr:>+11,.0f}"
    )

    # --- dump JSON for downstream diagnostic agents ---
    dump = {
        "month": MONTH,
        "fx_rates": rates,
        "counts": {
            "scripturi": len(sc),
            "awb_matched": len(awb),
            "scripturi_only": len(sc_only),
            "matched": len(matched),
        },
        "match_by_prefix": {p: dict(b) for p, b in by_prefix.items()},
        "status_confusion": {f"{a}|{s}": v for (a, s), v in confusion.items()},
        "status_disagreements": status_disagree,
        "revenue_native_mismatches": len(rev_mismatch),
        "revenue_native_mismatch_sample": rev_mismatch[:30],
        "cogs": {
            "n_both_delivered": n_cogs,
            "exact": exact,
            "awb_total": round(tot_awb_cogs, 2),
            "sc_total": round(tot_sc_cogs, 2),
            "awb_zero_sc_pos": awb_zero_sc_pos,
            "sc_zero_awb_pos": sc_zero_awb_pos,
            "biggest_diffs": [
                {"order": n, "awb": ac, "sc": scc, "delta": d, "skus": sc[n]["skus"]}
                for n, ac, scc, d in biggest
            ],
        },
        "delivered_revenue_ron_by_prefix": {p: dict(b) for p, b in rev_ron.items()},
        "scripturi_only_sample": sc_only[:40],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nJSON dump -> {OUT}")


asyncio.run(main())
print("DONE")
