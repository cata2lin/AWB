"""
Sync API endpoints for triggering and monitoring synchronization.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.models import SyncLog
from app.schemas import SyncStatusResponse, SyncTriggerResponse
from app.services.sync_service import sync_orders

router = APIRouter()
logger = logging.getLogger(__name__)


class SyncTriggerRequest(BaseModel):
    """Request body for triggering a sync."""
    sync_type: str = "45_day"  # 45_day, full, custom
    store_uids: Optional[List[str]] = None
    date_from: Optional[str] = None  # ISO date string
    date_to: Optional[str] = None    # ISO date string


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
            orders_new=running_sync.orders_new
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
        next_sync=next_sync
    )


@router.post("/trigger", response_model=SyncTriggerResponse)
async def trigger_sync(
    background_tasks: BackgroundTasks,
    body: Optional[SyncTriggerRequest] = None,
    full_sync: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually trigger a sync.
    
    Accepts JSON body with sync_type, store_uids, date_from, date_to.
    Also supports legacy ?full_sync=true query param.
    """
    # Parse body or use query params
    req = body or SyncTriggerRequest()
    if full_sync and req.sync_type == "45_day":
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
            if age > timedelta(minutes=10):
                running_sync.status = "failed"
                running_sync.completed_at = datetime.utcnow()
                running_sync.error_message = "Sync timed out (exceeded 10 minutes)"
                await db.commit()
            else:
                return SyncTriggerResponse(
                    message="Sync already in progress",
                    sync_id=0
                )
        else:
            return SyncTriggerResponse(
                message="Sync already in progress",
                sync_id=0
            )
    
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
    
    type_labels = {"45_day": "45-day", "full": "Full", "custom": "Custom"}
    label = type_labels.get(req.sync_type, req.sync_type)
    return SyncTriggerResponse(
        message=f"{label} sync triggered successfully",
        sync_id=sync_id
    )


@router.post("/cancel")
async def cancel_sync(db: AsyncSession = Depends(get_db)):
    """
    Cancel all running syncs — marks them as cancelled so new syncs can start.
    Use this when syncs get stuck after program restarts.
    """
    result = await db.execute(
        select(SyncLog).where(SyncLog.status == "running")
    )
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
        "cancelled_count": cancelled_count
    }


@router.get("/history")
async def get_sync_history(
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get sync history with type and filter details."""
    result = await db.execute(
        select(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    
    return [
        {
            "id": log.id,
            "started_at": log.started_at,
            "completed_at": log.completed_at,
            "status": log.status,
            "sync_type": getattr(log, "sync_type", "45_day") or "45_day",
            "orders_fetched": log.orders_fetched,
            "orders_new": log.orders_new,
            "orders_updated": log.orders_updated,
            "store_uids": getattr(log, "store_uids", None),
            "date_from": getattr(log, "date_from", None),
            "date_to": getattr(log, "date_to", None),
            "error_message": log.error_message
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
