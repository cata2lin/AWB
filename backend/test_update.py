import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core.config import settings
from sqlalchemy import select
from app.models.config import AppConfig

engine = create_async_engine(settings.database_url.replace('postgresql://', 'postgresql+asyncpg://'), echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def test():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(AppConfig).where(AppConfig.key == "comision_agentie_config"))
        row = res.scalars().first()
        print("Found config row:", row is not None)
        if row:
            print("Current value:", row.value_json)
            # Try to update it to see if it hangs
            row.value_json = {**row.value_json, "test": "test"}
            print("Attempting to commit...")
            await db.commit()
            print("Commit successful!")

if __name__ == "__main__":
    asyncio.run(test())
