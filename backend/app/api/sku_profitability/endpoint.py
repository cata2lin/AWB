"""
SKU Profitability endpoint — line-item-level cost allocation for per-product profitability.

Allocates order-level costs (transport, fees, packaging) to individual line items
by revenue share, then aggregates by SKU across all orders.
"""
from datetime import datetime, timedelta, date
from typing import Optional
from collections import defaultdict
import hashlib
import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Order, Store, SkuCost
from app.models.sku_marketing_cost import SkuMarketingCost
from app.api.profitability_config import get_or_create_config

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/analytics/sku-profitability")
async def get_sku_profitability(
    db: AsyncSession = Depends(get_db),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    days: Optional[int] = 30,
    store_uids: Optional[str] = None,
):
    """
    Per-SKU profitability with line-item cost allocation.

    For each order, costs are allocated to individual line items by revenue share:
      allocated_cost = order_cost × (line_revenue / order_total_revenue)

    Then aggregated by SKU across all orders.
    """
    from app.api.exchange_rates import preload_rates, get_rate_from_cache

    # --- Parse filters ---
    store_uid_list = None
    if store_uids:
        store_uid_list = [s.strip() for s in store_uids.split(',')]

    conditions = []
    if store_uid_list:
        conditions.append(Order.store_uid.in_(store_uid_list))
    if date_from and date_to:
        conditions.append(Order.frisbo_created_at >= datetime.strptime(date_from, '%Y-%m-%d'))
        conditions.append(Order.frisbo_created_at <= datetime.strptime(date_to, '%Y-%m-%d').replace(hour=23, minute=59, second=59))
    elif days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        conditions.append(Order.frisbo_created_at >= cutoff)

    # Determine date range for marketing cost query
    if date_from and date_to:
        mkt_date_from = date_from[:7]  # YYYY-MM
        mkt_date_to = date_to[:7]
    elif days:
        now = datetime.utcnow()
        mkt_date_to = now.strftime('%Y-%m')
        mkt_date_from = (now - timedelta(days=days)).strftime('%Y-%m')
    else:
        mkt_date_to = datetime.utcnow().strftime('%Y-%m')
        mkt_date_from = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m')

    # --- Fetch data ---
    query = select(Order)
    if conditions:
        query = query.where(and_(*conditions))
    result = await db.execute(query)
    orders = result.scalars().all()

    # SKU costs lookup
    sku_costs_result = await db.execute(select(SkuCost))
    sku_costs_all = sku_costs_result.scalars().all()
    sku_costs_map = {sc.sku: sc.cost for sc in sku_costs_all}
    sku_names_map = {sc.sku: sc.name for sc in sku_costs_all}

    # Store names
    stores_result = await db.execute(select(Store))
    store_names = {s.uid: s.name for s in stores_result.scalars().all()}

    # Marketing costs (all months in range)
    mkt_query = select(SkuMarketingCost).where(
        and_(
            SkuMarketingCost.month >= mkt_date_from,
            SkuMarketingCost.month <= mkt_date_to,
        )
    )
    mkt_result = await db.execute(mkt_query)
    mkt_entries = mkt_result.scalars().all()
    # Aggregate marketing costs by SKU
    sku_marketing_map = defaultdict(float)
    sku_marketing_entries = defaultdict(list)
    for m in mkt_entries:
        sku_marketing_map[m.sku] += m.amount
        sku_marketing_entries[m.sku].append({
            "id": m.id, "label": m.label, "amount": m.amount, "month": m.month,
        })

    # --- FX rate preload ---
    non_ron_currencies = {(o.currency or 'RON').upper() for o in orders if (o.currency or 'RON').upper() != 'RON'}
    rate_cache = {}
    if non_ron_currencies:
        order_dates = [o.frisbo_created_at.date() if o.frisbo_created_at else date.today() for o in orders]
        if order_dates:
            min_date = min(order_dates)
            max_date = max(order_dates)
            rate_cache = await preload_rates(non_ron_currencies, (min_date, max_date), db)

    # --- Load profitability config ---
    config = await get_or_create_config(db)

    # --- Transport cost fallback caches ---
    cutoff_30d = datetime.utcnow() - timedelta(days=30)
    fallback_result = await db.execute(
        select(Order)
        .where(and_(
            Order.aggregated_status == 'delivered',
            Order.transport_cost.isnot(None),
            Order.transport_cost > 0,
            Order.frisbo_created_at >= cutoff_30d,
        ))
        .order_by(Order.frisbo_created_at.desc())
    )
    fallback_orders = fallback_result.scalars().all()

    sku_hash_cost_cache = {}
    store_transport_sums = defaultdict(lambda: {'total': 0, 'count': 0})
    store_avg_transport = {}

    for fo in fallback_orders:
        store_transport_sums[fo.store_uid]['total'] += fo.transport_cost
        store_transport_sums[fo.store_uid]['count'] += 1
        sh = _sku_hash(fo.line_items)
        if sh and sh not in sku_hash_cost_cache:
            sku_hash_cost_cache[sh] = fo.transport_cost

    for sid, data in store_transport_sums.items():
        if data['count'] > 0:
            store_avg_transport[sid] = round(data['total'] / data['count'], 2)

    # --- VAT rate ---
    ref_date = datetime.utcnow()
    if date_to:
        try:
            ref_date = datetime.strptime(date_to, '%Y-%m-%d')
        except ValueError:
            pass
    cutoff_date = datetime(2025, 8, 1)
    dynamic_vat_rate = 0.19 if ref_date < cutoff_date else (config.vat_rate or 0.21)

    # --- Per-SKU aggregation ---
    # sku -> { metrics }
    sku_data = defaultdict(lambda: {
        'units_sold': 0, 'units_returned': 0, 'orders_delivered': 0, 'orders_returned': 0,
        'revenue': 0.0, 'cogs': 0.0, 'transport': 0.0,
        'packaging': 0.0, 'payment_fee': 0.0, 'gt_commission': 0.0, 'frisbo_fee': 0.0,
        'per_store': defaultdict(lambda: {
            'units_sold': 0, 'units_returned': 0,
            'revenue': 0.0, 'cogs': 0.0, 'transport': 0.0, 'fees': 0.0,
        }),
    })
    missing_cost_skus = set()
    total_orders_processed = 0

    for order in orders:
        order_currency = (order.currency or 'RON').upper()
        order_date = order.frisbo_created_at.date() if order.frisbo_created_at else date.today()

        # Revenue in RON
        revenue_orig = order.total_price or 0
        subtotal_orig = order.subtotal_price or 0
        fx_rate = 1.0
        if order_currency != 'RON':
            r = get_rate_from_cache(order_currency, order_date, rate_cache)
            if r is not None:
                fx_rate = r

        revenue = round(revenue_orig * fx_rate, 2)
        subtotal = round(subtotal_orig * fx_rate, 2)

        # Status classification
        status = order.aggregated_status or 'other'
        if status == 'delivered':
            cat = 'delivered'
        elif status in ['back_to_sender', 'returned']:
            cat = 'returned'
        elif status in ['cancelled', 'voided']:
            cat = 'cancelled'
        elif status in ['in_transit', 'out_for_delivery', 'customer_pickup']:
            cat = 'in_transit'
        else:
            cat = 'other'

        # Skip cancelled entirely
        if cat == 'cancelled':
            continue

        store_uid = order.store_uid
        total_orders_processed += 1

        # --- Order-level costs ---
        # Transport
        if order.transport_cost is not None and order.transport_cost > 0:
            shipping_cost = order.transport_cost
        else:
            sh = _sku_hash(order.line_items)
            if sh and sh in sku_hash_cost_cache:
                shipping_cost = sku_hash_cost_cache[sh]
            elif store_uid in store_avg_transport:
                shipping_cost = store_avg_transport[store_uid]
            else:
                customer_shipping = max(0, revenue - subtotal)
                shipping_cost = customer_shipping if customer_shipping > 0 else 0

        # Operational costs
        packaging_cost = config.packaging_cost_per_order
        gt_commission = 0.0
        if config.gt_commission_store_uid and store_uid == config.gt_commission_store_uid:
            gt_commission = revenue * config.gt_commission_pct / 100.0

        is_card_payment = not (order.payment_gateway or '').lower().startswith('plat')
        payment_fee = (revenue * config.payment_processing_pct / 100.0 + config.payment_processing_fixed) if is_card_payment else 0.0
        frisbo_fee = config.frisbo_fee_per_order

        # For returned orders: revenue zeroed, cogs zeroed, only shipping is sunk
        is_returned = cat == 'returned'

        # --- Parse line items and allocate ---
        line_items = order.line_items or []
        if not isinstance(line_items, list):
            continue

        # First pass: compute order totals for revenue share
        line_data = []
        order_line_revenue_total = 0.0
        for item in line_items:
            if not isinstance(item, dict):
                continue
            inventory_item = item.get('inventory_item', {})
            if not isinstance(inventory_item, dict):
                continue
            sku = inventory_item.get('sku')
            if not sku:
                continue
            qty = item.get('quantity', 1) or 1
            price = item.get('price', 0) or 0
            line_revenue = round(price * qty * fx_rate, 2)
            order_line_revenue_total += line_revenue
            line_data.append((sku, qty, line_revenue))

        if not line_data:
            continue

        # Prevent division by zero
        if order_line_revenue_total <= 0:
            order_line_revenue_total = 1.0

        # Second pass: allocate costs
        for sku, qty, line_revenue in line_data:
            revenue_share = line_revenue / order_line_revenue_total

            # COGS
            unit_cost = sku_costs_map.get(sku)
            if unit_cost is not None:
                line_cogs = round(unit_cost * qty, 2)
            else:
                line_cogs = 0.0
                missing_cost_skus.add(sku)

            # Allocated costs
            alloc_transport = round(shipping_cost * revenue_share, 2)
            alloc_packaging = round(packaging_cost * revenue_share, 2)
            alloc_payment = round(payment_fee * revenue_share, 2)
            alloc_gt = round(gt_commission * revenue_share, 2)
            alloc_frisbo = round(frisbo_fee * revenue_share, 2)

            sd = sku_data[sku]

            if is_returned:
                sd['units_returned'] += qty
                sd['orders_returned'] += 1
                # Only sunk shipping cost allocated
                sd['transport'] += alloc_transport
                # Per-store
                psd = sd['per_store'][store_uid]
                psd['units_returned'] += qty
                psd['transport'] += alloc_transport
            else:
                # delivered or in_transit — full calc
                sd['units_sold'] += qty
                sd['orders_delivered'] += 1
                sd['revenue'] += line_revenue
                sd['cogs'] += line_cogs
                sd['transport'] += alloc_transport
                sd['packaging'] += alloc_packaging
                sd['payment_fee'] += alloc_payment
                sd['gt_commission'] += alloc_gt
                sd['frisbo_fee'] += alloc_frisbo
                # Per-store
                psd = sd['per_store'][store_uid]
                psd['units_sold'] += qty
                psd['revenue'] += line_revenue
                psd['cogs'] += line_cogs
                psd['transport'] += alloc_transport
                psd['fees'] += alloc_packaging + alloc_payment + alloc_gt + alloc_frisbo

    # --- Build response ---
    products = []
    total_revenue = 0.0
    total_costs = 0.0
    total_contribution = 0.0

    for sku, sd in sku_data.items():
        fees = sd['packaging'] + sd['payment_fee'] + sd['gt_commission'] + sd['frisbo_fee']
        marketing = sku_marketing_map.get(sku, 0.0)
        costs = sd['cogs'] + sd['transport'] + fees + marketing
        contribution = sd['revenue'] - costs
        margin_pct = round((contribution / sd['revenue'] * 100) if sd['revenue'] > 0 else 0, 1)
        total_units = sd['units_sold'] + sd['units_returned']
        return_rate = round((sd['units_returned'] / total_units * 100) if total_units > 0 else 0, 1)
        avg_price = round(sd['revenue'] / sd['units_sold'], 2) if sd['units_sold'] > 0 else 0

        # Per-store breakdown
        per_store_list = []
        for suid, psd in sd['per_store'].items():
            s_fees = psd.get('fees', 0)
            s_costs = psd['cogs'] + psd['transport'] + s_fees
            s_contribution = psd['revenue'] - s_costs
            s_margin = round((s_contribution / psd['revenue'] * 100) if psd['revenue'] > 0 else 0, 1)
            per_store_list.append({
                'store_uid': suid,
                'store_name': store_names.get(suid, 'Unknown'),
                'units_sold': psd['units_sold'],
                'units_returned': psd['units_returned'],
                'revenue': round(psd['revenue'], 2),
                'cogs': round(psd['cogs'], 2),
                'transport': round(psd['transport'], 2),
                'fees': round(s_fees, 2),
                'contribution': round(s_contribution, 2),
                'margin_pct': s_margin,
            })
        per_store_list.sort(key=lambda x: x['revenue'], reverse=True)

        product = {
            'sku': sku,
            'name': sku_names_map.get(sku, ''),
            'units_sold': sd['units_sold'],
            'units_returned': sd['units_returned'],
            'orders_count': sd['orders_delivered'],
            'revenue': round(sd['revenue'], 2),
            'cogs': round(sd['cogs'], 2),
            'transport': round(sd['transport'], 2),
            'fees': round(fees, 2),
            'marketing': round(marketing, 2),
            'total_costs': round(costs, 2),
            'contribution': round(contribution, 2),
            'margin_pct': margin_pct,
            'return_rate': return_rate,
            'avg_selling_price': avg_price,
            'cost_per_unit': round(sd['cogs'] / sd['units_sold'], 2) if sd['units_sold'] > 0 else 0,
            'per_store': per_store_list,
            'marketing_entries': sku_marketing_entries.get(sku, []),
            'has_cost': sku not in missing_cost_skus,
        }
        products.append(product)

        total_revenue += sd['revenue']
        total_costs += costs
        total_contribution += contribution

    # Sort by revenue descending by default
    products.sort(key=lambda x: x['revenue'], reverse=True)

    avg_margin = round((total_contribution / total_revenue * 100) if total_revenue > 0 else 0, 1)

    return {
        "products": products,
        "summary": {
            "total_products": len(products),
            "total_revenue": round(total_revenue, 2),
            "total_costs": round(total_costs, 2),
            "total_contribution": round(total_contribution, 2),
            "avg_margin": avg_margin,
            "products_without_cost": len(missing_cost_skus),
            "missing_cost_skus": sorted(list(missing_cost_skus)),
            "orders_processed": total_orders_processed,
        },
    }


def _sku_hash(line_items) -> Optional[str]:
    """Create a deterministic hash from the SKU set of an order's line items."""
    if not line_items or not isinstance(line_items, list):
        return None
    skus = []
    for item in line_items:
        if isinstance(item, dict):
            inv = item.get('inventory_item', {})
            if isinstance(inv, dict) and inv.get('sku'):
                skus.append(inv['sku'])
    if not skus:
        return None
    return hashlib.md5(','.join(sorted(skus)).encode('utf-8')).hexdigest()
