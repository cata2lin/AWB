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

    # ── Tier 5: 30-day CREATED_AT recheck — every 3 hours ───────────────────
    # The updated_at tiers above only re-read an order when Frisbo bumps its
    # updated_at. When a courier-status change is ingested WITHOUT bumping
    # updated_at, those tiers never see it and the order goes STALE. This tier
    # re-fetches every order CREATED in the last 30 days and refreshes its
    # current aggregated_status regardless of updated_at — the cure for stale
    # orders. 3-hour cadence balances freshness against Frisbo API load.
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(hours=3),
        kwargs={"sync_type": "recheck_30d"},
        id="order_sync_recheck_30d",
        name="Tier 5 — 30-day recheck (created_at >= now-30d, status refresh)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Tier 5 — 30-day created_at recheck every 3 hours")

    # ── Tier 6: 90-day CREATED_AT recheck — every 24 hours ──────────────────
    # Same created_at recheck as Tier 5 but a wider 90-day window, run daily.
    # Catches the long tail: orders whose status finalises (delivery/return) 30-90
    # days after creation WITHOUT Frisbo bumping updated_at — missed by both the
    # updated_at tiers and the 30-day recheck. Daily cadence keeps the extra
    # API load modest (older orders are mostly terminal already).
    scheduler.add_job(
        sync_orders,
        trigger=IntervalTrigger(hours=24),
        kwargs={"sync_type": "recheck_90d"},
        id="order_sync_recheck_90d",
        name="Tier 6 — 90-day recheck (created_at >= now-90d, long-tail refresh)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Tier 6 — 90-day created_at recheck every 24 hours")

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

    # ── eMAG marketplace order sync — every 30 minutes ──────────────────────
    # Pulls eMAG (RO/BG/HU) orders into marketplace_orders. INERT no-op until
    # EMAG_<MP>_USER/PASS env vars are set AND the server IP is allow-listed —
    # sync_emag_orders returns immediately when no marketplace is configured.
    from app.services.emag.sync import sync_emag_orders
    from app.core.database import AsyncSessionLocal

    async def _emag_sync_job():
        async with AsyncSessionLocal() as db:
            await sync_emag_orders(db)

    scheduler.add_job(
        _emag_sync_job,
        trigger=IntervalTrigger(minutes=30),
        id="emag_order_sync",
        name="eMAG marketplace order sync (inert until creds set)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 eMAG order sync every 30 minutes (inert until creds)")

    # ── Marketing self-heal — every 12 h ────────────────────────────────────
    # Re-sync the CPA sheet for a rolling trailing 35-day window so marketing_daily_costs
    # never lags the sheet again (the gap that left 2026-03 71% missing). The sync is
    # non-destructive: it aborts (leaves the DB untouched) if all sheet fetches fail.
    from app.services.google_sheets import sync_marketing_costs
    from datetime import date as _date, timedelta as _td

    async def _marketing_sync_job():
        async with AsyncSessionLocal() as db:
            today = _date.today()
            await sync_marketing_costs(db, today - _td(days=35), today)

    scheduler.add_job(
        _marketing_sync_job,
        trigger=IntervalTrigger(hours=12),
        id="marketing_self_heal",
        name="Marketing self-heal (CPA sheet → trailing 35d, non-destructive)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Marketing self-heal every 12 hours (trailing 35d)")

    # ── BNR exchange-rate sync — every 12 h ─────────────────────────────────
    # The FX table was only synced at app startup, so a long-running process never
    # ingested new daily BNR rates. This keeps EUR/CZK/PLN/USD current for the P&L.
    from app.api.exchange_rates import sync_bnr_rates

    async def _bnr_sync_job():
        async with AsyncSessionLocal() as db:
            await sync_bnr_rates(db)

    scheduler.add_job(
        _bnr_sync_job,
        trigger=IntervalTrigger(hours=12),
        id="bnr_rate_sync",
        name="BNR exchange-rate sync (keeps FX current for the P&L)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 BNR exchange-rate sync every 12 hours")

    # ── Stuck-sync watchdog — every 30 min ──────────────────────────────────
    # The lifespan guard only clears stale `running` sync_logs at STARTUP. If a sync
    # hangs in a live process, its `running` row + APScheduler max_instances=1 silently
    # block that tier until a restart. This independent job marks any `running` sync
    # older than 2h as failed so the tier can resume without a restart.
    from sqlalchemy import select as _select
    from datetime import datetime as _dt, timedelta as _td2
    from app.models import SyncLog

    async def _sync_watchdog_job():
        async with AsyncSessionLocal() as db:
            cutoff = _dt.utcnow() - _td2(hours=2)
            stale = (
                (
                    await db.execute(
                        _select(SyncLog).where(
                            SyncLog.status == "running", SyncLog.started_at < cutoff
                        )
                    )
                )
                .scalars()
                .all()
            )
            for sl in stale:
                sl.status = "failed"
                sl.completed_at = _dt.utcnow()
                sl.error_message = "Auto-failed by watchdog (running > 2h)"
            if stale:
                await db.commit()
                logger.warning(
                    f"📅 Watchdog auto-failed {len(stale)} stuck running sync(s)"
                )

    scheduler.add_job(
        _sync_watchdog_job,
        trigger=IntervalTrigger(minutes=30),
        id="sync_watchdog",
        name="Stuck-sync watchdog (auto-fail running > 2h)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info("📅 Stuck-sync watchdog every 30 minutes")

    # ── Stuck-order reconciliation — daily ──────────────────────────────────
    # Closes the staleness loop: a SHIPPED order (has tracking) that has sat in a
    # non-terminal status for >90 days will never resolve (no source confirms delivery),
    # so it's written off terminally as a transport loss (lost_in_transit → returned).
    # Needs NO external source — pure aged-out policy — so it runs reliably in prod.
    # Guarantees no order can stay stuck past 90 days. The sync's don't-downgrade rule
    # keeps it; a genuine later 'delivered' (terminal→terminal) still overrides.
    from app.services.stuck_reconciliation import aged_out_stuck_orders

    async def _stuck_reconciliation_job():
        async with AsyncSessionLocal() as db:
            await aged_out_stuck_orders(db, age_days=90, apply=True)

    scheduler.add_job(
        _stuck_reconciliation_job,
        trigger=IntervalTrigger(hours=24),
        id="stuck_reconciliation",
        name="Aged-out stuck-order write-off (>90d non-terminal → lost_in_transit)",
        replace_existing=True,
        max_instances=1,
    )
    logger.info(
        "📅 Stuck-order reconciliation daily (>90d non-terminal → terminal write-off)"
    )


# Setup jobs when module loads
setup_sync_jobs()
