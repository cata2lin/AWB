"""
Migration: composite indexes for the analytics + orders query shapes.

Every analytics endpoint filters `frisbo_created_at BETWEEN x AND y` and optionally
`store_uid IN (...)`. Only single-column indexes existed, so Postgres could use one
and heap-filter the rest. These composites cover both the all-stores date-window
scan and the per-store date scan.

Uses CREATE INDEX CONCURRENTLY so it does NOT lock the orders table on prod
(safe to run against the live DB). Idempotent (IF NOT EXISTS). CONCURRENTLY cannot
run inside a transaction, so we use an AUTOCOMMIT connection.

Run: python migrate_analytics_indexes.py
"""

import asyncio
from sqlalchemy import text
from app.core.database import engine

INDEXES = [
    # date-window first (the common all-stores analytics scan)
    ("ix_orders_created_store", "orders (frisbo_created_at, store_uid)"),
    # per-store then date (store-filtered reports + Orders page)
    ("ix_orders_store_created", "orders (store_uid, frisbo_created_at)"),
]


async def migrate():
    async with engine.connect() as conn:
        ac = await conn.execution_options(isolation_level="AUTOCOMMIT")
        for name, target in INDEXES:
            print(f"Creating {name} ON {target} (CONCURRENTLY, if missing)...")
            await ac.execute(
                text(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {target}")
            )
            print(f"  done: {name}")


if __name__ == "__main__":
    asyncio.run(migrate())
    print("Index migration complete.")
