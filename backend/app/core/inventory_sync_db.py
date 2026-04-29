"""
Second database connection for the InventorySync external database.

Read-only async engine used to pull stock levels from the inventory sync system.
Both databases share the same PostgreSQL server (38.242.226.83), different databases.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.core.config import settings


def _get_async_url(url: str) -> str:
    """Convert postgresql:// to postgresql+asyncpg://"""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


inventory_sync_engine = create_async_engine(
    _get_async_url(settings.inventory_sync_db_url),
    echo=False,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=5,
)

InventorySyncSession = async_sessionmaker(
    inventory_sync_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_inventory_sync_db() -> AsyncSession:
    """Dependency for getting read-only sessions to the InventorySync database."""
    async with InventorySyncSession() as session:
        try:
            yield session
        finally:
            await session.close()
