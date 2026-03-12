"""
Sync API endpoints for triggering and monitoring synchronization.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import SyncLog
from app.schemas import SyncStatusResponse, SyncTriggerResponse
from app.services.sync_service import sync_orders

router = APIRouter()


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
        select(SyncLog).where(SyncLog.status == "running")
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
        from datetime import timedelta
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
    full_sync: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually trigger a sync.
    
    Args:
        full_sync: If True, fetches ALL orders. If False (default), uses incremental sync.
    """
    from datetime import timedelta
    
    # Check if sync is already running
    result = await db.execute(
        select(SyncLog).where(SyncLog.status == "running")
    )
    running_sync = result.scalar_one_or_none()
    
    if running_sync:
        # Check if it's a stale sync (running for more than 10 minutes)
        if running_sync.started_at:
            age = datetime.utcnow() - running_sync.started_at
            if age > timedelta(minutes=10):
                # Mark stale sync as failed
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
    
    # Create sync log entry
    sync_log = SyncLog(status="running")
    db.add(sync_log)
    await db.flush()
    await db.refresh(sync_log)
    sync_id = sync_log.id
    
    # Trigger background sync (with full_sync flag)
    background_tasks.add_task(sync_orders, sync_id, full_sync)
    
    sync_type = "full" if full_sync else "incremental"
    return SyncTriggerResponse(
        message=f"{sync_type.capitalize()} sync triggered successfully",
        sync_id=sync_id
    )


@router.get("/history")
async def get_sync_history(
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Get sync history."""
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
            "orders_fetched": log.orders_fetched,
            "orders_new": log.orders_new,
            "orders_updated": log.orders_updated,
            "error_message": log.error_message
        }
        for log in logs
    ]
