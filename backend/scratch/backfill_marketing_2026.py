"""
One-off: backfill `marketing_daily_costs` from the CPA Google Sheet for a date range.

The sheet→DB sync (`google_sheets.sync_marketing_costs`) had only ever been run for the
early part of each month, so 2026-03 was 71% missing (8/31 days) and May/June were
partial — overstating those months' net profit by ~937K RON (March) in the P&L and
daily-perf. This re-runs the sync over the gap so every month has full daily coverage.

Safe: `sync_marketing_costs` now aborts (leaves the DB untouched) if all sheet fetches
fail, so a transient gviz failure can't zero the range.

Run: cd backend && ./venv/Scripts/python.exe scratch/backfill_marketing_2026.py [YYYY-MM-DD YYYY-MM-DD]
"""

import sys
import asyncio
from datetime import date

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.services.google_sheets import sync_marketing_costs  # noqa: E402

DF = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 2 else date(2026, 3, 1)
DT = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date.today()


async def main():
    async with AsyncSessionLocal() as db:
        res = await sync_marketing_costs(db, DF, DT)
        print("sync_marketing_costs:", res)
        rows = (
            await db.execute(
                text(
                    "SELECT to_char(cost_date,'YYYY-MM') m, COUNT(DISTINCT cost_date) days, "
                    "COUNT(DISTINCT store_name) stores, ROUND(SUM(facebook+tiktok+google)::numeric,0) spend "
                    "FROM marketing_daily_costs WHERE cost_date >= :df GROUP BY 1 ORDER BY 1"
                ),
                {"df": DF},
            )
        ).all()
        print("\nper-month coverage after backfill:")
        for r in rows:
            print(
                f"  {r.m}  days={r.days:<3} stores={r.stores:<3} spend={float(r.spend):,.0f} RON"
            )


if __name__ == "__main__":
    asyncio.run(main())
    print("DONE")
