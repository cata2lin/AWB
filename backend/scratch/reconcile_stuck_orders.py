"""
One-shot: clear the stuck-order backlog by adopting Scripturi's courier-resolved status.

Builds resolved_map = {order_number: terminal_status} from the local Scripturi SQLite copy
(profit_orders.status_category) and applies it via stuck_reconciliation.reconcile_stuck_orders.
The sync "don't-downgrade-terminal" rule keeps these from being re-frozen by Frisbo.

Resolves ~640 of the ~1,924 stuck orders (the rest are genuinely indeterminate — Scripturi
has no terminal status either; they need a live courier feed).

Run: cd backend && ./venv/Scripts/python.exe scratch/reconcile_stuck_orders.py [--apply]
"""

import sys
import asyncio
import argparse
import sqlite3

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.services.stuck_reconciliation import (  # noqa: E402
    reconcile_stuck_orders,
    aged_out_stuck_orders,
    SC_TO_AWB_TERMINAL,
)

PR = r"c:/Users/Admin/Desktop/scripturi-vps/Scripturi/data/profitability.db"


def build_resolved_map():
    con = sqlite3.connect(PR)
    try:
        rows = con.execute(
            "SELECT order_name, status_category FROM profit_orders"
        ).fetchall()
    finally:
        con.close()
    out = {}
    for name, cat in rows:
        awb = SC_TO_AWB_TERMINAL.get(cat)
        if awb:
            out[name] = awb
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    resolved_map = build_resolved_map()
    print(f"Scripturi terminal resolutions available: {len(resolved_map):,}")

    async with AsyncSessionLocal() as db:
        # Step 1: adopt Scripturi's courier-resolved status (incl. delivered → recovers revenue)
        res = await reconcile_stuck_orders(db, resolved_map, apply=args.apply)
        # Step 2: aged-out write-off — anything still stuck >90d is closed terminally
        aged = await aged_out_stuck_orders(db, age_days=90, apply=args.apply)
    print(f"  stuck total (>14d, tracked, non-terminal): {res['stuck_total']:,}")
    print(
        f"  step1 Scripturi-resolved                 : {res['resolved']:,}  {res['by_status']}"
    )
    print(
        f"  step2 aged-out >90d write-off            : {aged['aged_out']:,}  ({aged['revenue']:,.0f} RON loss)"
    )
    print(f"  {'APPLIED' if res['applied'] else 'DRY-RUN — re-run with --apply'}")


if __name__ == "__main__":
    asyncio.run(main())
    print("DONE")
