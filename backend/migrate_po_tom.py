"""One-time migration: add TOM integration fields to PO tables + create po_sync_logs."""
import asyncio
from sqlalchemy import text
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from app.core.database import engine as async_engine

async def migrate():
    async with async_engine.begin() as conn:
        r = await conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='purchase_orders' AND column_name='tom_number'"))
        if r.fetchone():
            print("Migration already applied")
            return

        po_cols = [
            "ADD COLUMN IF NOT EXISTS title VARCHAR(500)",
            "ADD COLUMN IF NOT EXISTS po_category VARCHAR(20) DEFAULT 'packaging'",
            "ADD COLUMN IF NOT EXISTS po_type VARCHAR(20) DEFAULT 'RESTOCK'",
            "ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'STANDARD'",
            "ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)",
            "ADD COLUMN IF NOT EXISTS tom_number VARCHAR(50) UNIQUE",
            "ADD COLUMN IF NOT EXISTS tom_po_id VARCHAR(255)",
            "ADD COLUMN IF NOT EXISTS tom_status VARCHAR(50)",
            "ADD COLUMN IF NOT EXISTS tom_sent_at TIMESTAMP",
            "ADD COLUMN IF NOT EXISTS tom_send_idempotency_key VARCHAR(255)",
            "ADD COLUMN IF NOT EXISTS tom_refreshed_at TIMESTAMP",
            "ADD COLUMN IF NOT EXISTS tom_supplier_name VARCHAR(255)",
            "ADD COLUMN IF NOT EXISTS tom_supplier_url VARCHAR(1000)",
            "ADD COLUMN IF NOT EXISTS tom_shipment_code VARCHAR(100)",
            "ADD COLUMN IF NOT EXISTS tom_shipment_mode VARCHAR(50)",
            "ADD COLUMN IF NOT EXISTS tom_shipment_eta TIMESTAMP",
            "ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
            "ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
            "ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP",
        ]
        for col in po_cols:
            await conn.execute(text(f"ALTER TABLE purchase_orders {col}"))

        await conn.execute(text("UPDATE purchase_orders SET status = UPPER(status) WHERE status <> UPPER(status)"))

        poi_cols = [
            "ADD COLUMN IF NOT EXISTS product_uid VARCHAR(100)",
            "ADD COLUMN IF NOT EXISTS variant_title VARCHAR(255)",
            "ADD COLUMN IF NOT EXISTS priority VARCHAR(20)",
            "ADD COLUMN IF NOT EXISTS item_type VARCHAR(20)",
            "ADD COLUMN IF NOT EXISTS tom_item_id VARCHAR(255)",
            "ADD COLUMN IF NOT EXISTS tom_status VARCHAR(50)",
            "ADD COLUMN IF NOT EXISTS tom_ordered_qty INTEGER",
            "ADD COLUMN IF NOT EXISTS tom_received_qty INTEGER",
            "ADD COLUMN IF NOT EXISTS tom_shipped_qty INTEGER",
            "ADD COLUMN IF NOT EXISTS tom_unit_cost_usd NUMERIC(12,4)",
            "ADD COLUMN IF NOT EXISTS tom_extra_cost_usd NUMERIC(12,4)",
            "ADD COLUMN IF NOT EXISTS tom_shipment_code VARCHAR(100)",
            "ADD COLUMN IF NOT EXISTS tom_matched_by VARCHAR(50)",
            "ADD COLUMN IF NOT EXISTS tom_cancel_reason VARCHAR(500)",
            "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        ]
        for col in poi_cols:
            await conn.execute(text(f"ALTER TABLE purchase_order_items {col}"))

        await conn.execute(text("UPDATE purchase_order_items SET item_type = CASE WHEN is_new_product THEN 'NEW_PRODUCT' ELSE 'RESTOCK' END WHERE item_type IS NULL AND is_new_product IS NOT NULL"))

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS po_sync_logs (
                id SERIAL PRIMARY KEY,
                purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
                action VARCHAR(50) NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                items_affected INTEGER DEFAULT 0,
                details JSONB,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_po_sync_logs_po_id ON po_sync_logs(purchase_order_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_po_sync_logs_created ON po_sync_logs(created_at)"))

        print("Migration complete: PO TOM integration fields + po_sync_logs table created")

asyncio.run(migrate())
