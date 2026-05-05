"""Add print_hold column to orders table."""
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def run():
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_hold BOOLEAN DEFAULT FALSE"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_orders_print_hold ON orders (print_hold)"
        ))
        await db.commit()
        print("✅ print_hold column and index added to orders table")

asyncio.run(run())
