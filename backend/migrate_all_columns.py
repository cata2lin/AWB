"""
Master migration — adds ALL missing columns across ALL tables.

Reads every SQLAlchemy model and compares against the actual DB schema.
Safely adds any columns that exist in code but not in the database.

Run on the server:
  cd /opt/awb-print/backend
  source venv/bin/activate
  python3 migrate_all_columns.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text, inspect
from app.core.database import engine, Base

# Import all models so they register with Base
from app.models import (
    Order, Store, Product, SyncLog, PrintBatch, PrintBatchItem,
    OrderAwb, SkuCost, ExchangeRate, Rule
)
from app.models.user import User
from app.models.user_activity import UserActivity
from app.models.profitability_config import ProfitabilityConfig
from app.models.courier_csv_import import CourierCsvImport
from app.models.business_cost import BusinessCost
from app.models.sku_marketing_cost import SkuMarketingCost
from app.models.marketing_daily_cost import MarketingDailyCost


# SQLAlchemy type -> PostgreSQL DDL type mapping
TYPE_MAP = {
    "VARCHAR": "VARCHAR",
    "STRING": "VARCHAR",
    "TEXT": "TEXT",
    "INTEGER": "INTEGER",
    "BIGINTEGER": "BIGINT",
    "FLOAT": "DOUBLE PRECISION",
    "BOOLEAN": "BOOLEAN",
    "DATETIME": "TIMESTAMP WITHOUT TIME ZONE",
    "DATE": "DATE",
    "JSON": "JSON",
    "JSONB": "JSONB",
    "NUMERIC": "NUMERIC",
}


def get_pg_type(col):
    """Convert a SQLAlchemy column type to a PostgreSQL type string."""
    sa_type = type(col.type).__name__.upper()

    # Handle VARCHAR with length
    if sa_type in ("VARCHAR", "STRING"):
        length = getattr(col.type, 'length', None)
        if length:
            return f"VARCHAR({length})"
        return "VARCHAR"

    # Handle Numeric with precision
    if sa_type == "NUMERIC":
        prec = getattr(col.type, 'precision', None)
        scale = getattr(col.type, 'scale', None)
        if prec and scale:
            return f"NUMERIC({prec},{scale})"
        return "NUMERIC"

    return TYPE_MAP.get(sa_type, "TEXT")


def get_default_clause(col):
    """Build a DEFAULT clause if the column has a static default."""
    if col.default is not None:
        val = col.default.arg if hasattr(col.default, 'arg') else col.default
        if callable(val):
            return ""  # Skip dynamic defaults like datetime.utcnow
        if isinstance(val, bool):
            return f" DEFAULT {'TRUE' if val else 'FALSE'}"
        if isinstance(val, (int, float)):
            return f" DEFAULT {val}"
        if isinstance(val, str):
            return f" DEFAULT '{val}'"
    return ""


async def migrate():
    async with engine.begin() as conn:
        # Get all existing tables and their columns from the DB
        db_tables = {}
        table_result = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public'"
        ))
        for (table_name,) in table_result.fetchall():
            col_result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :table"
            ), {"table": table_name})
            db_tables[table_name] = {row[0] for row in col_result.fetchall()}

        print(f"Found {len(db_tables)} tables in DB\n")

        total_added = 0
        total_tables_created = 0

        # Check every model table
        for table_name, table in Base.metadata.tables.items():
            if table_name not in db_tables:
                # Entire table is missing — create it
                print(f"  TABLE MISSING: {table_name} — creating...")
                await conn.execute(text(str(table.create(bind=None, checkfirst=False).compile(
                    dialect=engine.dialect
                ))))
                total_tables_created += 1
                continue

            existing_cols = db_tables[table_name]
            model_cols = table.columns

            for col in model_cols:
                if col.name in existing_cols:
                    continue

                pg_type = get_pg_type(col)
                nullable = "NULL" if col.nullable else "NOT NULL"
                default = get_default_clause(col)

                # For NOT NULL columns without a default, make them nullable
                # to avoid errors with existing rows
                if nullable == "NOT NULL" and not default:
                    nullable = "NULL"

                sql = f'ALTER TABLE "{table_name}" ADD COLUMN "{col.name}" {pg_type} {nullable}{default}'
                print(f"  + {table_name}.{col.name} ({pg_type})")
                try:
                    await conn.execute(text(sql))
                    total_added += 1
                except Exception as e:
                    print(f"    ERROR: {e}")

        # Also try to create tables that don't exist at all
        for table_name, table in Base.metadata.tables.items():
            if table_name not in db_tables:
                print(f"\n  Creating missing table: {table_name}")
                try:
                    await conn.run_sync(lambda sync_conn: table.create(sync_conn, checkfirst=True))
                    total_tables_created += 1
                except Exception as e:
                    print(f"    ERROR creating table: {e}")

    print(f"\n✓ Done! Added {total_added} columns, created {total_tables_created} tables.")


if __name__ == "__main__":
    asyncio.run(migrate())
