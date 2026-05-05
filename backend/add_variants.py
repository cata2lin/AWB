import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def alter_tables():
    async with AsyncSessionLocal() as session:
        try:
            await session.execute(text("ALTER TABLE products ADD COLUMN tom_variant_1 VARCHAR(255)"))
            await session.commit()
            print("Added tom_variant_1 to products")
        except Exception as e:
            await session.rollback()
            print(f"Error adding tom_variant_1 to products: {e}")

        try:
            await session.execute(text("ALTER TABLE products ADD COLUMN tom_variant_2 VARCHAR(255)"))
            await session.commit()
            print("Added tom_variant_2 to products")
        except Exception as e:
            await session.rollback()
            print(f"Error adding tom_variant_2 to products: {e}")

        try:
            await session.execute(text("ALTER TABLE custom_products ADD COLUMN tom_variant_1 VARCHAR(255)"))
            await session.commit()
            print("Added tom_variant_1 to custom_products")
        except Exception as e:
            await session.rollback()
            print(f"Error adding tom_variant_1 to custom_products: {e}")

        try:
            await session.execute(text("ALTER TABLE custom_products ADD COLUMN tom_variant_2 VARCHAR(255)"))
            await session.commit()
            print("Added tom_variant_2 to custom_products")
        except Exception as e:
            await session.rollback()
            print(f"Error adding tom_variant_2 to custom_products: {e}")

if __name__ == "__main__":
    asyncio.run(alter_tables())
