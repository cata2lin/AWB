"""
Migration script to add new shipment data columns to the existing order_awbs table.

Run this ONCE against your existing database:
  cd backend
  .\venv\Scripts\python.exe migrate_awb_columns.py

This adds 12 new nullable columns for full Frisbo shipment data capture.
The products table will be auto-created by SQLAlchemy create_all() since it's new.
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# New columns to add to order_awbs (all nullable, so safe for existing rows)
NEW_COLUMNS = [
    ("shipment_uid",          "VARCHAR(100)"),
    ("awb_pdf_url",           "TEXT"),
    ("awb_pdf_format",        "VARCHAR(20)"),
    ("shipment_status",       "VARCHAR(50)"),
    ("shipment_status_date",  "TIMESTAMP"),
    ("is_return_label",       "BOOLEAN DEFAULT FALSE"),
    ("is_redirect_label",     "BOOLEAN DEFAULT FALSE"),
    ("paid_by",               "VARCHAR(20)"),
    ("cod_value",             "FLOAT"),
    ("cod_currency",          "VARCHAR(10)"),
    ("shipment_created_at",   "TIMESTAMP"),
    ("shipment_events",       "JSON"),
]


async def migrate():
    async with engine.begin() as conn:
        # Check which columns already exist
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'order_awbs'"
        ))
        existing_cols = {row[0] for row in result.fetchall()}
        logger.info(f"Existing order_awbs columns: {existing_cols}")
        
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
