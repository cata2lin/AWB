"""
Sync API endpoints for triggering and monitoring synchronization.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.database import get_db
from app.core.timezone import to_bucharest_iso
from app.models import SyncLog
from app.schemas import SyncStatusResponse, SyncTriggerResponse
from app.services.sync_service import sync_orders, SYNC_TYPE_ALIASES

router = APIRouter()
logger = logging.getLogger(__name__)


class SyncTriggerRequest(BaseModel):
    """Request body for triggering a sync."""

    sync_type: str = (
        "window_30d"  # incremental, recent_7d, window_30d, deep_90d, full, custom
    )
    store_uids: Optional[List[str]] = None
    date_from: Optional[str] = None  # ISO date string
    date_to: Optional[str] = None  # ISO date string


@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Get current sync status."""
    # Get last completed sync
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.status == "completed")
        .order_by(SyncLog.completed_at.desc())
        .limit(1)
    )
    last_sync = result.scalar_one_or_none()

    # Check for running sync
    running_result = await db.execute(
        select(SyncLog)
        .where(SyncLog.status == "running")
        .order_by(SyncLog.started_at.desc())
        .limit(1)
    )
    running_sync = running_result.scalar_one_or_none()

    if running_sync:
        return SyncStatusResponse(
            status="running",
            last_sync=last_sync.completed_at if last_sync else None,
            orders_fetched=running_sync.orders_fetched,
            orders_new=running_sync.orders_new,
        )

    # Calculate next sync time (30 mins from last sync)
    next_sync = None
    if last_sync and last_sync.completed_at:
        next_sync = last_sync.completed_at + timedelta(minutes=30)

    return SyncStatusResponse(
        status="idle",
        last_sync=last_sync.completed_at if last_sync else None,
        orders_fetched=last_sync.orders_fetched if last_sync else 0,
        orders_new=last_sync.orders_new if last_sync else 0,
        next_sync=next_sync,
    )


@router.post("/trigger", response_model=SyncTriggerResponse)
async def trigger_sync(
    background_tasks: BackgroundTasks,
    body: Optional[SyncTriggerRequest] = None,
    full_sync: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger a sync.

    Accepts JSON body with sync_type, store_uids, date_from, date_to.
    Also supports legacy ?full_sync=true query param.
    """
    # Parse body or use query params
    req = body or SyncTriggerRequest()
    # Normalize legacy sync_type aliases ("3_day" -> "recent_7d", "45_day" -> "window_30d")
    # so the SyncLog row and downstream label-rendering see the canonical name.
    req.sync_type = SYNC_TYPE_ALIASES.get(req.sync_type, req.sync_type)
    if full_sync and req.sync_type == "window_30d":
        req.sync_type = "full"

    # Check if sync is already running
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.status == "running")
        .order_by(SyncLog.started_at.desc())
        .limit(1)
    )
    running_sync = result.scalar_one_or_none()

    if running_sync:
        if running_sync.started_at:
            age = datetime.utcnow() - running_sync.started_at
            if age > timedelta(minutes=60):
                running_sync.status = "failed"
                running_sync.completed_at = datetime.utcnow()
                running_sync.error_message = "Sync timed out (exceeded 60 minutes)"
                await db.commit()
            else:
                return SyncTriggerResponse(
                    message="Sync already in progress", sync_id=0
                )
        else:
            return SyncTriggerResponse(message="Sync already in progress", sync_id=0)

    # Create sync log entry with type info
    sync_log = SyncLog(status="running", sync_type=req.sync_type)
    db.add(sync_log)
    await db.flush()
    await db.refresh(sync_log)
    sync_id = sync_log.id

    # Trigger background sync with all params
    is_full = req.sync_type == "full"
    background_tasks.add_task(
        sync_orders,
        sync_id,
        is_full,
        sync_type=req.sync_type,
        store_uids=req.store_uids,
        date_from=req.date_from,
        date_to=req.date_to,
    )

    type_labels = {
        "incremental": "Incremental",
        "recent_7d": "Recent 7-day",
        "window_30d": "30-day window",
        "deep_90d": "Deep 90-day",
        "full": "Full",
        "custom": "Custom",
    }
    label = type_labels.get(req.sync_type, req.sync_type)
    return SyncTriggerResponse(
        message=f"{label} sync triggered successfully", sync_id=sync_id
    )


@router.post("/cancel")
async def cancel_sync(db: AsyncSession = Depends(get_db)):
    """
    Cancel all running syncs — marks them as cancelled so new syncs can start.
    Use this when syncs get stuck after program restarts.
    """
    result = await db.execute(select(SyncLog).where(SyncLog.status == "running"))
    running = result.scalars().all()

    cancelled_count = 0
    for sync_log in running:
        sync_log.status = "cancelled"
        sync_log.completed_at = datetime.utcnow()
        sync_log.error_message = "Manually cancelled by user"
        cancelled_count += 1

    await db.commit()
    logger.info(f"Cancelled {cancelled_count} running sync(s)")

    return {
        "message": f"Cancelled {cancelled_count} running sync(s)",
        "cancelled_count": cancelled_count,
    }


# aggregated_status values that are NOT terminal — an order in one of these for a
# long time, despite having a tracking number + AWB, is likely a Frisbo status freeze
# (the courier delivered/returned it but Frisbo never advanced the status). AWB has no
# secondary courier/Shopify status source, so it cannot auto-resolve these — this
# endpoint surfaces them so they are visible + actionable rather than silently dropped.
_NONTERMINAL_STATUSES = (
    "fulfilled",
    "waiting_for_courier",
    "processing",
    "not_fulfilled",
    "ready_for_pickup",
    "new",
    "errors_incorrect_shipping_address",
    "awaiting_shipment_generation_initialization",
    "in_transit",
    "out_for_delivery",
    "on_hold",
    "sending",
    "redirected",
    "deferred_delivery",
)


@router.get("/stale-orders")
async def get_stale_orders(
    min_age_days: int = 14, limit: int = 200, db: AsyncSession = Depends(get_db)
):
    """Data-quality report: orders stuck in a non-terminal status despite having a
    tracking number + AWB and being older than `min_age_days` — i.e. Frisbo never
    advanced their lifecycle (the courier likely already delivered/returned them).
    AWB re-pulls these every sync but Frisbo keeps returning the frozen status, and
    there is no courier/Shopify fallback to resolve them — so they are reported here
    for visibility instead of silently undercounting delivered orders."""
    cutoff = datetime.utcnow() - timedelta(days=int(min_age_days))
    params = {"st": list(_NONTERMINAL_STATUSES), "cutoff": cutoff}

    summary = (
        await db.execute(
            text(
                """
        SELECT COUNT(*) n, COALESCE(SUM(total_price),0) rev
        FROM orders
        WHERE aggregated_status = ANY(:st) AND tracking_number IS NOT NULL
          AND awb_count >= 1 AND frisbo_created_at < :cutoff
        """
            ),
            params,
        )
    ).first()

    by_status = [
        {"status": r.aggregated_status, "count": r.n}
        for r in (
            await db.execute(
                text(
                    """
        SELECT aggregated_status, COUNT(*) n FROM orders
        WHERE aggregated_status = ANY(:st) AND tracking_number IS NOT NULL
          AND awb_count >= 1 AND frisbo_created_at < :cutoff
        GROUP BY aggregated_status ORDER BY n DESC"""
                ),
                params,
            )
        ).all()
    ]

    by_store = [
        {"store_uid": r.store_uid, "store": r.name, "count": r.n}
        for r in (
            await db.execute(
                text(
                    """
        SELECT o.store_uid, s.name, COUNT(*) n FROM orders o JOIN stores s ON o.store_uid=s.uid
        WHERE o.aggregated_status = ANY(:st) AND o.tracking_number IS NOT NULL
          AND o.awb_count >= 1 AND o.frisbo_created_at < :cutoff
        GROUP BY o.store_uid, s.name ORDER BY n DESC"""
                ),
                params,
            )
        ).all()
    ]

    sample = [
        {
            "order_number": r.order_number,
            "store_uid": r.store_uid,
            "aggregated_status": r.aggregated_status,
            "tracking_number": r.tracking_number,
            "courier_name": r.courier_name,
            "total_price": float(r.total_price or 0),
            "created_at": to_bucharest_iso(r.frisbo_created_at),
            "age_days": r.age_days,
        }
        for r in (
            await db.execute(
                text(
                    """
        SELECT order_number, store_uid, aggregated_status, tracking_number, courier_name,
               total_price, frisbo_created_at,
               EXTRACT(DAY FROM now() - frisbo_created_at)::int age_days
        FROM orders
        WHERE aggregated_status = ANY(:st) AND tracking_number IS NOT NULL
          AND awb_count >= 1 AND frisbo_created_at < :cutoff
        ORDER BY frisbo_created_at ASC LIMIT :limit"""
                ),
                {**params, "limit": int(limit)},
            )
        ).all()
    ]

    return {
        "min_age_days": min_age_days,
        "stale_count": summary.n,
        "hidden_revenue": round(float(summary.rev or 0), 2),
        "by_status": by_status,
        "by_store": by_store,
        "sample": sample,
        "note": (
            "These orders are stuck UPSTREAM in Frisbo (status never advanced past a "
            "non-terminal state despite a valid AWB/tracking). AWB has no courier/Shopify "
            "fallback to auto-resolve them. Recommended: verify against the courier, or add "
            "a courier-tracking integration so AWB can confirm delivery independently."
        ),
    }


@router.get("/history")
async def get_sync_history(limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Get sync history with type and filter details."""
    result = await db.execute(
        select(SyncLog).order_by(SyncLog.started_at.desc()).limit(limit)
    )
    logs = result.scalars().all()

    return [
        {
            "id": log.id,
            "started_at": to_bucharest_iso(log.started_at),
            "completed_at": to_bucharest_iso(log.completed_at),
            "status": log.status,
            "sync_type": getattr(log, "sync_type", "45_day") or "45_day",
            "orders_fetched": log.orders_fetched,
            "orders_new": log.orders_new,
            "orders_updated": log.orders_updated,
            "orders_skipped": getattr(log, "orders_skipped", 0) or 0,
            "store_uids": getattr(log, "store_uids", None),
            "date_from": getattr(log, "date_from", None),
            "date_to": getattr(log, "date_to", None),
            "error_message": log.error_message,
        }
        for log in logs
    ]


@router.post("/trigger-products")
async def trigger_product_sync(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger a product/inventory sync.
    """
    from app.services.product_sync_service import sync_products

    sync_log = SyncLog(status="running", sync_type="product")
    db.add(sync_log)
    await db.flush()
    await db.refresh(sync_log)
    sync_id = sync_log.id

    background_tasks.add_task(sync_products, sync_id)

    return {
        "message": "Product sync triggered successfully",
        "sync_id": sync_id,
    }


@router.post("/stock-from-inventory")
async def trigger_inventory_stock_sync(background_tasks: BackgroundTasks):
    """
    Manually trigger stock sync from the InventorySync external database.

    Reads stock levels from InventorySync (source of truth for Shopify stock)
    and updates products.stock_available in AWBprint by barcode/SKU match.
    """
    from app.services.stock_sync_service import sync_stock_from_inventory
    from dataclasses import asdict

    result = await sync_stock_from_inventory()

    return {
        "message": "Inventory stock sync completed",
        **asdict(result),
    }
