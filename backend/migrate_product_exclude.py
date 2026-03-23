"""
Migration: add exclude_from_stock column to products table.
Idempotent — safe to run multiple times.
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate():
    async with engine.begin() as conn:
        # Check existing columns
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'products' AND table_schema = 'public'"
        ))
        existing = {row[0] for row in result.fetchall()}
        logger.info(f"Existing products columns: {len(existing)} total")

        if "exclude_from_stock" not in existing:
            await conn.execute(text(
                "ALTER TABLE products ADD COLUMN exclude_from_stock BOOLEAN DEFAULT FALSE"
            ))
            logger.info("+ Added column 'exclude_from_stock'")
        else:
            logger.info("Column 'exclude_from_stock' already exists, skipping")

        # Add index on barcode for efficient grouping
        try:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_products_barcode ON products (barcode)"
            ))
            logger.info("+ Created index on barcode")
        except Exception:
            logger.info("Barcode index already exists or not needed")

    logger.info("\n✅ Migration complete")


if __name__ == "__main__":
    asyncio.run(migrate())
