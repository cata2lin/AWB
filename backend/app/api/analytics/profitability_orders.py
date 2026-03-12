"""
Order-level profitability audit endpoint.

Edit THIS file for per-order profitability calculation changes.
"""
from datetime import datetime, timedelta, date
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order, Store, SkuCost
from app.api.profitability_config import get_or_create_config

router = APIRouter()


@router.get("/profitability/orders")
async def get_order_profitability(
    store_uids: Optional[str] = None,
    days: Optional[int] = None,
    status: Optional[str] = None,  # delivered, returned, in_transit, other
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get individual orders with profitability breakdown.
    
    Returns paginated list of orders with:
    - Order details (number, customer, date)
    - Revenue (total_price)
    - SKU costs, shipping, packaging, commissions, payment fees
    - Profit gross and net (after VAT)
    - Line items with per-SKU cost breakdown
    """
    # Load profitability config
    config = await get_or_create_config(db)
    excluded_stores = config.agency_commission_excluded_stores or []
    excluded_tags = config.agency_commission_excluded_tags or []
    
    # Parse store_uids if provided
    store_uid_list = None
    if store_uids:
        store_uid_list = [s.strip() for s in store_uids.split(',')]
    
    # Build conditions
    conditions = []
    if store_uid_list:
        conditions.append(Order.store_uid.in_(store_uid_list))
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        conditions.append(Order.frisbo_created_at >= cutoff)
    
    # Status filter
    if status:
        if status == 'delivered':
            conditions.append(Order.aggregated_status == 'delivered')
        elif status == 'returned':
            conditions.append(Order.aggregated_status.in_(['back_to_sender', 'returned']))
        elif status == 'in_transit':
            conditions.append(Order.aggregated_status.in_(['in_transit', 'out_for_delivery', 'customer_pickup']))
        elif status == 'cancelled':
            conditions.append(Order.aggregated_status == 'cancelled')
    
    # Get all SKU costs as a lookup
    sku_costs_result = await db.execute(select(SkuCost))
    sku_costs_map = {sc.sku: sc.cost for sc in sku_costs_result.scalars().all()}
    
    # Get total count
    count_query = select(func.count(Order.id))
    if conditions:
        count_query = count_query.where(and_(*conditions))
    count_result = await db.execute(count_query)
    total_count = count_result.scalar() or 0
    
    # Get orders with pagination
    query = select(Order).order_by(desc(Order.frisbo_created_at))
    if conditions:
        query = query.where(and_(*conditions))
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    orders = result.scalars().all()
    
    # Get store names
    stores_result = await db.execute(select(Store))
    store_names = {s.uid: s.name for s in stores_result.scalars().all()}
    
    # --- Preload exchange rates for non-RON orders ---
    from app.api.exchange_rates import preload_rates, get_rate_from_cache
    non_ron_currencies = {(o.currency or 'RON').upper() for o in orders if (o.currency or 'RON').upper() != 'RON'}
    rate_cache = {}
    if non_ron_currencies:
        order_dates = [o.frisbo_created_at.date() if o.frisbo_created_at else date.today() for o in orders]
        min_date = min(order_dates)
        max_date = max(order_dates)
        rate_cache = await preload_rates(non_ron_currencies, (min_date, max_date), db)
    
    # Build response
    order_data = []
    for order in orders:
        order_currency = (order.currency or 'RON').upper()
        order_date = order.frisbo_created_at.date() if order.frisbo_created_at else date.today()
        
        # Original currency values
        revenue_orig = order.total_price or 0
        subtotal_orig = order.subtotal_price or 0
        discounts = order.total_discounts or 0
        
        # Convert to RON if needed
        fx_rate = None
        if order_currency != 'RON':
            fx_rate = get_rate_from_cache(order_currency, order_date, rate_cache)
            if fx_rate is not None:
                revenue = round(revenue_orig * fx_rate, 2)
                subtotal = round(subtotal_orig * fx_rate, 2)
            else:
                revenue = revenue_orig
                subtotal = subtotal_orig
        else:
            revenue = revenue_orig
            subtotal = subtotal_orig
        
        # Shipping cost: prefer real courier cost from CSV import, fall back to customer-paid
        if order.transport_cost is not None:
            shipping_cost = order.transport_cost
        else:
            shipping_cost = max(0, revenue - subtotal)
        
        # Calculate SKU costs and build line items breakdown
        order_sku_cost = 0
        line_items_detail = []
        has_missing_costs = False
        
        line_items = order.line_items or []
        if isinstance(line_items, list):
            for item in line_items:
                if isinstance(item, dict):
                    inventory_item = item.get('inventory_item', {})
                    if isinstance(inventory_item, dict):
                        sku = inventory_item.get('sku')
                        title = inventory_item.get('title_1', '') or ''
                        qty = item.get('quantity', 1)
                        price = item.get('price', 0) or 0
                        
                        if sku:
                            cost_per_unit = sku_costs_map.get(sku)
                            if cost_per_unit is not None:
                                item_cost = cost_per_unit * qty
                                order_sku_cost += item_cost
                            else:
                                item_cost = None
                                has_missing_costs = True
                            
                            line_items_detail.append({
                                'sku': sku,
                                'title': title,
                                'quantity': qty,
                                'price_per_unit': round(price, 2),
                                'price_total': round(price * qty, 2),
                                'cost_per_unit': round(cost_per_unit, 2) if cost_per_unit is not None else None,
                                'cost_total': round(item_cost, 2) if item_cost is not None else None,
                            })
        
        # --- Determine status category first (affects cost allocation) ---
        status_val = order.aggregated_status or 'other'
        store_uid = order.store_uid
        
        if status_val == 'delivered':
            cat = 'delivered'
        elif status_val in ['back_to_sender', 'returned']:
            cat = 'returned'
        elif status_val == 'cancelled':
            cat = 'cancelled'
        elif status_val in ['in_transit', 'out_for_delivery', 'customer_pickup']:
            cat = 'in_transit'
        else:
            cat = 'other'
        
        # --- Cost allocation based on category ---
        if cat == 'cancelled':
            packaging_cost = 0
            agency_commission = 0
            gt_commission = 0
            payment_fee = 0
            frisbo_fee = 0
            total_costs = 0
            profit_gross = 0
        else:
            packaging_cost = config.packaging_cost_per_order
            
            # Agency commission: only for delivered & in_transit (not returns)
            agency_commission = 0.0
            if cat in ['delivered', 'in_transit'] and store_uid not in excluded_stores:
                agency_commission = revenue * config.agency_commission_pct / 100.0
            
            gt_commission = 0.0
            if config.gt_commission_store_uid and store_uid == config.gt_commission_store_uid:
                gt_commission = revenue * config.gt_commission_pct / 100.0
            
            # COD orders (gateway = "Plată ramburs") have no card processing fee
            is_card_payment = not (order.payment_gateway or '').lower().startswith('plat')
            if is_card_payment:
                payment_fee = revenue * config.payment_processing_pct / 100.0 + config.payment_processing_fixed
            else:
                payment_fee = 0.0
            frisbo_fee = config.frisbo_fee_per_order
            
            total_costs = order_sku_cost + shipping_cost + packaging_cost + agency_commission + gt_commission + payment_fee + frisbo_fee
            
            if cat == 'delivered':
                profit_gross = revenue - total_costs
            elif cat == 'returned':
                profit_gross = -(order_sku_cost + shipping_cost + packaging_cost + gt_commission + payment_fee + frisbo_fee)
            elif cat == 'in_transit':
                profit_gross = revenue - total_costs
            else:
                profit_gross = 0
        
        # VAT calculation: Net profit = Gross profit / (1 + dynamic_vat_rate)
        # Order date determines 19% vs 21% (August 1, 2025 cutoff)
        cutoff_date = date(2025, 8, 1)
        dynamic_vat_rate = 0.19 if order_date < cutoff_date else (config.vat_rate or 0.21)
        
        if dynamic_vat_rate > 0 and profit_gross != 0:
            profit_net = profit_gross / (1 + dynamic_vat_rate)
        else:
            profit_net = profit_gross
        
        margin_pct = (profit_gross / revenue * 100) if revenue > 0 else 0
        
        order_data.append({
            'uid': order.uid,
            'order_number': order.order_number,
            'customer_name': order.customer_name,
            'store_uid': order.store_uid,
            'store_name': store_names.get(order.store_uid, 'Unknown'),
            'created_at': order.frisbo_created_at.isoformat() if order.frisbo_created_at else None,
            'status': status_val,
            # Price fields (in RON after conversion)
            'subtotal_price': round(subtotal, 2),
            'total_discounts': round(discounts, 2),
            'shipping_cost': round(shipping_cost, 2),
            'total_price': round(revenue, 2),
            'currency': 'RON',  # All values are now in RON
            # Original currency info (for display)
            'original_currency': order_currency,
            'original_total_price': round(revenue_orig, 2) if order_currency != 'RON' else None,
            'original_subtotal_price': round(subtotal_orig, 2) if order_currency != 'RON' else None,
            'exchange_rate': round(fx_rate, 6) if fx_rate and order_currency != 'RON' else None,
            # Cost breakdown (always in RON)
            'sku_costs': round(order_sku_cost, 2),
            'packaging_cost': round(packaging_cost, 2),
            'agency_commission': round(agency_commission, 2),
            'gt_commission': round(gt_commission, 2),
            'payment_fee': round(payment_fee, 2),
            'frisbo_fee': round(frisbo_fee, 2),
            'total_costs': round(total_costs, 2),
            # Profit (all in RON)
            'profit_gross': round(profit_gross, 2),
            'profit_net': round(profit_net, 2),
            'margin_pct': round(margin_pct, 1),
            'item_count': order.item_count,
            'has_missing_costs': has_missing_costs,
            'payment_gateway': order.payment_gateway,
            'line_items': line_items_detail,
        })
    
    return {
        'orders': order_data,
        'total': total_count,
        'skip': skip,
        'limit': limit,
    }
