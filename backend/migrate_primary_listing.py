"""
Migration: Add primary_listing_uid column to products table.

This column stores the UID of the listing that should be used as the
source of truth for stock/image in a barcode/SKU group. When set,
it's stored on ALL products in the group so the grouped endpoint
can quickly determine the primary without extra queries.

Run: python migrate_primary_listing.py
"""
import asyncio
from sqlalchemy import text
from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        # Check if column already exists
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'products' AND column_name = 'primary_listing_uid'"
        ))
        if result.fetchone():
            print("Column 'primary_listing_uid' already exists — skipping.")
            return

        # Add the column
        await conn.execute(text(
            "ALTER TABLE products ADD COLUMN primary_listing_uid VARCHAR(100)"
        ))
        print("Added 'primary_listing_uid' column to products table.")


if __name__ == "__main__":
    asyncio.run(migrate())
    print("Migration complete.")
