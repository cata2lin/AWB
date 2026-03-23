import asyncio
from app.core.database import AsyncSessionLocal
from app.models import Order
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Order).where(Order.order_number.contains('GRAND1138')))
        order = result.scalar_one_or_none()
        if order:
            for i, item in enumerate(order.line_items or []):
                print(f"Item [{i}]:")
                print(f"  quantity: {item.get('quantity')}")
                print(f"  reserved_quantity: {item.get('reserved_quantity')}")
                print(f"  missing_quantity: {item.get('missing_quantity')}")
                print(f"  has_missing: {item.get('has_missing')}")
                inv = item.get("inventory_item", {}) or {}
                print(f"  inventory_item.sku: {inv.get('sku')}")
                print(f"  inventory_item.title_1: {inv.get('title_1')}")
                # Check all numeric-looking fields
                for k, v in item.items():
                    if isinstance(v, (int, float)):
                        print(f"  {k}: {v}")

        # Also sample orders with 0-quantity items
        print("\n--- Orders with 0 quantity items ---")
        result = await db.execute(select(Order).limit(50))
        count = 0
        for o in result.scalars().all():
            items = o.line_items or []
            for item in items:
                qty = item.get("quantity", 1)
                if qty == 0 or qty == 0.0:
                    res_qty = item.get("reserved_quantity", 0)
                    sku = item.get("sku") or (item.get("inventory_item") or {}).get("sku", "?")
                    print(f"  {o.order_number}: sku={sku} quantity={qty} reserved_quantity={res_qty}")
                    count += 1
                    if count >= 10:
                        break
            if count >= 10:
                break
        print(f"Found {count} items with quantity=0 in first 50 orders")

asyncio.run(check())
