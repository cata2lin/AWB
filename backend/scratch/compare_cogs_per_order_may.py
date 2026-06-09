"""
Per-order COGS comparison, MAY 2026 delivered: AWB computed (line_items × sku_costs,
post-override) vs Scripturi profit_orders.cogs. Categorizes every difference by cause.

Run: cd backend && ./venv/Scripts/python.exe -u scratch/compare_cogs_per_order_may.py
"""

import sys
import sqlite3
import asyncio

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402

SC_DB = r"c:/tmp/scr_new/Scripturi/data/profitability.db"


async def awb_per_order():
    sql = text(
        """
        SELECT o.order_number,
               COALESCE(SUM(COALESCE(sc.cost,0) * COALESCE((e->>'quantity')::numeric,1))
                        FILTER (WHERE e->'inventory_item'->>'sku' IS NOT NULL), 0) AS cogs,
               COUNT(e) AS n_lines,
               COUNT(*) FILTER (WHERE e IS NOT NULL
                                AND e->'inventory_item'->>'sku' IS NOT NULL
                                AND sc.cost IS NULL) AS n_missing
        FROM orders o
        LEFT JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(o.line_items::jsonb)='array' THEN o.line_items::jsonb ELSE '[]'::jsonb END
        ) e ON true
        LEFT JOIN sku_costs sc ON sc.sku = (e->'inventory_item'->>'sku')
        WHERE o.aggregated_status='delivered'
          AND o.frisbo_created_at >= '2026-05-01' AND o.frisbo_created_at < '2026-06-01'
        GROUP BY o.order_number
        """
    )
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(sql)).all()
    return {r.order_number: (float(r.cogs), r.n_lines, r.n_missing) for r in rows}


def sc_per_order():
    con = sqlite3.connect(SC_DB)
    try:
        rows = con.execute(
            "SELECT order_name, cogs, cogs_missing FROM profit_orders "
            "WHERE month='2026-05' AND status_category='Livrata'"
        ).fetchall()
    finally:
        con.close()
    return {n: (float(c or 0), int(cm or 0)) for n, c, cm in rows}


async def main():
    awb = await awb_per_order()
    sc = sc_per_order()
    print(f"AWB May delivered orders : {len(awb):,}")
    print(f"SC  May delivered orders : {len(sc):,}")

    both = set(awb) & set(sc)
    only_awb = set(awb) - set(sc)
    only_sc = set(sc) - set(awb)

    awb_cogs_total = sum(v[0] for v in awb.values())
    sc_cogs_total = sum(v[0] for v in sc.values())
    print(f"\nAWB total COGS (recomputed): {awb_cogs_total:,.0f}")
    print(f"SC  total COGS            : {sc_cogs_total:,.0f}")
    print(f"Δ (AWB − SC)              : {awb_cogs_total - sc_cogs_total:,.0f}")

    # categorize the matched-order differences
    eq = 0
    awb_empty_sc_has = []  # AWB 0 cogs / empty line_items, SC has cogs
    awb_missing = []  # AWB has lines but missing cost on some
    qty_or_other = []  # both have cogs, differ
    diff_sum = 0.0
    empty_sum = 0.0
    for on in both:
        ac, nlines, nmiss = awb[on]
        scc, scmiss = sc[on]
        d = ac - scc
        if abs(d) <= 0.5:
            eq += 1
            continue
        diff_sum += d
        if nlines == 0 and scc > 0:
            awb_empty_sc_has.append((on, scc))
            empty_sum += scc
        elif nmiss > 0:
            awb_missing.append((on, ac, scc, d))
        else:
            qty_or_other.append((on, ac, scc, d))

    print("\n── Matched orders (in both) ──")
    print(f"  COGS equal (±0.5)             : {eq:,}")
    print(
        f"  differ                        : {len(both) - eq:,}   (net Δ {diff_sum:,.0f})"
    )
    print(
        f"    • AWB empty line_items, SC has COGS : {len(awb_empty_sc_has):,}  (AWB misses {empty_sum:,.0f} RON)"
    )
    print(f"    • AWB missing a SKU cost            : {len(awb_missing):,}")
    print(f"    • qty/other value diff              : {len(qty_or_other):,}")

    print("\n── Orders only in one system (May delivered) ──")
    print(
        f"  only AWB-delivered : {len(only_awb):,}  (AWB COGS {sum(awb[o][0] for o in only_awb):,.0f}) — AWB delivered, SC not"
    )
    print(
        f"  only SC-delivered  : {len(only_sc):,}  (SC COGS {sum(sc[o][0] for o in only_sc):,.0f}) — SC delivered, AWB not"
    )

    print("\n  sample AWB-empty-li / SC-has-COGS:")
    for on, scc in sorted(awb_empty_sc_has, key=lambda x: -x[1])[:8]:
        print(f"    {on:<14} SC cogs={scc:.2f}, AWB=0 (no line_items)")
    print("  sample qty/other diffs:")
    for on, ac, scc, d in sorted(qty_or_other, key=lambda x: -abs(x[3]))[:8]:
        print(f"    {on:<14} AWB={ac:.2f} SC={scc:.2f} Δ{d:+.2f}")


if __name__ == "__main__":
    asyncio.run(main())
    print("\nDONE")
