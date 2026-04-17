"""
Background scheduler for automatic sync jobs.

Dual-strategy sync:
  - Incremental (every 10 min): Fast delta sync using updated_at_start
  - Window (every 6 hours): Full 45-day refresh to catch anything missed
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def setup_sync_jobs():
    """Configure periodic sync jobs."""
    from app.services.sync_service import sync_orders
    
    # ── Job 1: Incremental sync (fast, every 10 minutes) ──
    # Uses updated_at_start from last sync → only fetches changed orders
    # Completes in seconds, keeps statuses fresh
    incremental_minutes = getattr(settings, 'sync_interval_minutes', 10)
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(minutes=incremental_minutes),
        kwargs={"sync_type": "incremental"},
        id="order_sync_incremental",
        name="Incremental order sync (updated_at)",
        replace_existing=True,
        max_instances=1,  # Prevent overlapping syncs
    )
    logger.info(f"📅 Scheduled incremental sync every {incremental_minutes} minutes")
    
    # ── Job 2: Window sync (thorough, every 6 hours) ──
    # Re-fetches all orders from the last 45 days
    # Catches any orders missed by incremental (edge cases)
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(hours=6),
        kwargs={"sync_type": "45_day"},
        id="order_sync_window",
        name="45-day window sync",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Scheduled 45-day window sync every 6 hours")


# Setup jobs when module loads
setup_sync_jobs()
