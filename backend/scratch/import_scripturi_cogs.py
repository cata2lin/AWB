"""
Import COGS from the Scripturi program into AWB `sku_costs`, overriding existing.

Source (local SQLite copies of the Scripturi VPS data):
  - data/profitability.db    -> profit_cogs_override (sku, unit_cost, currency)  [AUTHORITATIVE manual overrides]
  - data/product_analytics.db-> analytics_products   (sku, prefix, cost, currency, title, updated_at)  [Shopify unitCost cache, per store]
  - data/profitability.db    -> profit_exchange_rates(month, currency, rate_to_ron)                     [Scripturi's own FX]

Why this shape:
  AWB `sku_costs` is GLOBAL per `sku` (unique) and the P&L treats `cost` as RON (it ignores the currency column).
  Scripturi stores cost per (sku, store-prefix) and in the store's currency, so we must (a) resolve one cost per SKU
  and (b) convert foreign currencies to RON using Scripturi's rates so the numbers match Scripturi exactly.

Conflict resolution (when a SKU has differing costs across stores):
  1. profit_cogs_override wins outright (manual, authoritative).
  2. else pick the row with the most recent updated_at (freshest Shopify sync).
  3. tie-break: highest RON cost (conservative — never understates COGS).

Run:
  cd backend && ./venv/Scripts/python.exe scratch/import_scripturi_cogs.py            # DRY-RUN (no writes)
  cd backend && ./venv/Scripts/python.exe scratch/import_scripturi_cogs.py --apply    # backup + upsert into prod
"""

import argparse
import asyncio
import csv
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.sku_cost import SkuCost  # noqa: E402

# Location of the local Scripturi data copy. Override with env SCR_DATA_DIR to point at a
# fresher pull (e.g. c:/tmp/scr_new/Scripturi/data after a re-pull from the VPS).
import os  # noqa: E402

SCR_DATA = Path(
    os.environ.get(
        "SCR_DATA_DIR", r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data"
    )
)
TMP = Path(r"c:/tmp")


def load_exchange_rates(prof_db: Path) -> dict:
    """{currency: rate_to_ron} from the most recent month present. RON is always 1.0."""
    con = sqlite3.connect(prof_db)
    try:
        latest = con.execute("SELECT MAX(month) FROM profit_exchange_rates").fetchone()[
            0
        ]
        rows = con.execute(
            "SELECT currency, rate_to_ron FROM profit_exchange_rates WHERE month=?",
            (latest,),
        ).fetchall()
    finally:
        con.close()
    rates = {c.upper(): float(r) for c, r in rows}
    rates["RON"] = 1.0
    return rates, latest


def to_ron(cost: float, currency: str, rates: dict) -> tuple[float, bool]:
    """Return (ron_cost, was_converted).

    VERIFIED 2026-06-04: the Scripturi `cost` amount is ALWAYS the merchant's RON procurement
    cost; the `currency` column only reflects the Shopify store's *display* currency (EUR/CZK/PLN
    for foreign stores). Every foreign-currency row's raw amount equals AWB's existing RON cost
    exactly, and none match amount*rate. So we NEVER convert — we take the amount as RON.
    Converting would have 5x-inflated COGS for ~137 SKUs and corrupted the P&L.
    """
    return round(cost, 4), False


def build_scripturi_cogs(rates: dict):
    """Resolve one RON cost per SKU. Returns (resolved: dict[sku]->info, stats)."""
    prof_db = SCR_DATA / "profitability.db"
    pa_db = SCR_DATA / "product_analytics.db"

    # 1) Authoritative manual overrides
    overrides = {}
    con = sqlite3.connect(prof_db)
    try:
        for sku, unit_cost, currency in con.execute(
            "SELECT sku, unit_cost, currency FROM profit_cogs_override WHERE unit_cost>0"
        ):
            ron, conv = to_ron(float(unit_cost), currency, rates)
            overrides[sku] = {
                "cost": ron,
                "src": "override",
                "prefix": None,
                "orig_cur": (currency or "RON").upper(),
                "converted": conv,
                "title": None,
            }
    finally:
        con.close()

    # titles lookup
    titles = {}
    con = sqlite3.connect(prof_db)
    try:
        for sku, title in con.execute(
            "SELECT sku, title FROM profit_sku_titles WHERE title<>''"
        ):
            titles[sku] = title
    finally:
        con.close()

    # 2) Per-store Shopify cost cache; group rows by sku
    con = sqlite3.connect(pa_db)
    by_sku = {}
    try:
        for sku, prefix, cost, currency, title, updated_at in con.execute(
            "SELECT sku, prefix, cost, currency, title, updated_at FROM analytics_products WHERE cost>0"
        ):
            ron, conv = to_ron(float(cost), currency, rates)
            by_sku.setdefault(sku, []).append(
                {
                    "prefix": prefix,
                    "cost": ron,
                    "orig_cur": (currency or "RON").upper(),
                    "converted": conv,
                    "title": title or "",
                    "updated_at": updated_at or "",
                }
            )
    finally:
        con.close()

    resolved = {}
    conflicts = []
    for sku, rows in by_sku.items():
        if sku in overrides:
            continue  # override already wins; we still record its title below
        distinct_costs = {round(r["cost"], 2) for r in rows}
        # rule 2: most recent updated_at, rule 3 tie-break: highest cost
        best = sorted(rows, key=lambda r: (r["updated_at"], r["cost"]), reverse=True)[0]
        info = {
            "cost": best["cost"],
            "src": f"store:{best['prefix']}",
            "prefix": best["prefix"],
            "orig_cur": best["orig_cur"],
            "converted": best["converted"],
            "title": best["title"] or titles.get(sku),
        }
        resolved[sku] = info
        if len(distinct_costs) > 1:
            conflicts.append(
                {
                    "sku": sku,
                    "chosen": best["cost"],
                    "chosen_prefix": best["prefix"],
                    "all": "; ".join(
                        f"{r['prefix']}={r['cost']}{r['orig_cur']}@{r['updated_at'][:10]}"
                        for r in sorted(
                            rows, key=lambda x: x["updated_at"], reverse=True
                        )
                    ),
                }
            )

    # merge overrides (they win) and attach titles
    for sku, info in overrides.items():
        info["title"] = titles.get(sku) or (
            by_sku.get(sku, [{}])[0].get("title") if by_sku.get(sku) else None
        )
        resolved[sku] = info

    stats = {
        "override_skus": len(overrides),
        "store_skus": len(by_sku),
        "resolved_total": len(resolved),
        "conflicts": conflicts,
        "converted": sum(1 for i in resolved.values() if i["converted"]),
    }
    return resolved, stats


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply",
        action="store_true",
        help="back up + write to AWB sku_costs (default: dry-run)",
    )
    args = ap.parse_args()

    rates, fx_month = load_exchange_rates(SCR_DATA / "profitability.db")
    resolved, stats = build_scripturi_cogs(rates)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    print("=" * 78)
    print(f"Scripturi -> AWB COGS import   (FX month {fx_month}: {rates})")
    print(f"  manual overrides       : {stats['override_skus']}")
    print(f"  store cost-cache SKUs   : {stats['store_skus']}")
    print(f"  resolved (one per SKU)  : {stats['resolved_total']}")
    print(f"  currency-converted->RON : {stats['converted']}")
    print(
        f"  cross-store conflicts   : {len(stats['conflicts'])} (resolved by freshest sync, tie=highest)"
    )

    async with AsyncSessionLocal() as db:
        existing = {}
        for sku, name, cost, cur in (
            await db.execute(text("SELECT sku, name, cost, currency FROM sku_costs"))
        ).all():
            existing[sku] = {"name": name, "cost": float(cost or 0), "currency": cur}

        inserts, updates, unchanged = [], [], 0
        for sku, info in resolved.items():
            new_cost = round(info["cost"], 2)
            if sku not in existing:
                inserts.append((sku, info, new_cost))
            elif (
                abs(existing[sku]["cost"] - new_cost) > 0.005
                or existing[sku]["currency"] != "RON"
            ):
                updates.append((sku, info, new_cost, existing[sku]["cost"]))
            else:
                unchanged += 1

        print(f"\n  AWB existing sku_costs  : {len(existing)}")
        print(f"  -> NEW inserts          : {len(inserts)}")
        print(f"  -> cost OVERRIDES       : {len(updates)}")
        print(f"  -> unchanged            : {unchanged}")

        # write reports
        TMP.mkdir(exist_ok=True)
        conf_path = TMP / f"cogs_import_conflicts_{ts}.csv"
        with open(conf_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["sku", "chosen_cost_ron", "chosen_prefix", "all_store_costs"])
            for c in stats["conflicts"]:
                w.writerow([c["sku"], c["chosen"], c["chosen_prefix"], c["all"]])
        diff_path = TMP / f"cogs_import_diff_{ts}.csv"
        with open(diff_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "action",
                    "sku",
                    "old_cost_ron",
                    "new_cost_ron",
                    "orig_cur",
                    "src",
                    "title",
                ]
            )
            for sku, info, nc in inserts:
                w.writerow(
                    [
                        "insert",
                        sku,
                        "",
                        nc,
                        info["orig_cur"],
                        info["src"],
                        info["title"] or "",
                    ]
                )
            for sku, info, nc, oc in updates:
                w.writerow(
                    [
                        "override",
                        sku,
                        oc,
                        nc,
                        info["orig_cur"],
                        info["src"],
                        info["title"] or "",
                    ]
                )
        print(f"\n  reports: {diff_path}\n           {conf_path}")

        print("\n  sample OVERRIDES (old -> new RON):")
        for sku, info, nc, oc in updates[:12]:
            print(
                f"    {sku:<24} {oc:>8.2f} -> {nc:>8.2f}   [{info['src']}, {info['orig_cur']}]"
            )
        print("\n  sample NEW inserts:")
        for sku, info, nc in inserts[:8]:
            print(
                f"    {sku:<24} {nc:>8.2f}   [{info['src']}, {info['orig_cur']}]  {(info['title'] or '')[:40]}"
            )
        if stats["conflicts"]:
            print("\n  sample CONFLICTS (chose freshest):")
            for c in stats["conflicts"][:8]:
                print(
                    f"    {c['sku']:<14} -> {c['chosen']} ({c['chosen_prefix']})   from: {c['all'][:90]}"
                )

        if not args.apply:
            print("\nDRY-RUN — no writes. Re-run with --apply to back up + write.")
            return

        # ---- APPLY ----
        backup_tbl = f"sku_costs_backup_{ts}"
        print(f"\nAPPLY: backing up sku_costs -> table {backup_tbl} ...")
        await db.execute(
            text(f'CREATE TABLE "{backup_tbl}" AS SELECT * FROM sku_costs')
        )
        bak_csv = TMP / f"{backup_tbl}.csv"
        with open(bak_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["sku", "name", "cost", "currency"])
            for sku, e in existing.items():
                w.writerow([sku, e["name"], e["cost"], e["currency"]])
        print(f"       CSV backup -> {bak_csv}")

        now = datetime.utcnow()
        applied = 0
        for sku, info in resolved.items():
            new_cost = round(info["cost"], 2)
            ex = existing.get(sku)
            # preserve a curated existing name; only fill blanks from Scripturi
            name = ex["name"] if ex and ex.get("name") else (info["title"] or None)
            stmt = (
                pg_insert(SkuCost.__table__)
                .values(
                    sku=sku,
                    name=name,
                    cost=new_cost,
                    currency="RON",
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    index_elements=["sku"],
                    set_={
                        "cost": new_cost,
                        "currency": "RON",
                        "updated_at": now,
                        "name": text(
                            "COALESCE(NULLIF(sku_costs.name,''), EXCLUDED.name)"
                        ),
                    },
                )
            )
            await db.execute(stmt)
            applied += 1
        await db.commit()
        post_nz = (
            await db.execute(text("SELECT COUNT(*) FROM sku_costs WHERE cost>0"))
        ).scalar()
        post_tot = (await db.execute(text("SELECT COUNT(*) FROM sku_costs"))).scalar()
        print(
            f"       upserted {applied} SKUs. sku_costs now {post_tot} rows ({post_nz} cost>0)."
        )
        print(f"       rollback if needed: INSERT ... FROM {backup_tbl}")
        print("\nAPPLIED OK.")


if __name__ == "__main__":
    asyncio.run(main())
