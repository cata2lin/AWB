"""
Fix AWB sku_costs where the cache-import chose a cost Scripturi RARELY applies.

AWB sku_costs is one global cost per SKU, but the same SKU can carry different per-store
costs and Scripturi applies the store's own. The cache import collapsed each SKU to one
value and, on a cross-store tie, kept the HIGHEST — sometimes an outlier Scripturi almost
never uses (e.g. `fata-masa-rotunda` → 33.0, but Scripturi applies 11.58 in 434 orders vs
33.0 in just 2).

Ground truth = the distribution of Scripturi's own per-order COGS on SINGLE-SKU delivered
orders (cogs = unit_cost × qty; the qty=1 cases reveal the unit cost). We override AWB ONLY
when its current cost is a RARE value (applied in <RARE_SHARE of orders) AND a clear DOMINANT
unit cost exists (>=DOM_SHARE). This fixes genuine import-outlier errors without disturbing
SKUs whose AWB cost is a legitimate (even if not most-common) per-store value.

Run: cd backend && ./venv/Scripts/python.exe -u scratch/override_cogs_dominant.py [--apply]
"""

import sys
import csv
import argparse
import sqlite3
import asyncio
from datetime import datetime, timezone
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402

SCR = r"c:/tmp/scr_new/Scripturi/data"
MIN_SUPPORT = 8  # need >= this many single-SKU delivered orders
RARE_SHARE = 0.05  # AWB's cost is applied in < 5% of orders -> suspect
DOM_SHARE = 0.30  # a single unit cost dominates >= 30% of orders
TMP = r"c:/tmp"


def near(a, b):
    return abs(a - b) <= max(0.02, abs(b) * 0.01)


def sc_cogs_histograms():
    pa = sqlite3.connect(f"{SCR}/product_analytics.db")
    prof = sqlite3.connect(f"{SCR}/profitability.db")
    try:
        by_order = defaultdict(set)
        for o, s in pa.execute(
            "SELECT order_name, sku FROM analytics_order_lines WHERE sku<>''"
        ):
            by_order[o].add(s)
        single = {o: next(iter(s)) for o, s in by_order.items() if len(s) == 1}
        cogs_by_order = {}
        for o, c in prof.execute(
            "SELECT order_name, cogs FROM profit_orders WHERE status_category='Livrata' AND cogs>0"
        ):
            cogs_by_order[o] = round(float(c), 2)
    finally:
        pa.close()
        prof.close()
    hist = defaultdict(Counter)
    for o, sku in single.items():
        c = cogs_by_order.get(o)
        if c:
            hist[sku][c] += 1
    # cached per-store unit costs — the dominant must match one of these to be a real
    # unit cost (not a qty-multiple from a SKU that's only ever sold in packs, like grandia).
    pa2 = sqlite3.connect(f"{SCR}/product_analytics.db")
    cache = defaultdict(set)
    try:
        for sku, cost in pa2.execute(
            "SELECT sku, cost FROM analytics_products WHERE cost>0"
        ):
            cache[sku].add(round(float(cost), 2))
    finally:
        pa2.close()
    return hist, cache


def may_units():
    con = sqlite3.connect(f"{SCR}/product_analytics.db")
    try:
        rows = con.execute(
            "SELECT sku, SUM(qty_sold) FROM analytics_sales WHERE date LIKE '2026-05%' GROUP BY sku"
        ).fetchall()
    finally:
        con.close()
    return {s: (u or 0) for s, u in rows}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    hist, cache = sc_cogs_histograms()
    units = may_units()
    async with AsyncSessionLocal() as db:
        awb = {
            sku: float(cost or 0)
            for sku, cost in (
                await db.execute(text("SELECT sku, cost FROM sku_costs"))
            ).all()
        }

    cands = []
    for sku, counter in hist.items():
        if sku not in awb:
            continue
        total = sum(counter.values())
        if total < MIN_SUPPORT:
            continue
        # dominant unit cost = the SMALLEST cogs value among the high-count ones
        # (qty=1 of the dominant store); guards against a qty=2 value winning by count.
        high = [(v, c) for v, c in counter.items() if c >= DOM_SHARE * total]
        if not high:
            continue
        dom_cost = min(v for v, _c in high)
        dom_share = sum(c for v, c in counter.items() if near(v, dom_cost)) / total
        awb_cost = awb[sku]
        awb_share = sum(c for v, c in counter.items() if near(v, awb_cost)) / total
        # The dominant must be a REAL cached unit cost — else it's a qty-multiple from a
        # pack-only SKU (e.g. grandia GD-* sold in 2s/3s) and AWB's unit cost is correct.
        dom_in_cache = any(near(dom_cost, cv) for cv in cache.get(sku, ()))
        if (
            awb_share < RARE_SHARE
            and dom_share >= DOM_SHARE
            and dom_in_cache
            and not near(awb_cost, dom_cost)
            and abs(awb_cost - dom_cost) > max(0.10, awb_cost * 0.02)
        ):
            cands.append(
                (
                    sku,
                    awb_cost,
                    dom_cost,
                    awb_share,
                    dom_share,
                    total,
                    units.get(sku, 0),
                )
            )

    cands.sort(key=lambda x: -abs((x[2] - x[1]) * x[6]))
    may_impact = sum((dom - old) * u for _s, old, dom, _as, _ds, _t, u in cands)

    print("=" * 92)
    print(
        "AWB sku_costs fix — only SKUs where AWB's cost is RARELY applied by Scripturi"
    )
    print("=" * 92)
    print(
        f"SKUs with single-SKU support >= {MIN_SUPPORT} : {sum(1 for s, c in hist.items() if sum(c.values()) >= MIN_SUPPORT):,}"
    )
    print(
        f"Outlier overrides (AWB share <{RARE_SHARE:.0%}, dominant >={DOM_SHARE:.0%}) : {len(cands):,}"
    )
    print(f"May COGS impact (dominant−AWB)×units : {may_impact:,.0f} RON\n")
    print(
        f"{'sku':<28}{'AWB':>8}{'→dom':>8}{'AWBshr':>8}{'domShr':>8}{'n':>6}{'units':>7}{'Δcogs':>9}"
    )
    for sku, old, dom, ashr, dshr, n, u in cands:
        print(
            f"{sku:<28}{old:>8.2f}{dom:>8.2f}{ashr:>7.1%}{dshr:>8.1%}{n:>6}{u:>7}{(dom - old) * u:>9.0f}"
        )

    path = f"{TMP}/cogs_dominant_fix_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "sku",
                "awb_cost",
                "dominant_cost",
                "awb_share",
                "dom_share",
                "support_orders",
                "may_units",
            ]
        )
        for sku, old, dom, ashr, dshr, n, u in cands:
            w.writerow([sku, old, dom, round(ashr, 3), round(dshr, 3), n, u])
    print(f"\nfull list → {path}")

    if not args.apply:
        print("\nDRY-RUN — re-run with --apply to write.")
        return
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        for sku, old, dom, ashr, dshr, n, u in cands:
            await db.execute(
                text("UPDATE sku_costs SET cost=:c, updated_at=:t WHERE sku=:s"),
                {"c": dom, "t": now, "s": sku},
            )
        await db.commit()
    print(f"\nAPPLIED {len(cands)} outlier-cost fixes.")


if __name__ == "__main__":
    asyncio.run(main())
    print("\nDONE")
