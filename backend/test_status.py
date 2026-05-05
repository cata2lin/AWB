import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core.config import settings
from sqlalchemy import select
from app.models import PurchaseOrder

engine = create_async_engine(settings.database_url.replace('postgresql://', 'postgresql+asyncpg://'))
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession)

async def test():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(PurchaseOrder.status).distinct())
        print([r[0] for r in res.all()])

asyncio.run(test())
