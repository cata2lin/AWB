"""
Comprehensive migration: Add ALL missing columns to production database.

Scans every model table and adds any columns that exist in the SQLAlchemy
model but not in the actual PostgreSQL table.

Run ONCE on the production server:
  cd /opt/awb-print/backend
  python migrate_csv_status.py

Safe to run multiple times — skips columns that already exist.
"""
import asyncio
import logging
from sqlalchemy import text, inspect
from app.core.database import engine, Base

# Import ALL models so Base.metadata has them
from app.models import Order
from app.models.order_awb import OrderAwb
from app.models.courier_csv_import import CourierCsvImport

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Map SQLAlchemy types to PostgreSQL DDL types
TYPE_MAP = {
    'VARCHAR': lambda col: f"VARCHAR({col.type.length})" if hasattr(col.type, 'length') and col.type.length else "VARCHAR(255)",
    'TEXT': lambda col: "TEXT",
    'INTEGER': lambda col: "INTEGER",
    'FLOAT': lambda col: "FLOAT",
    'BOOLEAN': lambda col: "BOOLEAN",
    'DATETIME': lambda col: "TIMESTAMP",
    'JSON': lambda col: "JSON",
    'JSONB': lambda col: "JSONB",
}


def get_pg_type(column) -> str:
    """Convert a SQLAlchemy column type to PostgreSQL DDL type string."""
    type_name = type(column.type).__name__.upper()
    
    if type_name in TYPE_MAP:
        return TYPE_MAP[type_name](column)
    
    # Fallback: use the string representation
    if 'VARCHAR' in str(column.type).upper():
        return str(column.type)
    if 'TEXT' in str(column.type).upper():
        return 'TEXT'
    
    return str(column.type)


async def migrate_all():
    """Scan all model tables and add any missing columns."""
    
    tables_to_check = [
        OrderAwb.__table__,
        CourierCsvImport.__table__,
        Order.__table__,
    ]
    
    total_added = 0
    
    async with engine.begin() as conn:
        for table in tables_to_check:
            table_name = table.name
            
            # Get existing columns from PostgreSQL
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = :table_name"
            ), {"table_name": table_name})
            existing_cols = {row[0] for row in result.fetchall()}
            
            if not existing_cols:
                logger.info(f"  ⏭ Table '{table_name}' does not exist yet (will be created by app startup)")
                continue
            
            logger.info(f"\n📋 Table: {table_name} ({len(existing_cols)} existing columns)")
            
            # Compare model columns vs DB columns
            model_cols = {col.name: col for col in table.columns}
            missing = set(model_cols.keys()) - existing_cols
            
            if not missing:
                logger.info(f"  ✅ All {len(model_cols)} columns present")
                continue
            
            logger.info(f"  ⚠️  Missing {len(missing)} columns: {sorted(missing)}")
            
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
                    logger.info(f"  + Added: {col_name} {pg_type}{default_clause}")
                    total_added += 1
                except Exception as e:
                    logger.error(f"  ✗ Failed to add {col_name}: {e}")
    
    if total_added:
        logger.info(f"\n✅ Migration complete: {total_added} columns added across all tables")
    else:
        logger.info(f"\n✅ No migration needed: all columns already exist")


if __name__ == "__main__":
    asyncio.run(migrate_all())
