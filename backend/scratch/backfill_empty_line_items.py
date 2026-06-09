"""
Backfill line_items for orders that were wiped to [] (item_count=0) by the sync bug
(a partial Frisbo search payload + the old `is not None` guard overwrote good data).
The code is fixed; this recovers the orders already damaged by re-fetching each one via
the single-order Frisbo GET (/orders/order/{uid}), which carries the full line_items
even when the search/store-view payload omits them (covoria's quirk).

Run: cd backend && ./venv/Scripts/python.exe scratch/backfill_empty_line_items.py [--apply] [--limit N]
"""

import sys
import asyncio
import argparse

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"c:/Users/Admin/Desktop/AWB Print/awb-print-manager/backend")

from sqlalchemy import select, text  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.models import Order  # noqa: E402
from app.services.frisbo.client import FrisboClient  # noqa: E402
from app.services.frisbo.parser import parse_order  # noqa: E402


def _unwrap(resp):
    """get_order may return {data:{...}} or {data:{order:{...}}} or the order dict."""
    if not isinstance(resp, dict):
        return None
    if resp.get("success") is False:
        return None
    data = resp.get("data", resp)
    if isinstance(data, dict) and "order" in data and isinstance(data["order"], dict):
        return data["order"]
    if isinstance(data, dict) and (data.get("uid") or data.get("line_items")):
        return data
    return data if isinstance(data, dict) else None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=1000)
    args = ap.parse_args()

    clients = [
        FrisboClient(token=o["token"], org_name=o.get("name", "org"))
        for o in settings.get_org_tokens()
        if o.get("token")
    ]
    print(f"org tokens: {len(clients)}")

    async with AsyncSessionLocal() as db:
        targets = (
            await db.execute(
                text(
                    "SELECT uid, order_number, store_uid FROM orders "
                    "WHERE item_count=0 AND frisbo_created_at>='2026-01-01' "
                    "AND aggregated_status='delivered' ORDER BY frisbo_created_at DESC LIMIT :lim"
                ),
                {"lim": args.limit},
            )
        ).all()
        print(f"affected delivered orders to backfill: {len(targets)}")

        recovered = recovered_items = not_found = still_empty = 0
        for t in targets:
            raw = None
            for cli in clients:
                try:
                    resp = await cli.get_order(t.uid)
                    cand = _unwrap(resp)
                    if cand and cand.get("uid"):
                        raw = cand
                        break
                except Exception:
                    continue
            if not raw:
                not_found += 1
                continue
            parsed = parse_order(raw)
            li = parsed.get("line_items") or []
            if not li:
                still_empty += 1
                continue
            recovered += 1
            recovered_items += parsed.get("item_count", 0)
            if args.apply:
                o = (
                    await db.execute(select(Order).where(Order.uid == t.uid))
                ).scalar_one_or_none()
                if o:
                    o.line_items = li
                    o.item_count = parsed["item_count"]
                    o.unique_sku_count = parsed["unique_sku_count"]
            if recovered % 50 == 0:
                print(f"  ...{recovered} recovered")
                if args.apply:
                    await db.commit()
        if args.apply:
            await db.commit()

        print(
            f"\n{'APPLIED' if args.apply else 'DRY-RUN'}: recovered {recovered} orders "
            f"({recovered_items} items), single-order still-empty {still_empty}, not_found {not_found}"
        )
        if not args.apply:
            print("Re-run with --apply to write.")


if __name__ == "__main__":
    asyncio.run(main())
    print("DONE")
