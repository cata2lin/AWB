import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core.config import settings
from app.api.comision_agentie import get_comision_agentie

engine = create_async_engine(settings.database_url.replace('postgresql://', 'postgresql+asyncpg://'))
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession)

async def test():
    async with AsyncSessionLocal() as db:
        print("Fetching comision_agentie...")
        data = await get_comision_agentie(db=db, month="2026-04", comision_pct=None)
        print("Done!")
        print(f"Total stores: {len(data['stores'])}")
        print(data['summary'])

asyncio.run(test())
