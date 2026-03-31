"""
Migration: Widen status columns from VARCHAR(50) to VARCHAR(255).

Frisbo API returns aggregated_status values like:
  'awaiting_shipment_generation_hold_release_incorrect_address' (58 chars)
which exceed the original VARCHAR(50) limit.

Run on production:
  python migrate_status_columns.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.core.database import engine
from sqlalchemy import text


async def migrate():
    columns = [
        ("orders", "fulfillment_status", 255),
        ("orders", "financial_status", 255),
        ("orders", "shipment_status", 255),
        ("orders", "aggregated_status", 255),
    ]

    async with engine.begin() as conn:
        for table, column, size in columns:
            sql = f"ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR({size})"
            print(f"  → {sql}")
            await conn.execute(text(sql))

        print("\n✅ All status columns widened to VARCHAR(255)")


if __name__ == "__main__":
    asyncio.run(migrate())
