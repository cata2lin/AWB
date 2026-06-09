"""
Migration: create the `watchlists` + `watchlist_items` tables.

Snapshot-delta product watchlists, ported from Scripturi's
`analytics_watchlists` / `analytics_watchlist_items`. A watchlist is a named,
color-tagged collection; each item pins a SKU plus a `snapshot_json` blob
captured at add time for live-vs-snapshot delta comparison.

Idempotent (CREATE TABLE IF NOT EXISTS). `Base.metadata.create_all()` won't add
these to prod, so run this once. Safe to run repeatedly.

Run: python migrate_watchlists.py
"""

import asyncio
from sqlalchemy import text
from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS watchlists (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    color VARCHAR(20) DEFAULT '#8b5cf6',
                    created_at TIMESTAMP DEFAULT now()
                )
                """
            )
        )
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS watchlist_items (
                    id SERIAL PRIMARY KEY,
                    watchlist_id INTEGER NOT NULL
                        REFERENCES watchlists (id) ON DELETE CASCADE,
                    sku VARCHAR(255) NOT NULL,
                    snapshot_json TEXT,
                    added_at TIMESTAMP DEFAULT now(),
                    CONSTRAINT uq_watchlist_item_sku UNIQUE (watchlist_id, sku)
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_watchlist_items_watchlist_id "
                "ON watchlist_items (watchlist_id)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_watchlist_items_sku "
                "ON watchlist_items (sku)"
            )
        )
        print("Created 'watchlists' + 'watchlist_items' tables (if missing).")


if __name__ == "__main__":
    asyncio.run(migrate())
    print("Migration complete.")
