"""Debug: check actual line_items structure and grouping for specific orders."""
import sys, os, asyncio
sys.path.insert(0, os.path.dirname(__file__))

async def main():
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select
    from app.models import Order

    async with AsyncSessionLocal() as db:
        # Check some specific problematic orders
        for order_num in ["EST103683", "EST104440", "EST104778", "EST103748", "EST103865", "EST103500"]:
            result = await db.execute(
                select(Order).where(Order.order_number == order_num)
            )
            order = result.scalar_one_or_none()
            if not order:
                print(f"{order_num}: NOT FOUND")
                continue

            items = order.line_items or []
            skus = []
            for item in items:
                sku = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
                qty = item.get("quantity", 1)
                skus.append(f"{sku} x{qty}")

            unique_skus = set()
            for item in items:
                s = item.get("sku") or (item.get("inventory_item") or {}).get("sku")
                if s:
                    unique_skus.add(s)

            print(f"{order_num}: item_count={order.item_count}, unique_sku_count={order.unique_sku_count}, "
                  f"len(line_items)={len(items)}, actual_unique_skus={len(unique_skus)}")
            print(f"  SKUs: {', '.join(skus)}")
            print()

asyncio.run(main())
