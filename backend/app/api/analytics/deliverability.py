"""
Deliverability analytics endpoint — per-store delivery performance.
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, case, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order, Store

router = APIRouter()


@router.get("/deliverability")
async def get_deliverability_stats(
    store_uids: Optional[str] = None,
    days: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get deliverability statistics per store.
    Shows total orders, delivered, cancelled, returned, and deliverability rate.
    """
    # Parse store_uids if provided
    store_uid_list = None
    if store_uids:
        store_uid_list = [s.strip() for s in store_uids.split(',')]
    
    # Build conditions
    conditions = []
    if store_uid_list:
        conditions.append(Order.store_uid.in_(store_uid_list))
    if date_from and date_to:
        conditions.append(Order.frisbo_created_at >= datetime.strptime(date_from, '%Y-%m-%d'))
        conditions.append(Order.frisbo_created_at <= datetime.strptime(date_to, '%Y-%m-%d').replace(hour=23, minute=59, second=59))
    elif days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        conditions.append(Order.frisbo_created_at >= cutoff)
    
    # Query with aggregated status counts per store
    query = select(
        Order.store_uid,
        func.count(Order.id).label('total'),
        func.sum(case((Order.aggregated_status == 'delivered', 1), else_=0)).label('delivered'),
        func.sum(case((Order.aggregated_status == 'cancelled', 1), else_=0)).label('cancelled'),
        func.sum(case((Order.aggregated_status == 'back_to_sender', 1), else_=0)).label('returned'),
        func.sum(case((Order.aggregated_status == 'in_transit', 1), else_=0)).label('in_transit'),
        func.sum(case((Order.aggregated_status == 'out_for_delivery', 1), else_=0)).label('out_for_delivery'),
        func.sum(case((Order.aggregated_status == 'processing', 1), else_=0)).label('processing'),
        func.sum(case((Order.aggregated_status == 'ready_for_pickup', 1), else_=0)).label('ready_for_pickup'),
        func.sum(case((Order.aggregated_status == 'new', 1), else_=0)).label('new'),
        func.sum(case((Order.aggregated_status == 'refused', 1), else_=0)).label('refused'),
        func.sum(case((Order.aggregated_status == 'waiting_for_courier', 1), else_=0)).label('waiting_for_courier'),
    ).group_by(Order.store_uid)
    
    if conditions:
        query = query.where(and_(*conditions))
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get store names
    stores_result = await db.execute(select(Store))
    stores = {s.uid: s.name for s in stores_result.scalars().all()}
    
    # Build response
    store_stats = []
    totals = {
        'total': 0, 'delivered': 0, 'cancelled': 0, 'returned': 0,
        'in_transit': 0, 'out_for_delivery': 0, 'processing': 0,
        'ready_for_pickup': 0, 'new': 0, 'refused': 0,
        'waiting_for_courier': 0, 'shipped': 0
    }
    
    for row in rows:
        total = row.total or 0
        delivered = row.delivered or 0
        cancelled = row.cancelled or 0
        returned = row.returned or 0
        in_transit = row.in_transit or 0
        out_for_delivery = row.out_for_delivery or 0
        refused = row.refused or 0
        
        # Shipped = delivered + in_transit + out_for_delivery (all that left the warehouse)
        shipped = delivered + in_transit + out_for_delivery + returned + refused
        
        # Deliverability rate: delivered / shipped * 100 (from shipped orders, not total)
        rate = (delivered / shipped * 100) if shipped > 0 else 0
        
        # New rates
        delivery_rate = (delivered / shipped * 100) if shipped > 0 else 0
        in_transit_rate = ((in_transit + out_for_delivery) / shipped * 100) if shipped > 0 else 0
        refused_rate = (refused / shipped * 100) if shipped > 0 else 0
        cancelled_rate = (cancelled / total * 100) if total > 0 else 0
        expedition_rate = (shipped / total * 100) if total > 0 else 0
        
        store_stat = {
            'store_uid': row.store_uid,
            'store_name': stores.get(row.store_uid, f'Store {row.store_uid[:8]}...'),
            'total': total,
            'delivered': delivered,
            'cancelled': cancelled,
            'returned': returned,
            'refused': refused,
            'in_transit': in_transit,
            'out_for_delivery': out_for_delivery,
            'processing': row.processing or 0,
            'ready_for_pickup': row.ready_for_pickup or 0,
            'new': row.new or 0,
            'waiting_for_courier': row.waiting_for_courier or 0,
            'shipped': shipped,
            'deliverability_rate': round(rate, 2),
            'delivery_rate': round(delivery_rate, 2),
            'in_transit_rate': round(in_transit_rate, 2),
            'refused_rate': round(refused_rate, 2),
            'cancelled_rate': round(cancelled_rate, 2),
            'expedition_rate': round(expedition_rate, 2),
        }
        store_stats.append(store_stat)
        
        # Accumulate totals
        for key in totals:
            totals[key] += store_stat.get(key, 0)
    
    # Calculate total rates
    shipped_total = totals['shipped']
    totals['deliverability_rate'] = round(
        (totals['delivered'] / shipped_total * 100) if shipped_total > 0 else 0, 2
    )
    totals['delivery_rate'] = round(
        (totals['delivered'] / shipped_total * 100) if shipped_total > 0 else 0, 2
    )
    totals['in_transit_rate'] = round(
        ((totals['in_transit'] + totals['out_for_delivery']) / shipped_total * 100) if shipped_total > 0 else 0, 2
    )
    totals['refused_rate'] = round(
        (totals['refused'] / shipped_total * 100) if shipped_total > 0 else 0, 2
    )
    totals['cancelled_rate'] = round(
        (totals['cancelled'] / totals['total'] * 100) if totals['total'] > 0 else 0, 2
    )
    totals['expedition_rate'] = round(
        (shipped_total / totals['total'] * 100) if totals['total'] > 0 else 0, 2
    )
    
    # Sort by total orders descending
    store_stats.sort(key=lambda x: x['total'], reverse=True)
    
    return {
        'stores': store_stats,
        'totals': totals
    }
