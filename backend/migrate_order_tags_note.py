"""
Migration: Add `tags` (JSONB) and `note` (TEXT) columns to the orders table.

Frisbo's /orders/search now returns storefront tags (OrderTags.selling_channel)
and the order note. We store the lowercased tag keys (e.g. ["test","duplicata"])
so reports can exclude test/junk orders — matching the Scripturi tag exclusion —
and the free-text note for reference.

Idempotent (ADD COLUMN IF NOT EXISTS). Existing rows get NULL; tags/note are
backfilled as orders are re-synced (the sync coalesces, so a tags-less response
never wipes a value). To force a full backfill, run a `full` sync afterwards.

Run: python migrate_order_tags_note.py
"""

import asyncio
from sqlalchemy import text
from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags JSONB")
        )
        await conn.execute(
            text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT")
        )
        print("Added 'tags' (JSONB) and 'note' (TEXT) columns to orders (if missing).")


if __name__ == "__main__":
    asyncio.run(migrate())
    print("Migration complete.")
