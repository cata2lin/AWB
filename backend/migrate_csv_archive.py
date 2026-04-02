"""
Migration: Add csv_status to order_awbs + saved_file_path to courier_csv_imports.

Run on production:
  python migrate_csv_archive.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.core.database import engine
from sqlalchemy import text


MIGRATIONS = [
    ("courier_csv_imports", "saved_file_path", "VARCHAR(500)"),
    ("order_awbs", "csv_status", "VARCHAR(255)"),
]


async def migrate():
    async with engine.begin() as conn:
        for table, column, col_type in MIGRATIONS:
            result = await conn.execute(text(
                f"SELECT column_name FROM information_schema.columns "
                f"WHERE table_name = '{table}' AND column_name = '{column}'"
            ))
            if result.fetchone():
                print(f"  ✓ {table}.{column} already exists — skipping.")
                continue

            sql = f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            print(f"  → {sql}")
            await conn.execute(text(sql))
            print(f"  ✅ Added {column} to {table}")

    print("\n✅ All migrations complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
