"""
Add sku_costs table and order price fields.
"""
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine


async def migrate():
    async with AsyncSessionLocal() as db:
        # Create sku_costs table
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS sku_costs (
                id SERIAL PRIMARY KEY,
                sku VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(255),
                cost FLOAT DEFAULT 0.0,
                currency VARCHAR(10) DEFAULT 'RON',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        """))
        
        # Add price columns to orders table if they don't exist
        try:
            await db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price FLOAT"))
            await db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_price FLOAT"))
            await db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_discounts FLOAT"))
            await db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'RON'"))
        except Exception as e:
            print(f"Note: Columns may already exist - {e}")
        
        await db.commit()
        print("[OK] Migration complete: sku_costs table created, order price columns added")


if __name__ == "__main__":
    asyncio.run(migrate())
