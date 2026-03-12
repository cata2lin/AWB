"""Debug script to check line_items format."""
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal


async def check_line_items():
    async with AsyncSessionLocal() as db:
        # Check count
        result = await db.execute(text("SELECT COUNT(*) FROM orders WHERE line_items IS NOT NULL"))
        count = result.scalar()
        print(f"Orders with line_items: {count}")
        
        # Get samples
        result = await db.execute(text("SELECT id, line_items FROM orders WHERE line_items IS NOT NULL LIMIT 3"))
        rows = result.fetchall()
        
        print("\nSample data:")
        for row in rows:
            order_id, line_items = row
            print(f"\nOrder {order_id}:")
            print(f"  Type: {type(line_items)}")
            print(f"  Value: {repr(line_items)[:500]}")
            
            if isinstance(line_items, list):
                print(f"  Is list with {len(line_items)} items")
                if line_items:
                    print(f"  First item type: {type(line_items[0])}")
                    print(f"  First item: {line_items[0]}")
            elif isinstance(line_items, str):
                print(f"  Is string, length: {len(line_items)}")


if __name__ == "__main__":
    asyncio.run(check_line_items())
