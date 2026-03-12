"""Discover and add ALL SKUs from orders with cost = 10."""
import asyncio
from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal
from app.models import Order, SkuCost


async def discover_and_add_all_skus():
    async with AsyncSessionLocal() as db:
        # Get all orders with line items
        orders_result = await db.execute(
            select(Order.line_items).where(Order.line_items.isnot(None))
        )
        
        # Extract unique SKUs from all orders with their names
        all_skus = {}  # sku -> name
        for (line_items,) in orders_result.fetchall():
            if isinstance(line_items, list):
                for item in line_items:
                    if isinstance(item, dict):
                        inventory_item = item.get("inventory_item", {})
                        if isinstance(inventory_item, dict):
                            sku = inventory_item.get("sku")
                            name = inventory_item.get("title_1", "")
                            if sku and sku not in all_skus:
                                all_skus[sku] = name
        
        print(f"Found {len(all_skus)} unique SKUs in orders")
        
        # Get SKUs that already have costs
        existing_result = await db.execute(select(SkuCost.sku))
        existing_skus = {row[0] for row in existing_result.fetchall()}
        print(f"Already have {len(existing_skus)} SKUs in database")
        
        # Find missing SKUs
        missing_skus = set(all_skus.keys()) - existing_skus
        print(f"Missing {len(missing_skus)} SKUs - adding them now...")
        
        # Add all missing SKUs with cost = 10
        added = 0
        for sku in missing_skus:
            name = all_skus.get(sku, "")
            sku_cost = SkuCost(
                sku=sku,
                name=name,
                cost=10.0,
                currency="RON"
            )
            db.add(sku_cost)
            added += 1
        
        await db.commit()
        print(f"Added {added} new SKUs with cost = 10 RON")
        
        # Final count
        count_result = await db.execute(text("SELECT COUNT(*) FROM sku_costs"))
        total = count_result.scalar()
        print(f"Total SKUs in database now: {total}")


if __name__ == "__main__":
    asyncio.run(discover_and_add_all_skus())
