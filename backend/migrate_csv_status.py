"""
Comprehensive migration: Add ALL missing columns to ALL production tables.

Scans every model table registered in SQLAlchemy Base.metadata and adds
any columns that exist in the model but not in the actual PostgreSQL table.

Run ONCE on the production server:
  cd /opt/awb-print/backend
  python migrate_csv_status.py

Safe to run multiple times — skips columns that already exist.
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import engine, Base

# Import ALL models so Base.metadata is fully populated
from app.models import (
    Store, Order, OrderAwb, Rule, RulePreset,
    PrintBatch, PrintBatchItem,
    SkuCost, SyncLog, CourierCsvImport,
    ProfitabilityConfig, ExchangeRate, BusinessCost,
    MarketingDailyCost, SkuMarketingCost,
    User, UserActivity, Product,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)


def get_pg_type(column) -> str:
    """Convert a SQLAlchemy column type to PostgreSQL DDL type string."""
    type_name = type(column.type).__name__.upper()
    
    type_map = {
        'VARCHAR': lambda c: f"VARCHAR({c.type.length})" if hasattr(c.type, 'length') and c.type.length else "VARCHAR(255)",
        'STRING': lambda c: f"VARCHAR({c.type.length})" if hasattr(c.type, 'length') and c.type.length else "VARCHAR(255)",
        'TEXT': lambda c: "TEXT",
        'INTEGER': lambda c: "INTEGER",
        'FLOAT': lambda c: "FLOAT",
        'BOOLEAN': lambda c: "BOOLEAN",
        'DATETIME': lambda c: "TIMESTAMP",
        'JSON': lambda c: "JSON",
        'JSONB': lambda c: "JSONB",
    }
    
    if type_name in type_map:
        return type_map[type_name](column)
    
    # Fallback
    return str(column.type)


async def migrate_all():
    """Scan ALL model tables and add any missing columns."""
    
    total_added = 0
    tables_checked = 0
    
    async with engine.begin() as conn:
        # Get a list of all existing tables in the database
        result = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public'"
        ))
        existing_tables = {row[0] for row in result.fetchall()}
        logger.info(f"Existing DB tables: {sorted(existing_tables)}")
        
        # Iterate ALL model tables from Base.metadata
        for table in Base.metadata.sorted_tables:
            table_name = table.name
            tables_checked += 1
            
            if table_name not in existing_tables:
                logger.info(f"\n  ⏭ Table '{table_name}' does not exist yet (will be created on app startup)")
                continue
            
            # Get existing columns from PostgreSQL
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = :table_name AND table_schema = 'public'"
            ), {"table_name": table_name})
            existing_cols = {row[0] for row in result.fetchall()}
            
            # Compare model columns vs DB columns
            model_cols = {col.name: col for col in table.columns}
            missing = set(model_cols.keys()) - existing_cols
            
            if not missing:
                logger.info(f"  ✅ {table_name}: all {len(model_cols)} columns present")
                continue
            
            logger.info(f"\n  ⚠️  {table_name}: missing {len(missing)} columns: {sorted(missing)}")
            
            for col_name in sorted(missing):
                col = model_cols[col_name]
                pg_type = get_pg_type(col)
                
                # Add DEFAULT for boolean columns
                default_clause = ""
                if col.default is not None and hasattr(col.default, 'arg'):
                    default_val = col.default.arg
                    if isinstance(default_val, bool):
                        default_clause = f" DEFAULT {'TRUE' if default_val else 'FALSE'}"
                    elif isinstance(default_val, (int, float)):
                        default_clause = f" DEFAULT {default_val}"
                    elif isinstance(default_val, str):
                        default_clause = f" DEFAULT '{default_val}'"
                
                sql = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {pg_type}{default_clause}"
                try:
                    await conn.execute(text(sql))
                    logger.info(f"     + Added: {col_name} {pg_type}{default_clause}")
                    total_added += 1
                except Exception as e:
                    logger.error(f"     ✗ Failed to add {col_name}: {e}")
    
    logger.info(f"\n{'='*60}")
    if total_added:
        logger.info(f"✅ Migration complete: {total_added} columns added across {tables_checked} tables")
    else:
        logger.info(f"✅ No migration needed: all columns present across {tables_checked} tables")
    logger.info(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(migrate_all())
