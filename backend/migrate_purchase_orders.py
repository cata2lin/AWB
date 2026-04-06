"""
Migration script — create purchase_orders, purchase_order_items, generated_barcodes tables.
Run once to add the new tables to the database.
"""
import asyncio
from sqlalchemy import text
from app.core.database import engine

CREATE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        po_number VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        supplier_name VARCHAR(255),
        container_ref VARCHAR(255),
        expected_arrival_date DATE,
        actual_arrival_date DATE,
        notes TEXT,
        total_items INTEGER DEFAULT 0,
        total_quantity INTEGER DEFAULT 0,
        total_cost FLOAT DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);",
    "CREATE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(po_number);",
    """
    CREATE TABLE IF NOT EXISTS purchase_order_items (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        sku VARCHAR(100) NOT NULL,
        barcode VARCHAR(100),
        product_name VARCHAR(500),
        product_image VARCHAR(1000),
        quantity INTEGER DEFAULT 0,
        unit_cost FLOAT DEFAULT 0.0,
        received_qty INTEGER DEFAULT 0,
        is_new_product BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_poi_po_id ON purchase_order_items(purchase_order_id);",
    "CREATE INDEX IF NOT EXISTS idx_poi_sku ON purchase_order_items(sku);",
    """
    CREATE TABLE IF NOT EXISTS generated_barcodes (
        id SERIAL PRIMARY KEY,
        barcode VARCHAR(13) UNIQUE NOT NULL,
        sku VARCHAR(100),
        product_uid VARCHAR(100),
        assigned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_gb_barcode ON generated_barcodes(barcode);",
    "CREATE INDEX IF NOT EXISTS idx_gb_sku ON generated_barcodes(sku);",
]


async def main():
    async with engine.begin() as conn:
        for sql in CREATE_SQL:
            await conn.execute(text(sql))
            print(f"✓ Executed: {sql.strip()[:60]}...")
    print("\n✅ All tables created successfully.")


if __name__ == "__main__":
    asyncio.run(main())
