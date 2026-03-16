"""
System monitoring API — live logs, sync status, system info.
Provides full visibility into what the application is doing.
"""
import logging
import os
import time
from datetime import datetime, timedelta
from collections import deque
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import SyncLog, Order, Store, OrderAwb
from app.services.scheduler import scheduler

router = APIRouter()

# ═══════════════════ IN-MEMORY LOG BUFFER ═══════════════════
# Ring buffer that captures the last N log messages from the application
MAX_LOG_ENTRIES = 500
_log_buffer: deque = deque(maxlen=MAX_LOG_ENTRIES)
_app_start_time = time.time()


class BufferedLogHandler(logging.Handler):
    """Custom handler that stores log records in a ring buffer."""
    def emit(self, record):
        try:
            entry = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            }
            _log_buffer.append(entry)
        except Exception:
            pass


def setup_log_capture():
    """Attach the buffered handler to the root logger."""
    handler = BufferedLogHandler()
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger().addHandler(handler)
    # Also capture uvicorn access logs
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "app", "app.services"):
        logging.getLogger(name).addHandler(handler)


# Auto-setup on import
setup_log_capture()


# ═══════════════════ ENDPOINTS ═══════════════════

@router.get("/logs")
async def get_live_logs(
    limit: int = Query(100, le=500),
    level: Optional[str] = Query(None, description="Filter by level: DEBUG, INFO, WARNING, ERROR"),
    search: Optional[str] = Query(None, description="Search in log messages"),
):
    """Get recent application logs from the in-memory buffer."""
    logs = list(_log_buffer)
    
    if level:
        logs = [l for l in logs if l["level"] == level.upper()]
    if search:
        search_lower = search.lower()
        logs = [l for l in logs if search_lower in l["message"].lower()]
    
    # Return most recent first
    logs.reverse()
    return {
        "logs": logs[:limit],
        "total_buffered": len(_log_buffer),
        "buffer_capacity": MAX_LOG_ENTRIES,
    }


@router.get("/info")
async def get_system_info(db: AsyncSession = Depends(get_db)):
    """Get system overview — uptime, DB stats, scheduler status, config."""
    # Uptime
    uptime_seconds = time.time() - _app_start_time
    uptime_str = str(timedelta(seconds=int(uptime_seconds)))
    
    # DB stats
    order_count = (await db.execute(select(func.count(Order.id)))).scalar() or 0
    store_count = (await db.execute(select(func.count(Store.id)))).scalar() or 0
    awb_count = (await db.execute(select(func.count(OrderAwb.id)))).scalar() or 0
    
    # Last sync
    last_sync_result = await db.execute(
        select(SyncLog)
        .where(SyncLog.status == "completed")
        .order_by(SyncLog.completed_at.desc())
        .limit(1)
    )
    last_sync = last_sync_result.scalar_one_or_none()
    
    # Running sync
    running_result = await db.execute(
        select(SyncLog)
        .where(SyncLog.status == "running")
        .order_by(SyncLog.started_at.desc())
        .limit(1)
    )
    running_sync = running_result.scalar_one_or_none()
    
    # Next scheduled job
    jobs = scheduler.get_jobs()
    next_run = None
    scheduler_jobs = []
    for job in jobs:
        job_info = {
            "id": job.id,
            "name": job.name,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger),
        }
        scheduler_jobs.append(job_info)
        if job.next_run_time and (next_run is None or job.next_run_time < next_run):
            next_run = job.next_run_time
    
    return {
        "uptime": uptime_str,
        "uptime_seconds": int(uptime_seconds),
        "started_at": datetime.utcfromtimestamp(_app_start_time).isoformat() + "Z",
        "database": {
            "orders": order_count,
            "stores": store_count,
            "awbs": awb_count,
        },
        "sync": {
            "status": "running" if running_sync else "idle",
            "running_since": running_sync.started_at.isoformat() + "Z" if running_sync and running_sync.started_at else None,
            "last_completed": last_sync.completed_at.isoformat() + "Z" if last_sync and last_sync.completed_at else None,
            "last_fetched": last_sync.orders_fetched if last_sync else 0,
            "last_new": last_sync.orders_new if last_sync else 0,
            "last_updated": last_sync.orders_updated if last_sync else 0,
            "next_scheduled": next_run.isoformat() if next_run else None,
        },
        "scheduler": {
            "running": scheduler.running,
            "jobs": scheduler_jobs,
        },
        "environment": {
            "python_pid": os.getpid(),
            "log_buffer_size": len(_log_buffer),
        }
    }


@router.get("/sync-history")
async def get_sync_history_detailed(
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed sync history with all fields."""
    result = await db.execute(
        select(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    
    return {
        "history": [
            {
                "id": log.id,
                "status": log.status,
                "started_at": log.started_at.isoformat() + "Z" if log.started_at else None,
                "completed_at": log.completed_at.isoformat() + "Z" if log.completed_at else None,
                "duration_seconds": int((log.completed_at - log.started_at).total_seconds()) if log.completed_at and log.started_at else None,
                "orders_fetched": log.orders_fetched,
                "orders_new": log.orders_new,
                "orders_updated": log.orders_updated,
                "error_message": log.error_message,
            }
            for log in logs
        ]
    }


@router.get("/user-activity")
async def get_user_activity(db: AsyncSession = Depends(get_db)):
    """Get per-user activity stats — online status, requests, avg activity."""
    from app.models.user import User
    from app.models.user_activity import UserActivity
    
    now = datetime.utcnow()
    five_min_ago = now - timedelta(minutes=5)
    twenty_four_h_ago = now - timedelta(hours=24)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Get all users
    users_result = await db.execute(select(User).order_by(User.created_at))
    users = users_result.scalars().all()
    
    user_stats = []
    for user in users:
        # Last activity
        last_activity_result = await db.execute(
            select(UserActivity.timestamp)
            .where(UserActivity.username == user.username)
            .order_by(UserActivity.timestamp.desc())
            .limit(1)
        )
        last_activity = last_activity_result.scalar_one_or_none()
        
        # Is online (activity in last 5 min)
        is_online = last_activity and last_activity > five_min_ago
        
        # Requests today
        today_count = (await db.execute(
            select(func.count(UserActivity.id))
            .where(UserActivity.username == user.username)
            .where(UserActivity.timestamp >= today_start)
        )).scalar() or 0
        
        # Requests last 24h
        day_count = (await db.execute(
            select(func.count(UserActivity.id))
            .where(UserActivity.username == user.username)
            .where(UserActivity.timestamp >= twenty_four_h_ago)
        )).scalar() or 0
        
        # Total requests all time
        total_count = (await db.execute(
            select(func.count(UserActivity.id))
            .where(UserActivity.username == user.username)
        )).scalar() or 0
        
        # First activity (for avg calculation)
        first_activity_result = await db.execute(
            select(UserActivity.timestamp)
            .where(UserActivity.username == user.username)
            .order_by(UserActivity.timestamp.asc())
            .limit(1)
        )
        first_activity = first_activity_result.scalar_one_or_none()
        
        # Avg requests per hour (based on total time span)
        avg_per_hour = 0
        if first_activity and total_count > 0:
            hours_active = max((now - first_activity).total_seconds() / 3600, 1)
            avg_per_hour = round(total_count / hours_active, 1)
        
        user_stats.append({
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name or user.username,
            "role": user.role,
            "is_active": user.is_active,
            "is_online": is_online,
            "last_activity": last_activity.isoformat() + "Z" if last_activity else None,
            "last_login": user.last_login.isoformat() + "Z" if user.last_login else None,
            "requests_today": today_count,
            "requests_24h": day_count,
            "requests_total": total_count,
            "avg_requests_per_hour": avg_per_hour,
        })
    
    return {
        "users": user_stats,
        "active_now": sum(1 for u in user_stats if u["is_online"]),
        "total_users": len(user_stats),
    }

