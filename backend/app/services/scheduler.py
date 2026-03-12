"""
Background scheduler for automatic sync jobs.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings


scheduler = AsyncIOScheduler()


def setup_sync_job():
    """Configure the periodic sync job."""
    from app.services.sync_service import sync_orders
    
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(minutes=settings.sync_interval_minutes),
        id="order_sync",
        name="Sync orders from Frisbo",
        replace_existing=True
    )


# Setup job when module loads
setup_sync_job()
