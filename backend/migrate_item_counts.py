"""
Migration: Clean line_items JSON and recalculate item_count + unique_sku_count.

Removes qty=0 items from line_items JSON. Recalculates item_count and unique_sku_count.
"""
import asyncio, sys
sys.path.insert(0, r'c:\Users\Admin\Desktop\AWB Print\awb-print-manager\backend')
from app.core.database import AsyncSessionLocal
from app.models import Order
from sqlalchemy import select


def _get_item_sku(item: dict):
    sku = item.get("sku")
    if sku:
        return sku
    inv = item.get("inventory_item")
    if inv and isinstance(inv, dict):
        return inv.get("sku")
    return None


async def migrate():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Order))
        orders = result.scalars().all()

        fixed = 0
        batch = 0
        for order in orders:
            items = order.line_items or []
            if not items:
                continue

            # Filter to only active items (qty > 0)
            active = [it for it in items if float(it.get("quantity", 0) or 0) > 0]
            new_item_count = sum(int(float(it.get("quantity", 1))) for it in active)
            new_unique_sku = len(set(
                _get_item_sku(it) for it in active if _get_item_sku(it)
            ))

            changed = False
            # Check if line_items needs cleaning (has removed items)
            if len(active) != len(items):
                order.line_items = active
                changed = True
            if order.item_count != new_item_count:
                order.item_count = new_item_count
                changed = True
            if order.unique_sku_count != new_unique_sku:
                order.unique_sku_count = new_unique_sku
                changed = True

            if changed:
                fixed += 1
                batch += 1

            if batch >= 500:
                await db.commit()
                print(f"  committed... {fixed} fixed so far")
                batch = 0

        await db.commit()
        print(f"\nDone. Fixed {fixed} orders out of {len(orders)} total.")


if __name__ == "__main__":
    asyncio.run(migrate())
