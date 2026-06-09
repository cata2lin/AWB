"""
Migration: create the `exclusion_rules` table (configurable order exclusions).

Mirrors Scripturi's `profit_exclusion_rules`: an admin can exclude orders from the
analytics reports by `tag` (Frisbo tag) or `sku` (line-item SKU), on top of the
always-on built-in `test`/`sample` tags. CRUD via /analytics/exclusion-rules.

Idempotent (CREATE TABLE IF NOT EXISTS + unique constraint). Safe to run repeatedly.

Run: python migrate_exclusion_rules.py
"""

import asyncio
from sqlalchemy import text
from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS exclusion_rules (
                    id SERIAL PRIMARY KEY,
                    rule_type VARCHAR(10) NOT NULL,
                    value VARCHAR(255) NOT NULL,
                    reason TEXT,
                    created_at TIMESTAMP DEFAULT now(),
                    CONSTRAINT uq_exclusion_rule UNIQUE (rule_type, value)
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_exclusion_rules_rule_type "
                "ON exclusion_rules (rule_type)"
            )
        )
        print("Created 'exclusion_rules' table (if missing).")


if __name__ == "__main__":
    asyncio.run(migrate())
    print("Migration complete.")
