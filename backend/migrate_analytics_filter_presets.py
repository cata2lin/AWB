"""
Migration: Create the analytics_filter_presets table.

Shared filter sets for the analytics reports (Livrabilitate Produse first).
Idempotent — safe to re-run.

Run: ./venv/Scripts/python.exe migrate_analytics_filter_presets.py
"""

import asyncio
from sqlalchemy import text
from app.core.database import engine


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS analytics_filter_presets (
    id              SERIAL PRIMARY KEY,
    report_key      VARCHAR(80)  NOT NULL,
    name            VARCHAR(120) NOT NULL,
    description     VARCHAR(500),
    filters         JSON         NOT NULL DEFAULT '{}'::json,
    is_default      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP    NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    updated_at      TIMESTAMP,
    created_by      VARCHAR(120)
);
"""

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS ix_analytics_filter_presets_report_key "
    "ON analytics_filter_presets (report_key);",
    "CREATE INDEX IF NOT EXISTS ix_analytics_filter_presets_is_default "
    "ON analytics_filter_presets (is_default);",
]


async def migrate():
    async with engine.begin() as conn:
        await conn.execute(text(CREATE_SQL))
        for sql in INDEX_SQL:
            await conn.execute(text(sql))
    print("Migration complete: analytics_filter_presets ready.")


if __name__ == "__main__":
    asyncio.run(migrate())
