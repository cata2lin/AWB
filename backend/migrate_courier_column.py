"""
Migration script to add waiting_for_courier_since column to existing orders table.

Run ONCE against your existing database:
  cd backend
  .\venv\Scripts\python.exe migrate_courier_column.py
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate():
    async with engine.begin() as conn:
        # Check if column already exists
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'orders' AND column_name = 'waiting_for_courier_since'"
        ))
        if result.fetchone():
            logger.info("✓ Column 'waiting_for_courier_since' already exists, skipping")
            return
        
        await conn.execute(text(
            "ALTER TABLE orders ADD COLUMN waiting_for_courier_since TIMESTAMP"
        ))
        logger.info("+ Added column 'waiting_for_courier_since' (TIMESTAMP) to orders table")
        logger.info("✅ Migration complete")


if __name__ == "__main__":
    asyncio.run(migrate())
