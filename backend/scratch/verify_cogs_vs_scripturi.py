"""
Verify AWB per-SKU COGS vs the FRESH Scripturi cost source, weighted by May units.

Builds the Scripturi cost map (profit_cogs_override + analytics_products, same resolution
as import_scripturi_cogs) from the fresh pull, compares to AWB sku_costs, and weights each
SKU's cost delta by its May units (from Scripturi analytics_sales) to show the real COGS impact.

Run: cd backend && SCR_DATA_DIR=c:/tmp/scr_new/Scripturi/data ./venv/Scripts/python.exe -u scratch/verify_cogs_vs_scripturi.py
"""

import os
import sys
import sqlite3
import asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

os.environ.setdefault("SCR_DATA_DIR", r"c:/tmp/scr_new/Scripturi/data")
SCR = os.environ["SCR_DATA_DIR"]

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from scratch.import_scripturi_cogs import load_exchange_rates, build_scripturi_cogs  # noqa: E402
from pathlib import Path  # noqa: E402


def may_units():
    """Scripturi units sold per SKU in May (analytics_sales)."""
    con = sqlite3.connect(f"{SCR}/product_analytics.db")
    try:
        rows = con.execute(
            "SELECT sku, SUM(qty_sold) FROM analytics_sales WHERE date LIKE '2026-05%' GROUP BY sku"
        ).fetchall()
    finally:
        con.close()
    return {s: (u or 0) for s, u in rows}


async def main():
    rates, fx_month = load_exchange_rates(Path(SCR) / "profitability.db")
    sc, stats = build_scripturi_cogs(rates)  # {sku: {cost, src, ...}}
    units = may_units()

    async with AsyncSessionLocal() as db:
        awb = {}
        for sku, cost in (
            await db.execute(text("SELECT sku, cost FROM sku_costs"))
        ).all():
            awb[sku] = float(cost or 0)

    only_sc = [s for s in sc if s not in awb]
    only_awb = [s for s in awb if s not in sc]
    common = [s for s in sc if s in awb]

    diffs = []
    for s in common:
        a, b = awb[s], round(sc[s]["cost"], 2)
        if abs(a - b) > 0.005:
            diffs.append((s, a, b, b - a, units.get(s, 0)))

    # weighted COGS impact (May): sum over diffs of (sc_cost - awb_cost) * may_units
    impact = sum(
        (b - a) * u
        for _s, a, b, _d, u in [
            (s, awb[s], round(sc[s]["cost"], 2), 0, units.get(s, 0))
            for s in common
            if abs(awb[s] - round(sc[s]["cost"], 2)) > 0.005
        ]
    )

    print("=" * 78)
    print(f"AWB sku_costs vs FRESH Scripturi cost map  (FX month {fx_month})")
    print("=" * 78)
    print(
        f"Scripturi resolved SKUs : {len(sc):,}  (overrides {stats['override_skus']}, store-cache {stats['store_skus']})"
    )
    print(f"AWB sku_costs SKUs      : {len(awb):,}")
    print(f"  common                : {len(common):,}")
    print(f"  only in Scripturi     : {len(only_sc):,}  (would be NEW inserts)")
    print(f"  only in AWB           : {len(only_awb):,}  (AWB has, SC doesn't)")
    print(f"  cost DIFFERS (>0.01)  : {len(diffs):,}")
    print()
    print(
        f"May COGS impact of the cost differences (SC − AWB)×units : {impact:,.0f} RON"
    )
    print(
        f"  (positive = AWB currently UNDER-counts vs Scripturi; override raises AWB COGS)"
    )
    print()
    # biggest impact diffs
    diffs_by_impact = sorted(diffs, key=lambda x: -abs(x[3] * x[4]))
    print(
        "Top cost differences by May-units impact (sku: AWB→SC, Δunit, units, Δcogs):"
    )
    for s, a, b, d, u in diffs_by_impact[:20]:
        print(
            f"  {s:<26} {a:>8.2f} → {b:>8.2f}  Δ{d:>+7.2f} × {u:>5} u = {d * u:>+10.0f}"
        )
    print()
    print("Sample SKUs only in Scripturi (new costs AWB lacks), by May units:")
    for s in sorted(only_sc, key=lambda s: -units.get(s, 0))[:10]:
        print(f"  {s:<26} cost={sc[s]['cost']:>8.2f}  units={units.get(s, 0)}")


if __name__ == "__main__":
    asyncio.run(main())
    print("\nDONE")
