"""Clear all orders and related data for a fresh full sync."""
import asyncio
from sqlalchemy import text
from app.core.database import engine

async def clear():
    async with engine.begin() as conn:
        # Delete in dependency order (children first)
        r1 = await conn.execute(text("DELETE FROM order_awbs"))
        print(f"Deleted {r1.rowcount} order_awbs rows")
        
        r2 = await conn.execute(text("DELETE FROM print_batch_items"))
        print(f"Deleted {r2.rowcount} print_batch_items rows")
        
        r3 = await conn.execute(text("DELETE FROM orders"))
        print(f"Deleted {r3.rowcount} orders rows")
        
        r4 = await conn.execute(text("DELETE FROM sync_logs"))
        print(f"Deleted {r4.rowcount} sync_logs rows")
        
        # Also clear stores so they get re-created from fresh data
        r5 = await conn.execute(text("DELETE FROM stores"))
        print(f"Deleted {r5.rowcount} stores rows")
        
    print("Database cleared! Ready for fresh full sync.")

asyncio.run(clear())
