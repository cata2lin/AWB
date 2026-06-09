"""
Import Scripturi's BRAND-LEVEL daily ad spend (daily_perf.db) into AWB's existing
`marketing_daily_costs` table, so AWB's Daily-Performance dashboard can show
fb/tk spend + ROAS/CPA per brand/day (the audit's "no ad-spend" gap).

NOTE: this is a SEPARATE dataset from the per-SKU HA- ad-spend (that feeds the
product-profitability report via sku_ad_spend_daily). daily_perf.db is Scripturi's
all-brands brand-level spend (FB/TikTok), already in RON.

Source: c:/.../scripturi-vps/Scripturi/data/daily_perf.db
  daily_perf(date, brand, fb_spend, tk_spend, google_spend, ...)  -- RON, per brand/day
Target: AWB marketing_daily_costs(cost_date, store_name, facebook, tiktok, google)
  -- existing model, EMPTY in prod, no schema change. Unique (cost_date, store_name).

Brand→store mapping below; brands with no AWB store (Bonhaus SK, Esteban Parfum,
Nocturna CZ/HR/HU/PL/SK, Super Detergent) are reported and skipped (order-universe gap).

Run:
  cd backend && ./venv/Scripts/python.exe scratch/import_scripturi_daily_marketing.py            # DRY-RUN
  cd backend && ./venv/Scripts/python.exe scratch/import_scripturi_daily_marketing.py --apply
"""

import argparse
import asyncio
import csv
import sqlite3
import sys
from datetime import datetime, date, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.marketing_daily_cost import MarketingDailyCost  # noqa: E402

DP = Path(r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/daily_perf.db")
TMP = Path(r"c:/tmp")
MIN_DATE = "2026-01-01"  # import 2026 onward (daily-perf reports on recent months)

# Scripturi brand name -> AWB store name (Store.name == marketing_daily_costs.store_name)
BRAND_TO_STORE = {
    "Apreciat": "apreciat.ro",
    "Belasil": "belasil.ro",
    "Bonhaus RO": "bonhausro.ro",
    "Bonhaus BG": "bonhaus.bg",
    "Bonhaus CZ": "bonhaus.cz",
    "Bonhaus PL": "bonhaus.pl",
    "Carpetto": "carpetto.ro",
    "Ce Pat Ai": "cepatai.ro",
    "Covoria": "covoria.ro",
    "Esteban": "esteban.ro",
    "Gento": "gento.ro",
    "George Talent": "georgetalent.ro",
    "Magdeal": "magdeal.ro",
    "Nocturna": "nocturna.ro",
    "Nocturna BG": "nocturna.bg",
    "Nocturna Lux": "nocturnalux.ro",
    "Nubra": "nubra",
    "Ofertele Zilei": "ofertelezilei.ro",
    "Reduceri bune": "reduceribune.ro",
    "Rossi Nails": "rossinails.ro",
    "Genti Promo": "grandia.ro",
}


def load_scripturi():
    con = sqlite3.connect(DP)
    try:
        rows = con.execute(
            "SELECT date, brand, fb_spend, tk_spend, google_spend FROM daily_perf "
            "WHERE date >= ? AND (fb_spend>0 OR tk_spend>0 OR google_spend>0)",
            (MIN_DATE,),
        ).fetchall()
    finally:
        con.close()
    return rows


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument(
        "--gap-fill",
        action="store_true",
        help="only insert (date,store) rows that AWB is MISSING (don't overwrite AWB's own marketing_daily_costs)",
    )
    args = ap.parse_args()

    rows = load_scripturi()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    mapped, unmapped_brands = [], {}
    for d, brand, fb, tk, ggl in rows:
        store = BRAND_TO_STORE.get(brand)
        if not store:
            unmapped_brands[brand] = unmapped_brands.get(brand, 0) + 1
            continue
        mapped.append((d, store, fb or 0, tk or 0, ggl or 0))

    print("=" * 74)
    print("Scripturi daily_perf -> AWB marketing_daily_costs (brand-level ad spend)")
    print(f"  source rows (2026+, spend>0): {len(rows):,}")
    print(f"  mapped rows                 : {len(mapped):,}")
    print(
        f"  date span                   : {min(r[0] for r in mapped)} .. {max(r[0] for r in mapped)}"
    )
    print(
        f"  total FB {sum(r[2] for r in mapped):,.0f} RON  TK {sum(r[3] for r in mapped):,.0f} RON"
    )
    if unmapped_brands:
        print("  UNMAPPED brands (no AWB store — skipped, order-universe gap):")
        for b, n in sorted(unmapped_brands.items(), key=lambda x: -x[1]):
            print(f"     {b:<18} {n} days")

    async with AsyncSessionLocal() as db:
        awb_stores = {
            r[0] for r in (await db.execute(text("SELECT name FROM stores"))).all()
        }
        bad = sorted({s for (_, s, *_) in mapped if s not in awb_stores})
        if bad:
            print(
                f"  ⚠ mapped store_names NOT in AWB stores (spend imported but won't join): {bad}"
            )
        existing = (
            await db.execute(text("SELECT COUNT(*) FROM marketing_daily_costs"))
        ).scalar()
        print(f"  AWB marketing_daily_costs existing rows: {existing}")
        # per-store April FB/TK (verification anchor)
        print("\n  April-2026 mapped spend per store (top 8 by FB):")
        agg = {}
        for d, s, fb, tk, ggl in mapped:
            if d.startswith("2026-04"):
                a = agg.setdefault(s, [0, 0])
                a[0] += fb
                a[1] += tk
        for s, (fb, tk) in sorted(agg.items(), key=lambda x: -x[1][0])[:8]:
            print(f"     {s:<18} FB {fb:>10,.0f}  TK {tk:>9,.0f}")

        if not args.apply:
            print("\nDRY-RUN — no writes. Re-run with --apply.")
            return

        # ---- APPLY (collapse duplicate (date,store) e.g. casaofertelor folding not needed here) ----
        if existing:
            bak = TMP / f"marketing_daily_costs_backup_{ts}.csv"
            with open(bak, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["cost_date", "store_name", "facebook", "tiktok", "google"])
                for r in (
                    await db.execute(
                        text(
                            "SELECT cost_date, store_name, facebook, tiktok, google FROM marketing_daily_costs"
                        )
                    )
                ).all():
                    w.writerow(list(r))
            print(f"\n  backed up {existing} existing rows -> {bak}")

        now = datetime.utcnow()
        # merge duplicates per (date, store)
        merged = {}
        for d, s, fb, tk, ggl in mapped:
            a = merged.setdefault((d, s), [0.0, 0.0, 0.0])
            a[0] += fb
            a[1] += tk
            a[2] += ggl

        # GAP-FILL (STORE-LEVEL): only fill stores AWB has ZERO marketing rows for, so
        # AWB's own authoritative marketing (the "Raport Zilnic 2" sheet) is never
        # touched. We deliberately do NOT date-level gap-fill: a store AWB already
        # tracks differs from Scripturi by ~8% (different source), and filling AWB's
        # date-gaps with Scripturi rows would mix sources within one store. Only stores
        # entirely absent from AWB (e.g. nubra) get Scripturi's numbers.
        if args.gap_fill:
            have_stores = {
                r[0]
                for r in (
                    await db.execute(
                        text("SELECT DISTINCT store_name FROM marketing_daily_costs")
                    )
                ).all()
            }
            before = len(merged)
            merged = {(d, s): v for (d, s), v in merged.items() if s not in have_stores}
            fill_stores = sorted({s for (_, s) in merged})
            print(
                f"\n  GAP-FILL (store-level): kept {before - len(merged):,} rows for stores AWB "
                f"already tracks; inserting {len(merged):,} rows for ABSENT stores: {fill_stores or 'none'}"
            )

        applied = 0
        for (d, s), (fb, tk, ggl) in merged.items():
            stmt = (
                pg_insert(MarketingDailyCost.__table__)
                .values(
                    cost_date=date.fromisoformat(d),
                    store_name=s,
                    facebook=round(fb, 2),
                    tiktok=round(tk, 2),
                    google=round(ggl, 2),
                    source_sheet="scripturi_daily_perf",
                    synced_at=now,
                )
                .on_conflict_do_update(
                    index_elements=["cost_date", "store_name"],
                    set_={
                        "facebook": round(fb, 2),
                        "tiktok": round(tk, 2),
                        "google": round(ggl, 2),
                        "source_sheet": "scripturi_daily_perf",
                        "synced_at": now,
                    },
                )
            )
            await db.execute(stmt)
            applied += 1
        await db.commit()
        post = (
            await db.execute(
                text(
                    "SELECT COUNT(*), ROUND(SUM(facebook)::numeric,0), "
                    "ROUND(SUM(tiktok)::numeric,0) FROM marketing_daily_costs"
                )
            )
        ).first()
        print(
            f"  upserted {applied:,} (date,store) rows. table now {post[0]:,} rows, "
            f"FB {post[1]:,} RON, TK {post[2]:,} RON."
        )
        print("\nAPPLIED OK.")


if __name__ == "__main__":
    asyncio.run(main())
