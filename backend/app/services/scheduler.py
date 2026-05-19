"""
Background scheduler for automatic sync jobs.

Four-tier order-sync strategy (all tiers use Frisbo's `updated_at_start`
filter so any status change is picked up regardless of how old the order is):

  Tier 1 — Incremental    (every 10 min)  updated_at >= last_started_at − 15min
    Live coverage for today's active orders.

  Tier 2 — Recent 7-day   (every 20 min)  updated_at >= now − 7 days  (absolute)
    Close-to-live safety net for orders ≤7 days old. Independent of last sync
    time, so server restarts / failed incrementals can't introduce gaps wider
    than ~20 min for recent orders.

  Tier 3 — Window 30-day  (every 2 h)     updated_at >= now − 30 days (absolute)
    Catches late status changes on 7-30 day orders (e.g., an order that
    finally delivers after a long transit). Replaces the old buggy 45-day job
    that filtered by created_at and silently missed any order outside the
    creation window.

  Tier 4 — Deep 90-day    (every 24 h)    updated_at >= now − 90 days (absolute)
    Long-tail catch-up for very old orders that finally deliver / return.

Plus a fifth, non-order job:
  Inventory stock sync   (every 15 min)   InventorySync DB → products.stock_available.

All jobs are baked in (no user toggle). Per-tier behaviour lives in
sync_service.sync_orders(); this module only wires triggers + cadences.
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

    # ── Tier 1: Incremental sync — every 10 minutes ─────────────────────────
    # Uses updated_at_start anchored to the *started_at* of the last successful
    # sync. Overlap buffer = 15 min to handle clock skew and long-running syncs.
    # Best-case latency: ~10 min for any order status change.
    incremental_minutes = getattr(settings, "sync_interval_minutes", 10)
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(minutes=incremental_minutes),
        kwargs={"sync_type": "incremental"},
        id="order_sync_incremental",
        name="Tier 1 — Incremental (updated_at from last started_at)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info(f"📅 Tier 1 — Incremental sync every {incremental_minutes} minutes")

    # ── Tier 2: Recent 7-day safety net — every 20 minutes ──────────────────
    # Queries updated_at >= now - 7 days (ABSOLUTE, never varies).
    # The guarantee layer for recent orders: regardless of server restarts,
    # failed incrementals, or any other gap, orders from the last 7 days are
    # refreshed every 20 minutes. Covers both NEW orders and STATUS CHANGES.
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(minutes=20),
        kwargs={"sync_type": "recent_7d"},
        id="order_sync_recent_7d",
        name="Tier 2 — Recent 7-day (updated_at >= now-7d, absolute)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Tier 2 — Recent 7-day sync every 20 minutes")

    # ── Tier 3: 30-day window — every 2 hours ───────────────────────────────
    # Queries updated_at >= now - 30 days. Catches late status changes on
    # 7-30 day orders. Uses updated_at, NOT created_at — previous "45_day"
    # job filtered on created_at and missed status changes on orders older
    # than the window.
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(hours=2),
        kwargs={"sync_type": "window_30d"},
        id="order_sync_window_30d",
        name="Tier 3 — 30-day window (updated_at >= now-30d)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Tier 3 — 30-day window sync every 2 hours")

    # ── Tier 4: Deep 90-day catch-up — every 24 hours ───────────────────────
    # Queries updated_at >= now - 90 days. Long-tail catch-up for very old
    # orders that finally deliver / return. Daily cadence keeps the Frisbo
    # load low while ensuring no order older than 90 days with a recent
    # status change goes unrefreshed for more than a day.
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(hours=24),
        kwargs={"sync_type": "deep_90d"},
        id="order_sync_deep_90d",
        name="Tier 4 — Deep 90-day (updated_at >= now-90d)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Tier 4 — Deep 90-day sync every 24 hours")

    # ── Inventory stock sync — every 15 minutes ─────────────────────────────
    # Pulls real stock levels from the InventorySync external database and
    # updates products.stock_available in AWBprint.
    from app.services.stock_sync_service import sync_stock_from_inventory

    scheduler.add_job(
        sync_stock_from_inventory,
        trigger=IntervalTrigger(minutes=15),
        id="inventory_stock_sync",
        name="Inventory stock sync (InventorySync DB → stock_available)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Inventory stock sync every 15 minutes")


# Setup jobs when module loads
setup_sync_jobs()
