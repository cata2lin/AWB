"""
Import per-SKU daily Facebook/TikTok ad spend from Scripturi into AWB
`sku_ad_spend_daily`, so AWB's per-SKU profitability report shows the same marketing
line Scripturi does (its table was empty → AWB's marketing was always 0).

Source (local SQLite copy of the Scripturi VPS data, product_analytics.db):
  - analytics_fb_spend_daily(date, sku, amount_usd)   2026-03-17 →
  - analytics_tk_spend_daily(date, sku, amount_usd)   2026-05-15 →

Conversion: USD → RON at a FIXED 4.55 (Scripturi's only USD source — its report path
uses 4.55; AWB's BNR feed has no USD). Stored DAILY so the endpoint can sum the exact
spend over any window, matching Scripturi's date-range mode (not a monthly pro-rate).

Idempotent: upsert keyed on (date, sku). Re-running re-imports the latest Scripturi
numbers. Backs up existing rows to CSV before --apply.

Run:
  cd backend && ./venv/Scripts/python.exe scratch/import_scripturi_marketing.py            # DRY-RUN
  cd backend && ./venv/Scripts/python.exe scratch/import_scripturi_marketing.py --apply    # write prod
"""

import argparse
import asyncio
import csv
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, date, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.sku_ad_spend_daily import SkuAdSpendDaily  # noqa: E402

PA = Path(r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/product_analytics.db")
USD_TO_RON = 4.55  # Scripturi's only USD source; AWB BNR has no USD. Frozen by design.
TMP = Path(r"c:/tmp")

DDL = """
CREATE TABLE IF NOT EXISTS sku_ad_spend_daily (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    sku VARCHAR(100) NOT NULL,
    amount_fb_ron DOUBLE PRECISION DEFAULT 0,
    amount_tk_ron DOUBLE PRECISION DEFAULT 0,
    CONSTRAINT uq_sku_ad_spend_date_sku UNIQUE (date, sku)
);
CREATE INDEX IF NOT EXISTS ix_sku_ad_spend_daily_sku ON sku_ad_spend_daily (sku);
CREATE INDEX IF NOT EXISTS ix_sku_ad_spend_daily_date ON sku_ad_spend_daily (date);
"""


def load_scripturi():
    """Return {(date, sku): {'fb': ron, 'tk': ron}} from the two daily USD tables."""
    con = sqlite3.connect(PA)
    out = defaultdict(lambda: {"fb": 0.0, "tk": 0.0})
    try:
        for d, sku, usd in con.execute(
            "SELECT date, sku, amount_usd FROM analytics_fb_spend_daily WHERE sku<>''"
        ):
            out[(d, sku)]["fb"] += round((usd or 0) * USD_TO_RON, 4)
        for d, sku, usd in con.execute(
            "SELECT date, sku, amount_usd FROM analytics_tk_spend_daily WHERE sku<>''"
        ):
            out[(d, sku)]["tk"] += round((usd or 0) * USD_TO_RON, 4)
    finally:
        con.close()
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    rows = load_scripturi()
    fb_tot = sum(v["fb"] for v in rows.values())
    tk_tot = sum(v["tk"] for v in rows.values())
    skus = {sku for (_, sku) in rows}
    dates = sorted({d for (d, _) in rows})
    nonha = sorted({s for s in skus if not s.upper().startswith("HA-")})
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    print("=" * 74)
    print("Scripturi -> AWB per-SKU daily ad spend import")
    print(f"  USD->RON              : {USD_TO_RON}")
    print(f"  (date,sku) rows       : {len(rows):,}")
    print(f"  distinct SKUs         : {len(skus)}   non-HA SKUs: {nonha or 'none'}")
    print(f"  date span             : {dates[0]} .. {dates[-1]}")
    print(f"  total FB spend (RON)  : {fb_tot:,.2f}")
    print(f"  total TK spend (RON)  : {tk_tot:,.2f}")
    # April / May split (closed-month verification anchors)
    for mo in ("2026-04", "2026-05"):
        fb = sum(v["fb"] for (d, _), v in rows.items() if d.startswith(mo))
        tk = sum(v["tk"] for (d, _), v in rows.items() if d.startswith(mo))
        print(f"  {mo}: FB {fb:,.2f} RON  TK {tk:,.2f} RON")

    async with AsyncSessionLocal() as db:
        exists = (
            await db.execute(text("SELECT to_regclass('public.sku_ad_spend_daily')"))
        ).scalar()
        existing = 0
        if exists:
            existing = (
                await db.execute(text("SELECT COUNT(*) FROM sku_ad_spend_daily"))
            ).scalar()
        print(f"\n  AWB table exists: {bool(exists)}   existing rows: {existing}")

        if not args.apply:
            print("\nDRY-RUN — no writes. Re-run with --apply.")
            print("  sample (date, sku, fb_ron, tk_ron):")
            for (d, sku), v in list(rows.items())[:8]:
                print(f"    {d}  {sku:<10} fb={v['fb']:>9.2f} tk={v['tk']:>9.2f}")
            return

        # ---- APPLY ----
        print("\nAPPLY: ensuring table + indexes ...")
        for stmt in DDL.strip().split(";"):
            if stmt.strip():
                await db.execute(text(stmt))
        await db.commit()

        if existing:
            bak = TMP / f"sku_ad_spend_daily_backup_{ts}.csv"
            with open(bak, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["date", "sku", "amount_fb_ron", "amount_tk_ron"])
                for r in (
                    await db.execute(
                        text(
                            "SELECT date, sku, amount_fb_ron, amount_tk_ron FROM sku_ad_spend_daily"
                        )
                    )
                ).all():
                    w.writerow(list(r))
            print(f"       backed up {existing} existing rows -> {bak}")

        applied = 0
        for (d, sku), v in rows.items():
            stmt = (
                pg_insert(SkuAdSpendDaily.__table__)
                .values(
                    date=date.fromisoformat(d),
                    sku=sku,
                    amount_fb_ron=round(v["fb"], 2),
                    amount_tk_ron=round(v["tk"], 2),
                )
                .on_conflict_do_update(
                    index_elements=["date", "sku"],
                    set_={
                        "amount_fb_ron": round(v["fb"], 2),
                        "amount_tk_ron": round(v["tk"], 2),
                    },
                )
            )
            await db.execute(stmt)
            applied += 1
        await db.commit()
        post = (
            await db.execute(
                text(
                    "SELECT COUNT(*), ROUND(SUM(amount_fb_ron)::numeric,2), "
                    "ROUND(SUM(amount_tk_ron)::numeric,2) FROM sku_ad_spend_daily"
                )
            )
        ).first()
        print(
            f"       upserted {applied:,} rows. table now {post[0]:,} rows, "
            f"FB {post[1]:,} RON, TK {post[2]:,} RON."
        )
        print("\nAPPLIED OK.")


if __name__ == "__main__":
    asyncio.run(main())
