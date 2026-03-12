"""
Database migration script - Add new columns for AWB Print Manager features.
Run this once to add the new columns to existing tables.
"""
import asyncio
from sqlalchemy import text
from app.core.database import engine


MIGRATIONS = [
    # Multi-AWB support
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_count INTEGER DEFAULT 1",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_count_manual BOOLEAN DEFAULT FALSE",
    
    # Shipping data from CSV import
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_count INTEGER",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_weight FLOAT",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS transport_cost FLOAT",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_data_source VARCHAR(50)",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_data_manual BOOLEAN DEFAULT FALSE",
    
    # Warehouse salary per package
    "ALTER TABLE profitability_config ADD COLUMN IF NOT EXISTS warehouse_salary_per_package FLOAT DEFAULT 0.0",
    
    # Courier CSV imports table
    """
    CREATE TABLE IF NOT EXISTS courier_csv_imports (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        courier_name VARCHAR(100) NOT NULL,
        total_rows INTEGER DEFAULT 0,
        matched_rows INTEGER DEFAULT 0,
        unmatched_rows INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        error_message TEXT,
        imported_at TIMESTAMP DEFAULT NOW()
    )
    """,
]


async def main():
    print("Running database migrations...")
    async with engine.begin() as conn:
        for stmt in MIGRATIONS:
            try:
                await conn.execute(text(stmt))
                # Show first 80 chars of statement
                preview = stmt.strip().replace('\n', ' ')[:80]
                print(f"  OK: {preview}...")
            except Exception as e:
                print(f"  SKIP: {e}")
    print("Done!")


if __name__ == "__main__":
    asyncio.run(main())
