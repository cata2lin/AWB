"""
Print analytics and quick summary endpoints.
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import PrintBatch, PrintBatchItem, Order, Store

router = APIRouter()


@router.get("")
async def get_analytics(
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get analytics data for the dashboard."""
    
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Total print batches
    batch_count_result = await db.execute(
        select(func.count(PrintBatch.id)).where(
            PrintBatch.created_at >= start_date,
            PrintBatch.status == "completed"
        )
    )
    total_batches = batch_count_result.scalar() or 0
    
    # Total orders printed
    printed_count_result = await db.execute(
        select(func.count(PrintBatchItem.id)).join(PrintBatch).where(
            PrintBatch.created_at >= start_date,
            PrintBatch.status == "completed"
        )
    )
    total_printed = printed_count_result.scalar() or 0
    
    # Orders by day (for chart)
    daily_query = await db.execute(
        select(
            func.date(PrintBatch.created_at).label("date"),
            func.count(PrintBatchItem.id).label("count")
        )
        .join(PrintBatchItem, PrintBatch.id == PrintBatchItem.batch_id)
        .where(
            PrintBatch.created_at >= start_date,
            PrintBatch.status == "completed"
        )
        .group_by(func.date(PrintBatch.created_at))
        .order_by(func.date(PrintBatch.created_at))
    )
    daily_data = [
        {"date": str(row.date), "printed": row.count}
        for row in daily_query.all()
    ]
    
    # Fill in missing days with zeros
    date_set = {d["date"] for d in daily_data}
    current = start_date.date()
    end = datetime.utcnow().date()
    filled_daily = []
    while current <= end:
        date_str = str(current)
        existing = next((d for d in daily_data if d["date"] == date_str), None)
        filled_daily.append({
            "date": date_str,
            "dateLabel": current.strftime("%b %d"),
            "printed": existing["printed"] if existing else 0
        })
        current += timedelta(days=1)
    
    # Orders by hour (for today)
    today = datetime.utcnow().date()
    hourly_query = await db.execute(
        select(
            extract("hour", PrintBatch.created_at).label("hour"),
            func.count(PrintBatchItem.id).label("count")
        )
        .join(PrintBatchItem, PrintBatch.id == PrintBatchItem.batch_id)
        .where(
            func.date(PrintBatch.created_at) == today,
            PrintBatch.status == "completed"
        )
        .group_by(extract("hour", PrintBatch.created_at))
    )
    hourly_data_raw = {int(row.hour): row.count for row in hourly_query.all()}
    hourly_data = [
        {"hour": f"{h:02d}:00", "count": hourly_data_raw.get(h, 0)}
        for h in range(24)
    ]
    
    # Recent print batches (sessions)
    recent_query = await db.execute(
        select(PrintBatch)
        .where(PrintBatch.status == "completed")
        .order_by(PrintBatch.created_at.desc())
        .limit(10)
    )
    recent_batches = recent_query.scalars().all()
    
    sessions = []
    for batch in recent_batches:
        # Get order count for this batch
        count_result = await db.execute(
            select(func.count(PrintBatchItem.id)).where(
                PrintBatchItem.batch_id == batch.id
            )
        )
        order_count = count_result.scalar() or 0
        
        sessions.append({
            "id": batch.id,
            "batch_number": batch.batch_number,
            "created_at": batch.created_at.isoformat() if batch.created_at else None,
            "order_count": order_count,
            "status": batch.status
        })
    
    # Calculate KPIs
    avg_per_day = round(total_printed / max(days, 1), 1) if total_printed > 0 else 0
    
    # Batches today
    batches_today_result = await db.execute(
        select(func.count(PrintBatch.id)).where(
            func.date(PrintBatch.created_at) == today,
            PrintBatch.status == "completed"
        )
    )
    batches_today = batches_today_result.scalar() or 0
    
    # Find peak hour
    peak_hour = max(hourly_data, key=lambda x: x["count"])["hour"] if hourly_data else "10:00"
    
    # Store distribution
    store_query = await db.execute(
        select(
            Store.name,
            func.count(PrintBatchItem.id).label("count")
        )
        .join(Order, PrintBatchItem.order_uid == Order.uid)
        .join(Store, Order.store_uid == Store.uid)
        .join(PrintBatch, PrintBatchItem.batch_id == PrintBatch.id)
        .where(
            PrintBatch.created_at >= start_date,
            PrintBatch.status == "completed"
        )
        .group_by(Store.name)
        .order_by(func.count(PrintBatchItem.id).desc())
    )
    store_distribution = [
        {"name": row.name, "count": row.count}
        for row in store_query.all()
    ]
    
    return {
        "kpis": {
            "total_printed": total_printed,
            "total_batches": total_batches,
            "avg_per_day": avg_per_day,
            "batches_today": batches_today,
            "peak_hour": peak_hour,
        },
        "daily_data": filled_daily,
        "hourly_data": hourly_data,
        "recent_sessions": sessions,
        "store_distribution": store_distribution,
    }


@router.get("/summary")
async def get_quick_summary(db: AsyncSession = Depends(get_db)):
    """Quick summary for dashboard cards."""
    
    today = datetime.utcnow().date()
    
    # Orders printed today
    today_result = await db.execute(
        select(func.count(PrintBatchItem.id))
        .join(PrintBatch)
        .where(
            func.date(PrintBatch.created_at) == today,
            PrintBatch.status == "completed"
        )
    )
    printed_today = today_result.scalar() or 0
    
    # Total unprinted orders
    unprinted_result = await db.execute(
        select(func.count(Order.id)).where(Order.is_printed == False)
    )
    unprinted = unprinted_result.scalar() or 0
    
    return {
        "printed_today": printed_today,
        "unprinted_orders": unprinted,
    }
