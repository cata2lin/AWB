"""Migration: Create order_awbs table and backfill from existing orders."""
import asyncio
from sqlalchemy import text
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import engine


async def migrate():
    async with engine.begin() as conn:
        # Create the table
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS order_awbs ("
            "  id SERIAL PRIMARY KEY,"
            "  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,"
            "  tracking_number VARCHAR(100) NOT NULL,"
            "  courier_name VARCHAR(100),"
            "  awb_type VARCHAR(20) DEFAULT 'outbound',"
            "  transport_cost FLOAT,"
            "  package_count INTEGER,"
            "  package_weight FLOAT,"
            "  data_source VARCHAR(50) DEFAULT 'frisbo_sync',"
            "  created_at TIMESTAMP DEFAULT NOW()"
            ")"
        ))
        print("Table order_awbs created (or already exists).")
        
        # Create indexes
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_awbs_tracking ON order_awbs(tracking_number)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_order_awbs_order_id ON order_awbs(order_id)"
        ))
        print("Indexes created.")
        
        # Backfill: copy existing tracking_number from orders into order_awbs
        result = await conn.execute(text(
            "INSERT INTO order_awbs (order_id, tracking_number, courier_name, awb_type, "
            "  transport_cost, package_count, package_weight, data_source, created_at) "
            "SELECT o.id, o.tracking_number, o.courier_name, 'outbound', "
            "  o.transport_cost, o.package_count, o.package_weight, "
            "  COALESCE(o.shipping_data_source, 'frisbo_sync'), NOW() "
            "FROM orders o "
            "WHERE o.tracking_number IS NOT NULL "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM order_awbs oa "
            "  WHERE oa.order_id = o.id AND oa.tracking_number = o.tracking_number"
            ")"
        ))
        print(f"Backfilled {result.rowcount} existing AWBs into order_awbs")
    
    print("Migration complete!")


if __name__ == "__main__":
    asyncio.run(migrate())
