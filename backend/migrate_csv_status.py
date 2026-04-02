"""
Migration: Add csv_status column to order_awbs table.

Run this ONCE on the production database:
  cd backend
  python migrate_csv_status.py

This adds the csv_status column so the billable status filtering works.
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NEW_COLUMNS = [
    ("csv_status", "VARCHAR(255)"),
]


async def migrate():
    async with engine.begin() as conn:
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'order_awbs'"
        ))
        existing_cols = {row[0] for row in result.fetchall()}
        logger.info(f"Existing order_awbs columns: {sorted(existing_cols)}")

        added = 0
        for col_name, col_type in NEW_COLUMNS:
            if col_name in existing_cols:
                logger.info(f"  ✓ Column '{col_name}' already exists, skipping")
                continue

            sql = f"ALTER TABLE order_awbs ADD COLUMN {col_name} {col_type}"
            await conn.execute(text(sql))
            logger.info(f"  + Added column '{col_name}' ({col_type})")
            added += 1

        if added:
            logger.info(f"\n✅ Migration complete: {added} columns added to order_awbs")
        else:
            logger.info(f"\n✅ No migration needed: all columns already exist")


if __name__ == "__main__":
    asyncio.run(migrate())
