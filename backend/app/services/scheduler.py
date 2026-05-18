"""
Background scheduler for automatic sync jobs.

Four-layer sync strategy:
  1. Incremental (every 10 min)  — updated_at anchored to last sync's started_at - 15min
     → Real-time coverage during the day. Orders updated in last ~10-25 min are pulled.

  2. 3-day safety net (every 30 min) — updated_at >= now - 3 days (ABSOLUTE window)
     → Key guarantee: even after server restarts or API gaps, orders from the last 3 days
       are never more than 30 minutes stale. Independent of last sync time.

  3. 45-day window (every 6 hours) — created_at >= now - 45 days
     → Catches bulk new orders that might have been missed during extended outages.

  4. Inventory stock sync (every 15 min)
     → Pulls stock from InventorySync DB → updates products.stock_available.

The updated-at catch-up (formerly Job 3) is now MERGED into the incremental
since the incremental already uses updated_at. The 3-day job covers the recency
guarantee independently.
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

    # ── Job 1: Incremental sync — every 10 minutes ──────────────────────────
    # Uses updated_at_start anchored to the *started_at* of the last successful sync.
    # Overlap buffer = 15 min to handle clock skew and long-running syncs.
    # Best-case latency: ~10 min for any order status change.
    incremental_minutes = getattr(settings, 'sync_interval_minutes', 10)
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(minutes=incremental_minutes),
        kwargs={"sync_type": "incremental"},
        id="order_sync_incremental",
        name="Incremental sync (updated_at from last started_at)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info(f"📅 Job 1: Incremental sync every {incremental_minutes} minutes")

    # ── Job 2: 3-day safety net — every 30 minutes ───────────────────────────
    # Queries updated_at >= now - 3 days (ABSOLUTE, never varies).
    # This is the guarantee layer for recent orders: regardless of server restarts,
    # failed incrementals, or any other gap, orders from the last 3 days will always
    # be refreshed within 30 minutes. Covers both NEW orders and STATUS CHANGES.
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(minutes=30),
        kwargs={"sync_type": "3_day"},
        id="order_sync_3day_safety",
        name="3-day safety net (updated_at >= now-3d, absolute)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Job 2: 3-day safety net every 30 minutes")

    # ── Job 3: 45-day window — every 6 hours ─────────────────────────────────
    # Fetches orders created in the last 45 days (created_at filter).
    # Primary purpose: catch bulk new orders missed during extended outages,
    # and refresh orders with no updated_at change (e.g. draft/pending orders).
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(hours=6),
        kwargs={"sync_type": "45_day"},
        id="order_sync_window",
        name="45-day window sync (created_at >= now-45d)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Job 3: 45-day window sync every 6 hours")

    # ── Job 4: Inventory stock sync — every 15 minutes ───────────────────────
    # Pulls real stock levels from the InventorySync external database
    # and updates products.stock_available in AWBprint.
    from app.services.stock_sync_service import sync_stock_from_inventory
    scheduler.add_job(
        sync_stock_from_inventory,
        trigger=IntervalTrigger(minutes=15),
        id="inventory_stock_sync",
        name="Inventory stock sync (InventorySync DB → stock_available)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Job 4: Inventory stock sync every 15 minutes")


# Setup jobs when module loads
setup_sync_jobs()
