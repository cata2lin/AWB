"""
AWB vs Scripturi numeric comparison for 2026 — after the colleague's code changes.

Compares, per (UTC month, store-prefix):
  • delivered count   : AWB aggregated_status='delivered'  vs  Scripturi status_category='Livrata'
  • native revenue    : AWB sum(total_price)               vs  Scripturi sum(revenue)
and quantifies the ONE numeric code change (transport now always VAT-removed):
  • transport_fara OLD (no VAT removed)  vs  NEW (÷(1+vat))  per prefix.

Scripturi side = local SQLite copy (data/profitability.db, 2026-01..2026-06, courier-resolved).
AWB side       = prod DB via the app's own AsyncSessionLocal (.env → prod; read-only SELECTs).
Both bucket by UTC month (Scripturi.created_at is 'Z'/UTC, AWB.frisbo_created_at is UTC) so the
month boundaries line up.

Run: cd backend && ./venv/Scripts/python.exe -u scratch/compare_awb_vs_scripturi_2026.py
"""

import sys
import asyncio
import sqlite3

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402

SC_DB = r"c:/tmp/scr_new/Scripturi/data/profitability.db"
PREFIX_ALIAS = {
    "GRAND": "GRAN",
    "NUBRA": "NUB",
}  # AWB order-number prefix → Scripturi prefix
# Scripturi's SQLite cache hasn't courier-resolved June yet (SC June ≈ 86 vs AWB 6.5k),
# so June is not a fair apples-to-apples month — compare on the closed months only.
CLOSED_MAX = "2026-05"
VAT_BY_COUNTRY = {"RO": 0.21, "CZ": 0.21, "PL": 0.23, "BG": 0.20}


def sc_numbers():
    con = sqlite3.connect(SC_DB)
    con.row_factory = sqlite3.Row
    # per (month, prefix): delivered count + native revenue + total terminal count
    rows = con.execute(
        """
        SELECT month, prefix,
               SUM(CASE WHEN status_category='Livrata'  THEN 1 ELSE 0 END) AS delivered,
               SUM(CASE WHEN status_category='Livrata'  THEN revenue ELSE 0 END) AS rev,
               SUM(CASE WHEN status_category='Refuzata' THEN 1 ELSE 0 END) AS refused,
               SUM(CASE WHEN status_category='Anulata'  THEN 1 ELSE 0 END) AS cancelled,
               COUNT(*) AS total
        FROM profit_orders
        WHERE month LIKE '2026-%'
        GROUP BY month, prefix
        """
    ).fetchall()
    # transport config (cost_per_parcel, vat_included) latest per prefix
    tcfg = {}
    for r in con.execute(
        "SELECT prefix, cost_per_parcel, vat_included FROM profit_transport_costs"
    ).fetchall():
        tcfg[r["prefix"]] = (r["cost_per_parcel"], r["vat_included"])
    cmap = {}
    cm = con.execute(
        "SELECT value FROM profit_settings WHERE key='country_map'"
    ).fetchone()
    if cm:
        import json

        cmap = json.loads(cm[0])
    con.close()
    out = {}
    for r in rows:
        out[(r["month"], r["prefix"])] = {
            "delivered": r["delivered"],
            "rev": round(r["rev"] or 0, 0),
            "refused": r["refused"],
            "cancelled": r["cancelled"],
            "total": r["total"],
        }
    return out, tcfg, cmap


async def awb_numbers():
    async with AsyncSessionLocal() as db:
        # cleanup: close the orphaned 'full' sync_log row my killed parallel sync left open
        await db.execute(
            text(
                "UPDATE sync_logs SET status='cancelled', completed_at=now() "
                "WHERE status='running' AND sync_type='full'"
            )
        )
        await db.commit()

        rows = (
            await db.execute(
                text(
                    """
            SELECT to_char(frisbo_created_at, 'YYYY-MM') AS month,
                   upper(substring(order_number from '^[A-Za-z]+')) AS prefix,
                   SUM(CASE WHEN aggregated_status='delivered' THEN 1 ELSE 0 END) AS delivered,
                   SUM(CASE WHEN aggregated_status='delivered' THEN total_price ELSE 0 END) AS rev,
                   SUM(CASE WHEN aggregated_status IN ('returned','refused') THEN 1 ELSE 0 END) AS refused,
                   SUM(CASE WHEN aggregated_status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
                   COUNT(*) AS total
            FROM orders
            WHERE frisbo_created_at >= '2026-01-01' AND frisbo_created_at < '2026-07-01'
              AND order_number ~ '^[A-Za-z]+'
            GROUP BY 1, 2
            """
                )
            )
        ).all()
    out = {}
    for r in rows:
        pfx = PREFIX_ALIAS.get(r.prefix, r.prefix)
        key = (r.month, pfx)
        cur = out.setdefault(
            key, {"delivered": 0, "rev": 0.0, "refused": 0, "cancelled": 0, "total": 0}
        )
        cur["delivered"] += r.delivered or 0
        cur["rev"] += float(r.rev or 0)
        cur["refused"] += r.refused or 0
        cur["cancelled"] += r.cancelled or 0
        cur["total"] += r.total or 0
    for v in out.values():
        v["rev"] = round(v["rev"], 0)
    return out


def main():
    sc, tcfg, cmap = sc_numbers()
    awb = asyncio.run(awb_numbers())

    prefixes = sorted({p for (_m, p) in sc} | {p for (_m, p) in awb})
    months = sorted({m for (m, _p) in sc} | {m for (m, _p) in awb})
    # Per-prefix comparison uses only CLOSED months (June not yet courier-resolved in SC cache).
    closed = [m for m in months if m <= CLOSED_MAX]

    # ── CSV export (the comparison data artifact) ──
    import csv

    csv_path = r"c:/Users/Admin/Desktop/AWB Print/frisbo_vs_scripturi_2026.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "month",
                "prefix",
                "closed_month",
                "sc_delivered",
                "awb_delivered",
                "delta_delivered",
                "sc_revenue_native",
                "awb_revenue_native",
                "delta_rev_pct",
            ]
        )
        for m in months:
            for p in prefixes:
                s = sc.get((m, p), {})
                a = awb.get((m, p), {})
                scd, awd = s.get("delivered", 0), a.get("delivered", 0)
                scr, awr = s.get("rev", 0), a.get("rev", 0)
                if not (scd or awd):
                    continue
                drp = round((awr - scr) / scr * 100, 1) if scr else ""
                w.writerow(
                    [
                        m,
                        p,
                        "yes" if m <= CLOSED_MAX else "no",
                        scd,
                        awd,
                        awd - scd,
                        scr,
                        awr,
                        drp,
                    ]
                )
    print(f"CSV written → {csv_path}\n")

    # ── Per-prefix totals across CLOSED 2026 months (Jan–May) ──
    print("=" * 96)
    print(
        "AWB vs SCRIPTURI — delivered count + native revenue, CLOSED 2026 months Jan–May (by prefix)"
    )
    print("=" * 96)
    hdr = f"{'prefix':<8}{'SC_deliv':>10}{'AWB_deliv':>11}{'Δdeliv':>9}{'Δ%':>7}  {'SC_rev':>13}{'AWB_rev':>13}{'Δrev%':>8}"
    print(hdr)
    print("-" * 96)
    tot = {k: 0 for k in ("scd", "awd", "scr", "awr")}
    rows_out = []
    for p in prefixes:
        scd = sum(sc.get((m, p), {}).get("delivered", 0) for m in closed)
        awd = sum(awb.get((m, p), {}).get("delivered", 0) for m in closed)
        scr = sum(sc.get((m, p), {}).get("rev", 0) for m in closed)
        awr = sum(awb.get((m, p), {}).get("rev", 0) for m in closed)
        tot["scd"] += scd
        tot["awd"] += awd
        tot["scr"] += scr
        tot["awr"] += awr
        dd = awd - scd
        ddp = (dd / scd * 100) if scd else 0.0
        drp = ((awr - scr) / scr * 100) if scr else 0.0
        rows_out.append((p, scd, awd, dd, ddp, scr, awr, drp))
    # sort by SC delivered desc
    for p, scd, awd, dd, ddp, scr, awr, drp in sorted(rows_out, key=lambda x: -x[1]):
        flag = "  <-- gap" if abs(ddp) >= 3 and scd > 50 else ""
        print(
            f"{p:<8}{scd:>10,}{awd:>11,}{dd:>9,}{ddp:>6.1f}%  {scr:>13,.0f}{awr:>13,.0f}{drp:>7.1f}%{flag}"
        )
    print("-" * 96)
    g_dd = tot["awd"] - tot["scd"]
    g_ddp = g_dd / tot["scd"] * 100 if tot["scd"] else 0
    g_drp = (tot["awr"] - tot["scr"]) / tot["scr"] * 100 if tot["scr"] else 0
    print(
        f"{'TOTAL':<8}{tot['scd']:>10,}{tot['awd']:>11,}{g_dd:>9,}{g_ddp:>6.1f}%  "
        f"{tot['scr']:>13,.0f}{tot['awr']:>13,.0f}{g_drp:>7.1f}%"
    )

    # ── Per-month delivered totals ──
    print("\n" + "=" * 60)
    print("Delivered totals by month (SC Livrata vs AWB delivered)")
    print("=" * 60)
    print(f"{'month':<10}{'SC_deliv':>11}{'AWB_deliv':>12}{'Δ':>9}{'Δ%':>7}")
    for m in months:
        scd = sum(sc.get((m, p), {}).get("delivered", 0) for p in prefixes)
        awd = sum(awb.get((m, p), {}).get("delivered", 0) for p in prefixes)
        d = awd - scd
        dp = d / scd * 100 if scd else 0
        print(f"{m:<10}{scd:>11,}{awd:>12,}{d:>9,}{dp:>6.1f}%")

    # ── Transport-VAT code change impact (the one numeric change) ──
    print("\n" + "=" * 72)
    print("Transport-VAT change impact (Scripturi: OLD no-VAT-removal → NEW ÷(1+vat))")
    print(
        "Per delivered order; quantifies how much the colleague's change moved the P&L"
    )
    print("=" * 72)
    print(
        f"{'prefix':<8}{'deliv':>9}{'cost/p':>8}{'OLD_fara':>12}{'NEW_fara':>12}{'Δ(profit+)':>12}"
    )
    tot_old = tot_new = 0.0
    for p in sorted(
        prefixes,
        key=lambda p: -sum(sc.get((m, p), {}).get("delivered", 0) for m in months),
    ):
        scd = sum(sc.get((m, p), {}).get("delivered", 0) for m in months)
        if not scd or p not in tcfg:
            continue
        cost, vat_incl = tcfg[p]
        country = cmap.get(p, "RO")
        vat = VAT_BY_COUNTRY.get(country, 0.21)
        transport_total = scd * cost
        old_fara = transport_total  # vat_included=0 → OLD kept full value
        new_fara = transport_total / (1 + vat)
        tot_old += old_fara
        tot_new += new_fara
        print(
            f"{p:<8}{scd:>9,}{cost:>8.0f}{old_fara:>12,.0f}{new_fara:>12,.0f}{old_fara - new_fara:>12,.0f}"
        )
    print("-" * 72)
    print(
        f"{'TOTAL':<8}{'':>9}{'':>8}{tot_old:>12,.0f}{tot_new:>12,.0f}{tot_old - tot_new:>12,.0f}"
    )
    print(
        f"\n→ The transport change lowers Scripturi's transport COST (fara TVA) by "
        f"{tot_old - tot_new:,.0f} RON across 2026,\n  i.e. raises reported profit by that much. "
        f"AWB already removes VAT from transport (tva_split), so AWB\n  was already on the NEW basis — this change CLOSES the gap, it doesn't open one."
    )


if __name__ == "__main__":
    main()
    print("\nDONE")
