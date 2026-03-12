"""
Migration script: Add new columns for multi-AWB, shipping data, warehouse salary,
and courier_csv_imports table.
"""
import asyncio
from sqlalchemy import text
from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        print("Running migration: features_v2...")
        
        # --- Order table: Multi-AWB ---
        await safe_add_column(conn, "orders", "awb_count", "INTEGER DEFAULT 1")
        await safe_add_column(conn, "orders", "awb_count_manual", "BOOLEAN DEFAULT FALSE")
        
        # --- Order table: Shipping data from CSV / historical ---
        await safe_add_column(conn, "orders", "package_count", "INTEGER")
        await safe_add_column(conn, "orders", "package_weight", "FLOAT")
        await safe_add_column(conn, "orders", "transport_cost", "FLOAT")
        await safe_add_column(conn, "orders", "shipping_data_source", "VARCHAR(50)")
        await safe_add_column(conn, "orders", "shipping_data_manual", "BOOLEAN DEFAULT FALSE")
        
        # --- ProfitabilityConfig: Warehouse salary ---
        await safe_add_column(conn, "profitability_config", "warehouse_salary_per_package", "FLOAT DEFAULT 0.0")
        
        # --- New table: courier_csv_imports ---
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS courier_csv_imports (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(500) NOT NULL,
                courier_name VARCHAR(100) NOT NULL,
                total_rows INTEGER DEFAULT 0,
                matched_rows INTEGER DEFAULT 0,
                unmatched_rows INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'completed',
                error_message TEXT,
                imported_at TIMESTAMP DEFAULT NOW()
            )
        """))
        print("  [OK] courier_csv_imports table created/verified")
        
        print("[OK] Migration complete!")


async def safe_add_column(conn, table, column, col_type):
    """Add a column if it doesn't already exist."""
    try:
        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
        print(f"  [OK] Added {table}.{column}")
    except Exception as e:
        if "already exists" in str(e).lower() or "duplicate column" in str(e).lower():
            print(f"  [SKIP]  {table}.{column} already exists, skipping")
        else:
            raise


if __name__ == "__main__":
    asyncio.run(migrate())
