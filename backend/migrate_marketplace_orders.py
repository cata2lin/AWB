"""
Migration: create the `marketplace_orders` table (channel-agnostic marketplace
orders — eMAG today, future channels later).

Mirrors migrate_exclusion_rules.py: CREATE TABLE IF NOT EXISTS + unique constraint
on (marketplace, order_id) + index on marketplace. Idempotent — safe to re-run.

INERT: the table stays empty until eMAG credentials are supplied via env vars and
a sync runs (see app/services/emag/sync.py).

Run: python migrate_marketplace_orders.py
"""

import asyncio
from sqlalchemy import text
from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS marketplace_orders (
                    id SERIAL PRIMARY KEY,
                    marketplace VARCHAR(10) NOT NULL,
                    order_id VARCHAR(64) NOT NULL,
                    status VARCHAR(50),
                    order_date TIMESTAMP,
                    customer_locality VARCHAR(255),
                    products JSON,
                    sale_price DOUBLE PRECISION,
                    shipping_tax DOUBLE PRECISION,
                    payment_mode VARCHAR(50),
                    payment_status VARCHAR(50),
                    delivery_mode VARCHAR(50),
                    awb_number VARCHAR(100),
                    cancellation_request VARCHAR(255),
                    synced_at TIMESTAMP DEFAULT now(),
                    CONSTRAINT uq_marketplace_order UNIQUE (marketplace, order_id)
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_marketplace_orders_marketplace "
                "ON marketplace_orders (marketplace)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_marketplace_orders_status "
                "ON marketplace_orders (status)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_marketplace_orders_order_date "
                "ON marketplace_orders (order_date)"
            )
        )
        print("Created 'marketplace_orders' table (if missing).")


if __name__ == "__main__":
    asyncio.run(migrate())
    print("Migration complete.")
