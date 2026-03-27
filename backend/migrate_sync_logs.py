"""
Migration: add missing columns to sync_logs table.

Columns added in recent commits but not migrated on production:
- sync_type VARCHAR(30) DEFAULT '45_day'
- store_uids JSON (nullable)
- date_from TIMESTAMP (nullable)
- date_to TIMESTAMP (nullable)

Run on the server:
  cd /opt/awb-print/backend
  python3 migrate_sync_logs.py
"""
import asyncio
import os
import sys

# Make sure we can import app modules
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.core.database import engine


MIGRATIONS = [
    ("sync_type", "ALTER TABLE sync_logs ADD COLUMN sync_type VARCHAR(30) DEFAULT '45_day'"),
    ("store_uids", "ALTER TABLE sync_logs ADD COLUMN store_uids JSON"),
    ("date_from", "ALTER TABLE sync_logs ADD COLUMN date_from TIMESTAMP"),
    ("date_to", "ALTER TABLE sync_logs ADD COLUMN date_to TIMESTAMP"),
]


async def migrate():
    async with engine.begin() as conn:
        # Check which columns already exist
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'sync_logs'"
        ))
        existing = {row[0] for row in result.fetchall()}
        print(f"Existing columns: {sorted(existing)}")

        for col_name, sql in MIGRATIONS:
            if col_name in existing:
                print(f"  ✓ {col_name} already exists")
            else:
                await conn.execute(text(sql))
                print(f"  + Added {col_name}")

    print("\nDone! All sync_logs columns are up to date.")


if __name__ == "__main__":
    asyncio.run(migrate())
