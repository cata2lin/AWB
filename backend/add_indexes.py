import asyncio
from sqlalchemy import text
from app.core.database import engine

async def main():
    print("Connecting to PostgreSQL...")
    async with engine.begin() as conn:
        indexes = [
            "CREATE INDEX IF NOT EXISTS ix_orders_frisbo_created_at ON orders(frisbo_created_at);",
            "CREATE INDEX IF NOT EXISTS ix_orders_store_uid ON orders(store_uid);",
            "CREATE INDEX IF NOT EXISTS ix_products_barcode ON products(barcode);",
            "CREATE INDEX IF NOT EXISTS ix_products_state ON products(state);"
        ]
        
        for idx in indexes:
            print(f"Executing: {idx}")
            await conn.execute(text(idx))
            
    print("Database indexes successfully added!")

if __name__ == "__main__":
    asyncio.run(main())
