import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core.config import settings
from app.models.profitability_config import ProfitabilityConfig

engine = create_async_engine(settings.database_url.replace('postgresql://', 'postgresql+asyncpg://'))
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession)

async def test():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(ProfitabilityConfig).limit(1))
        config = res.scalar_one_or_none()
        print(f"Config exists: {config is not None}")
        if config:
            print(f"Warehouse salary: {config.warehouse_salary_per_package}")

asyncio.run(test())
