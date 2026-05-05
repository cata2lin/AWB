import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.models.user import User

engine = create_async_engine(settings.database_url.replace('postgresql://', 'postgresql+asyncpg://'))

async def test():
    async with AsyncSession(engine) as db:
        res = await db.execute(select(User.username))
        for row in res.all():
            print(row[0])

asyncio.run(test())
