"""
Orders API endpoints.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, cast, String
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import Order, Store
from app.models.order_awb import OrderAwb
from app.schemas import OrderResponse, OrderFilters, DashboardStats

router = APIRouter()


@router.get("", response_model=List[OrderResponse])
async def get_orders(
    store_uids: Optional[List[str]] = Query(None),
    is_printed: Optional[bool] = None,
    has_awb: Optional[bool] = None,
    has_tracking: Optional[bool] = None,
    min_items: Optional[int] = None,
    max_items: Optional[int] = None,
    search: Optional[str] = None,
    fulfillment_status: Optional[List[str]] = Query(None, description="Filter by fulfillment status (multi)"),
    shipment_status: Optional[List[str]] = Query(None, description="Filter by shipment status (multi)"),
    aggregated_status: Optional[List[str]] = Query(None, description="Filter by workflow/aggregated status (multi)"),
    courier_names: Optional[List[str]] = Query(None, description="Filter by courier name (multi)"),
    has_shipping_cost: Optional[bool] = Query(None, description="Filter by whether order has shipping cost"),
    stale_courier: Optional[bool] = Query(None, description="Filter orders waiting for courier > 72 hours"),
    date_from: Optional[str] = Query(None, description="Filter from date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter to date (YYYY-MM-DD)"),
    sort_field: Optional[str] = Query("frisbo_created_at", description="Field to sort by"),
    sort_direction: Optional[str] = Query("desc", description="Sort direction: asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db)
):
    """Get orders with optional filters and sorting."""
    from datetime import datetime, timedelta
    
    # Use selectinload to eagerly load Store relationship (required for async SQLAlchemy)
    query = select(Order).options(selectinload(Order.store))
    
    # Apply filters
    conditions = []
    
    if store_uids:
        conditions.append(Order.store_uid.in_(store_uids))
    
    if is_printed is not None:
        conditions.append(Order.is_printed == is_printed)
    
    if has_awb is True:
        conditions.append(Order.awb_pdf_url.isnot(None))
    elif has_awb is False:
        conditions.append(Order.awb_pdf_url.is_(None))
    
    if has_tracking is True:
        conditions.append(Order.tracking_number.isnot(None))
    elif has_tracking is False:
        conditions.append(Order.tracking_number.is_(None))
    
    if min_items is not None:
        conditions.append(Order.item_count >= min_items)
    
    if max_items is not None:
        conditions.append(Order.item_count <= max_items)
    
    if search:
        search_term = f"%{search}%"
        conditions.append(
            (Order.order_number.ilike(search_term)) |
            (Order.customer_name.ilike(search_term)) |
            (Order.tracking_number.ilike(search_term)) |
            (cast(Order.line_items, String).ilike(search_term))
        )
    
    # Status filters (support multi-select)
    if fulfillment_status:
        conditions.append(Order.fulfillment_status.in_(fulfillment_status))
    
    if shipment_status:
        conditions.append(Order.shipment_status.in_(shipment_status))
    
    if aggregated_status:
        conditions.append(Order.aggregated_status.in_(aggregated_status))
    
    # Courier filter (multi-select)
    if courier_names:
        conditions.append(Order.courier_name.in_(courier_names))
    
    # Stale courier filter (waiting for courier > 72 hours)
    if stale_courier is True:
        stale_cutoff = datetime.utcnow() - timedelta(hours=72)
        conditions.append(Order.waiting_for_courier_since.isnot(None))
        conditions.append(Order.waiting_for_courier_since <= stale_cutoff)
    elif stale_courier is False:
        # Orders NOT stale (either not waiting, or waiting < 72h)
        stale_cutoff = datetime.utcnow() - timedelta(hours=72)
        conditions.append(
            (Order.waiting_for_courier_since.is_(None)) |
            (Order.waiting_for_courier_since > stale_cutoff)
        )
    
    # Shipping cost filter
    if has_shipping_cost is True:
        conditions.append(Order.transport_cost.isnot(None))
        conditions.append(Order.transport_cost > 0)
    elif has_shipping_cost is False:
        conditions.append((Order.transport_cost.is_(None)) | (Order.transport_cost == 0))
    
    if date_from:
        try:
            from_date = datetime.strptime(date_from, "%Y-%m-%d")
            conditions.append(Order.frisbo_created_at >= from_date)
        except ValueError:
            pass
    
    if date_to:
        try:
            to_date = datetime.strptime(date_to, "%Y-%m-%d")
            to_date = to_date.replace(hour=23, minute=59, second=59)
            conditions.append(Order.frisbo_created_at <= to_date)
        except ValueError:
            pass
    
    if conditions:
        query = query.where(and_(*conditions))
    
    # Server-side sorting - map field names to Order model columns
    sort_column_map = {
        "frisbo_created_at": Order.frisbo_created_at,
        "order_number": Order.order_number,
        "customer_name": Order.customer_name,
        "item_count": Order.item_count,
        "tracking_number": Order.tracking_number,
        "courier_name": Order.courier_name,
        "transport_cost": Order.transport_cost,
        "total_price": Order.total_price,
        "fulfilled_at": Order.fulfilled_at,
        "synced_at": Order.synced_at,
        "store_name": Store.name,  # Joined column from Store relationship
    }
    
    # For store_name sorting, ensure we join the Store table explicitly
    sort_col = sort_column_map.get(sort_field, Order.frisbo_created_at)
    if sort_field == "store_name":
        query = query.join(Store, Order.store_uid == Store.uid, isouter=True)
    
    if sort_direction == "asc":
        query = query.order_by(sort_col.asc().nulls_last())
    else:
        query = query.order_by(sort_col.desc().nulls_last())
    
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    orders = result.scalars().all()
    
    # Enrich with store info
    response = []
    for order in orders:
        order_dict = {
            "id": order.id,
            "uid": order.uid,
            "order_number": order.order_number or "",
            "store_uid": order.store_uid or "",
            "customer_name": order.customer_name or "Unknown",
            "customer_email": order.customer_email,
            "shipping_address": order.shipping_address if order.shipping_address else {},
            "line_items": order.line_items if order.line_items else [],
            "item_count": order.item_count or 0,
            "unique_sku_count": order.unique_sku_count or 0,
            "tracking_number": order.tracking_number,
            "courier_name": order.courier_name,
            "awb_pdf_url": order.awb_pdf_url,
            "fulfillment_status": order.fulfillment_status or "unknown",
            "shipment_status": order.shipment_status,
            "aggregated_status": order.aggregated_status,
            "is_printed": order.is_printed,
            "frisbo_created_at": order.frisbo_created_at,
            "fulfilled_at": order.fulfilled_at,
            "synced_at": order.synced_at,
            "printed_at": order.printed_at,
            "store_name": order.store.name if order.store else None,
            "store_color": order.store.color_code if order.store else "#6366f1",
            # Multi-AWB
            "awb_count": order.awb_count or 1,
            "awb_count_manual": order.awb_count_manual or False,
            # Shipping data
            "package_count": order.package_count,
            "package_weight": order.package_weight,
            "transport_cost": order.transport_cost,
            "shipping_data_source": order.shipping_data_source,
            "shipping_data_manual": order.shipping_data_manual or False,
            # Financial
            "total_price": order.total_price,
            "subtotal_price": order.subtotal_price,
            "currency": order.currency,
            # Waiting for courier data
            "waiting_for_courier_since": order.waiting_for_courier_since,
            "is_stale_courier": (
                order.waiting_for_courier_since is not None and
                (datetime.utcnow() - order.waiting_for_courier_since).total_seconds() > 72 * 3600
            ),
        }
        # We'll add awb_count_actual later via a subquery if needed
        response.append(OrderResponse(**order_dict))
    
    return response


@router.get("/couriers")
async def get_couriers(db: AsyncSession = Depends(get_db)):
    """Get distinct courier names for filter dropdown."""
    result = await db.execute(
        select(Order.courier_name)
        .where(Order.courier_name.isnot(None))
        .distinct()
        .order_by(Order.courier_name)
    )
    couriers = [row[0] for row in result.fetchall() if row[0]]
    return {"couriers": couriers}


@router.get("/filter-options")
async def get_filter_options(db: AsyncSession = Depends(get_db)):
    """Get all unique filter option values from the database."""
    # Get unique shipment statuses
    shipment_result = await db.execute(
        select(Order.shipment_status)
        .where(Order.shipment_status.isnot(None))
        .distinct()
    )
    shipment_statuses = sorted([row[0] for row in shipment_result.fetchall() if row[0]])
    
    # Get unique fulfillment statuses
    fulfillment_result = await db.execute(
        select(Order.fulfillment_status)
        .where(Order.fulfillment_status.isnot(None))
        .distinct()
    )
    fulfillment_statuses = sorted([row[0] for row in fulfillment_result.fetchall() if row[0]])
    
    # Get unique aggregated/workflow statuses
    workflow_result = await db.execute(
        select(Order.aggregated_status)
        .where(Order.aggregated_status.isnot(None))
        .distinct()
    )
    workflow_statuses = sorted([row[0] for row in workflow_result.fetchall() if row[0]])
    
    # Get unique couriers
    courier_result = await db.execute(
        select(Order.courier_name)
        .where(Order.courier_name.isnot(None))
        .distinct()
    )
    couriers = sorted([row[0] for row in courier_result.fetchall() if row[0]])
    
    # Get count of orders with tracking
    tracking_count_result = await db.execute(
        select(func.count(Order.id)).where(Order.tracking_number.isnot(None))
    )
    orders_with_tracking = tracking_count_result.scalar() or 0
    
    return {
        "shipment_statuses": shipment_statuses,
        "fulfillment_statuses": fulfillment_statuses,
        "workflow_statuses": workflow_statuses,
        "couriers": couriers,
        "orders_with_tracking": orders_with_tracking
    }


@router.get("/count")
async def get_order_count(
    store_uids: Optional[List[str]] = Query(None),
    is_printed: Optional[bool] = None,
    has_awb: Optional[bool] = None,
    has_tracking: Optional[bool] = None,
    min_items: Optional[int] = None,
    max_items: Optional[int] = None,
    search: Optional[str] = None,
    fulfillment_status: Optional[List[str]] = Query(None),
    shipment_status: Optional[List[str]] = Query(None),
    aggregated_status: Optional[List[str]] = Query(None),
    courier_names: Optional[List[str]] = Query(None),
    has_shipping_cost: Optional[bool] = Query(None),
    stale_courier: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Get order counts with same filters as main orders endpoint."""
    from datetime import datetime, timedelta
    
    query = select(func.count(Order.id))
    
    conditions = []
    if store_uids:
        conditions.append(Order.store_uid.in_(store_uids))
    if is_printed is not None:
        conditions.append(Order.is_printed == is_printed)
    if has_awb is True:
        conditions.append(Order.awb_pdf_url.isnot(None))
    elif has_awb is False:
        conditions.append(Order.awb_pdf_url.is_(None))
    if has_tracking is True:
        conditions.append(Order.tracking_number.isnot(None))
    elif has_tracking is False:
        conditions.append(Order.tracking_number.is_(None))
    if min_items is not None:
        conditions.append(Order.item_count >= min_items)
    if max_items is not None:
        conditions.append(Order.item_count <= max_items)
    if search:
        search_term = f"%{search}%"
        conditions.append(
            (Order.order_number.ilike(search_term)) |
            (Order.customer_name.ilike(search_term)) |
            (Order.tracking_number.ilike(search_term)) |
            (cast(Order.line_items, String).ilike(search_term))
        )
    if fulfillment_status:
        conditions.append(Order.fulfillment_status.in_(fulfillment_status))
    if shipment_status:
        conditions.append(Order.shipment_status.in_(shipment_status))
    if aggregated_status:
        conditions.append(Order.aggregated_status.in_(aggregated_status))
    if courier_names:
        conditions.append(Order.courier_name.in_(courier_names))
    if has_shipping_cost is True:
        conditions.append(Order.transport_cost.isnot(None))
        conditions.append(Order.transport_cost > 0)
    elif has_shipping_cost is False:
        conditions.append((Order.transport_cost.is_(None)) | (Order.transport_cost == 0))
    if stale_courier is True:
        stale_cutoff = datetime.utcnow() - timedelta(hours=72)
        conditions.append(Order.waiting_for_courier_since.isnot(None))
        conditions.append(Order.waiting_for_courier_since <= stale_cutoff)
    elif stale_courier is False:
        stale_cutoff = datetime.utcnow() - timedelta(hours=72)
        conditions.append(
            (Order.waiting_for_courier_since.is_(None)) |
            (Order.waiting_for_courier_since > stale_cutoff)
        )
    if date_from:
        try:
            from_date = datetime.strptime(date_from, "%Y-%m-%d")
            conditions.append(Order.frisbo_created_at >= from_date)
        except ValueError:
            pass
    if date_to:
        try:
            to_date = datetime.strptime(date_to, "%Y-%m-%d")
            to_date = to_date.replace(hour=23, minute=59, second=59)
            conditions.append(Order.frisbo_created_at <= to_date)
        except ValueError:
            pass
    
    if conditions:
        query = query.where(and_(*conditions))
    
    result = await db.execute(query)
    count = result.scalar()
    
    return {"count": count}


@router.get("/totals")
async def get_order_totals(
    store_uids: Optional[List[str]] = Query(None),
    is_printed: Optional[bool] = None,
    has_awb: Optional[bool] = None,
    has_tracking: Optional[bool] = None,
    min_items: Optional[int] = None,
    max_items: Optional[int] = None,
    search: Optional[str] = None,
    fulfillment_status: Optional[List[str]] = Query(None),
    shipment_status: Optional[List[str]] = Query(None),
    aggregated_status: Optional[List[str]] = Query(None),
    courier_names: Optional[List[str]] = Query(None),
    has_shipping_cost: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Get total order value in RON (with currency conversion) for filtered orders."""
    from datetime import datetime
    from app.models.exchange_rate import ExchangeRate
    
    # Build same conditions as main query
    conditions = []
    if store_uids:
        conditions.append(Order.store_uid.in_(store_uids))
    if is_printed is not None:
        conditions.append(Order.is_printed == is_printed)
    if has_awb is True:
        conditions.append(Order.awb_pdf_url.isnot(None))
    elif has_awb is False:
        conditions.append(Order.awb_pdf_url.is_(None))
    if has_tracking is True:
        conditions.append(Order.tracking_number.isnot(None))
    elif has_tracking is False:
        conditions.append(Order.tracking_number.is_(None))
    if min_items is not None:
        conditions.append(Order.item_count >= min_items)
    if max_items is not None:
        conditions.append(Order.item_count <= max_items)
    if search:
        search_term = f"%{search}%"
        conditions.append(
            (Order.order_number.ilike(search_term)) |
            (Order.customer_name.ilike(search_term)) |
            (Order.tracking_number.ilike(search_term)) |
            (cast(Order.line_items, String).ilike(search_term))
        )
    if fulfillment_status:
        conditions.append(Order.fulfillment_status.in_(fulfillment_status))
    if shipment_status:
        conditions.append(Order.shipment_status.in_(shipment_status))
    if aggregated_status:
        conditions.append(Order.aggregated_status.in_(aggregated_status))
    if courier_names:
        conditions.append(Order.courier_name.in_(courier_names))
    if has_shipping_cost is True:
        conditions.append(Order.transport_cost.isnot(None))
        conditions.append(Order.transport_cost > 0)
    elif has_shipping_cost is False:
        conditions.append((Order.transport_cost.is_(None)) | (Order.transport_cost == 0))
    if date_from:
        try:
            from_date = datetime.strptime(date_from, "%Y-%m-%d")
            conditions.append(Order.frisbo_created_at >= from_date)
        except ValueError:
            pass
    if date_to:
        try:
            to_date = datetime.strptime(date_to, "%Y-%m-%d")
            to_date = to_date.replace(hour=23, minute=59, second=59)
            conditions.append(Order.frisbo_created_at <= to_date)
        except ValueError:
            pass
    
    # Aggregate total_price grouped by currency
    currency_col = func.coalesce(Order.currency, 'RON').label('currency')
    query = select(
        currency_col,
        func.sum(Order.total_price).label('total'),
        func.count(Order.id).label('count')
    ).where(Order.total_price.isnot(None))
    
    if conditions:
        query = query.where(and_(*conditions))
    
    query = query.group_by(currency_col)
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get latest exchange rates for non-RON currencies
    rate_map = {'RON': 1.0}
    non_ron_currencies = [r.currency for r in rows if r.currency != 'RON']
    if non_ron_currencies:
        for curr in non_ron_currencies:
            rate_result = await db.execute(
                select(ExchangeRate)
                .where(ExchangeRate.currency == curr)
                .order_by(ExchangeRate.rate_date.desc())
                .limit(1)
            )
            rate = rate_result.scalar_one_or_none()
            if rate:
                rate_map[curr] = rate.rate / rate.multiplier
            else:
                rate_map[curr] = 1.0  # Fallback if no rate found
    
    # Calculate total in RON
    total_ron = 0.0
    per_currency = []
    total_count = 0
    for row in rows:
        amount_ron = (row.total or 0) * rate_map.get(row.currency, 1.0)
        total_ron += amount_ron
        total_count += row.count
        per_currency.append({
            'currency': row.currency,
            'total': round(row.total or 0, 2),
            'count': row.count,
            'rate_to_ron': round(rate_map.get(row.currency, 1.0), 4),
            'total_ron': round(amount_ron, 2),
        })
    
    return {
        'total_ron': round(total_ron, 2),
        'total_count': total_count,
        'per_currency': per_currency,
    }

@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """Get dashboard statistics."""
    from datetime import datetime, timedelta
    
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Total orders
    total_result = await db.execute(select(func.count(Order.id)))
    total_orders = total_result.scalar() or 0
    
    # Unprinted orders
    unprinted_result = await db.execute(
        select(func.count(Order.id)).where(Order.is_printed == False)
    )
    unprinted_orders = unprinted_result.scalar() or 0
    
    # Total stores
    stores_result = await db.execute(select(func.count(Store.id)))
    total_stores = stores_result.scalar() or 0
    
    # Active rules
    from app.models import Rule
    rules_result = await db.execute(
        select(func.count(Rule.id)).where(Rule.is_active == True)
    )
    active_rules = rules_result.scalar() or 0
    
    # Batches today
    from app.models import PrintBatch
    batches_result = await db.execute(
        select(func.count(PrintBatch.id)).where(PrintBatch.created_at >= today_start)
    )
    batches_today = batches_result.scalar() or 0
    
    # Orders printed today
    printed_today_result = await db.execute(
        select(func.count(Order.id)).where(
            and_(Order.is_printed == True, Order.printed_at >= today_start)
        )
    )
    orders_printed_today = printed_today_result.scalar() or 0
    
    # Stale courier count (waiting > 72h)
    stale_cutoff = today_start - timedelta(hours=72)
    stale_result = await db.execute(
        select(func.count(Order.id)).where(
            Order.waiting_for_courier_since.isnot(None),
            Order.waiting_for_courier_since <= datetime.utcnow() - timedelta(hours=72),
        )
    )
    stale_courier_count = stale_result.scalar() or 0
    
    return DashboardStats(
        total_orders=total_orders,
        unprinted_orders=unprinted_orders,
        total_stores=total_stores,
        active_rules=active_rules,
        batches_today=batches_today,
        orders_printed_today=orders_printed_today,
        stale_courier_count=stale_courier_count,
    )


@router.post("/mark-all-printed")
async def mark_all_orders_printed(db: AsyncSession = Depends(get_db)):
    """Mark all orders in the database as printed."""
    from sqlalchemy import update
    from datetime import datetime
    
    result = await db.execute(
        update(Order)
        .where(Order.is_printed == False)
        .values(is_printed=True, printed_at=datetime.utcnow())
    )
    await db.commit()
    
    return {"message": f"Marked {result.rowcount} orders as printed"}


@router.get("/{order_uid}", response_model=OrderResponse)
async def get_order(order_uid: str, db: AsyncSession = Depends(get_db)):
    """Get a specific order by UID."""
    result = await db.execute(
        select(Order).where(Order.uid == order_uid)
    )
    order = result.scalar_one_or_none()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    return order


@router.get("/{order_uid}/awbs")
async def get_order_awbs(order_uid: str, db: AsyncSession = Depends(get_db)):
    """Get all AWB records for an order."""
    # Find order
    result = await db.execute(select(Order).where(Order.uid == order_uid))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Get all AWBs
    awb_result = await db.execute(
        select(OrderAwb)
        .where(OrderAwb.order_id == order.id)
        .order_by(OrderAwb.awb_type.asc(), OrderAwb.created_at.desc())
    )
    awbs = awb_result.scalars().all()
    
    return {
        "order_uid": order_uid,
        "order_number": order.order_number,
        "awb_count": len(awbs),
        "awbs": [
            {
                "id": awb.id,
                "tracking_number": awb.tracking_number,
                "courier_name": awb.courier_name,
                "awb_type": awb.awb_type or "outbound",
                "transport_cost": awb.transport_cost,
                "transport_cost_fara_tva": awb.transport_cost_fara_tva,
                "transport_cost_tva": awb.transport_cost_tva,
                "currency": awb.currency,
                "order_ref": awb.order_ref,
                "original_awb": awb.original_awb,
                "package_count": awb.package_count,
                "package_weight": awb.package_weight,
                "data_source": awb.data_source,
                "created_at": awb.created_at.isoformat() if awb.created_at else None,
            }
            for awb in awbs
        ]
    }


@router.patch("/{order_uid}/awb-count")
async def update_awb_count(
    order_uid: str,
    awb_count: int = Query(..., ge=1, le=10, description="Number of AWBs (1-10)"),
    db: AsyncSession = Depends(get_db)
):
    """Set the number of AWBs per order (1-10)."""
    result = await db.execute(select(Order).where(Order.uid == order_uid))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order.awb_count = awb_count
    order.awb_count_manual = True
    await db.commit()
    
    return {
        "uid": order.uid,
        "awb_count": order.awb_count,
        "labels": [f"{i}/{awb_count}" for i in range(1, awb_count + 1)]
    }


@router.patch("/{order_uid}/shipping")
async def update_shipping_data(
    order_uid: str,
    package_count: Optional[int] = None,
    package_weight: Optional[float] = None,
    transport_cost: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """Manually update shipping data for an order. Marks as manual to prevent CSV overwrite."""
    result = await db.execute(select(Order).where(Order.uid == order_uid))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if package_count is not None:
        order.package_count = package_count
    if package_weight is not None:
        order.package_weight = package_weight
    if transport_cost is not None:
        order.transport_cost = transport_cost
    
    order.shipping_data_source = 'manual'
    order.shipping_data_manual = True
    await db.commit()
    
    return {
        "uid": order.uid,
        "package_count": order.package_count,
        "package_weight": order.package_weight,
        "transport_cost": order.transport_cost,
        "shipping_data_source": order.shipping_data_source,
    }
