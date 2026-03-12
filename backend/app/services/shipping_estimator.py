"""
Shipping Estimator Service.

Estimates shipping data (package_count, weight, transport_cost) for new orders
based on historical data from identical orders that already have CSV import data.

Designed for large datasets: processes in batches with periodic commits.
"""
import logging
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc, func

from app.models import Order

logger = logging.getLogger(__name__)

# Processing constants
CANDIDATE_LIMIT = 1000       # Max historical orders to scan per fingerprint search
BATCH_SIZE = 200             # Orders to process before committing
ESTIMATION_PAGE_SIZE = 500   # Orders to fetch per page for batch estimation


def normalize_line_items(line_items: list) -> str:
    """
    Create a normalized fingerprint of line items for matching.
    Returns a sorted string of 'sku:qty' pairs.
    """
    if not line_items:
        return ""

    items = []
    for item in line_items:
        # Get SKU from nested structure or top-level
        sku = None
        if isinstance(item, dict):
            inv_item = item.get("inventory_item", {})
            if isinstance(inv_item, dict):
                sku = inv_item.get("sku")
            if not sku:
                sku = item.get("sku")

        qty = item.get("quantity", 1) if isinstance(item, dict) else 1
        if sku:
            items.append(f"{sku}:{int(qty)}")

    return "|".join(sorted(items))


async def estimate_shipping_for_order(
    db: AsyncSession,
    order: Order,
) -> Optional[Dict[str, Any]]:
    """
    Find the closest historical order with CSV shipping data
    that matches the given order's line items.

    Priority:
    1. Same line items + same store
    2. Same line items + any store

    Returns dict with package_count, package_weight, transport_cost or None.
    """
    fingerprint = normalize_line_items(order.line_items)
    if not fingerprint:
        return None

    # First try: same store
    result = await _find_matching_order(db, fingerprint, order.store_uid)
    if result:
        return result

    # Second try: any store
    result = await _find_matching_order(db, fingerprint, None)
    return result


async def _find_matching_order(
    db: AsyncSession,
    target_fingerprint: str,
    store_uid: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Find a matching order by line item fingerprint."""
    conditions = [
        Order.shipping_data_source == 'csv_import',
        Order.transport_cost.isnot(None),
    ]
    if store_uid:
        conditions.append(Order.store_uid == store_uid)

    # Get recent orders with CSV data (limit for performance)
    query = (
        select(Order)
        .where(and_(*conditions))
        .order_by(desc(Order.frisbo_created_at))
        .limit(CANDIDATE_LIMIT)
    )

    result = await db.execute(query)
    candidates = result.scalars().all()

    for candidate in candidates:
        candidate_fp = normalize_line_items(candidate.line_items)
        if candidate_fp == target_fingerprint:
            return {
                'package_count': candidate.package_count,
                'package_weight': candidate.package_weight,
                'transport_cost': candidate.transport_cost,
            }

    return None


async def estimate_missing_shipping(db: AsyncSession) -> Dict[str, int]:
    """
    Batch estimate shipping data for all orders that don't have it yet.
    Processes in pages with periodic commits to handle large datasets.
    Returns count of orders updated.
    """
    updated = 0
    skipped = 0
    offset = 0

    while True:
        # Fetch a page of orders without shipping data
        query = (
            select(Order)
            .where(
                and_(
                    Order.transport_cost.is_(None),
                    Order.shipping_data_manual == False,
                    Order.tracking_number.isnot(None),  # Only shipped orders
                )
            )
            .offset(offset)
            .limit(ESTIMATION_PAGE_SIZE)
        )

        result = await db.execute(query)
        orders_page = result.scalars().all()

        if not orders_page:
            break  # No more orders to process

        batch_updated = 0
        for order in orders_page:
            estimate = await estimate_shipping_for_order(db, order)
            if estimate:
                order.package_count = estimate['package_count']
                order.package_weight = estimate['package_weight']
                order.transport_cost = estimate['transport_cost']
                order.shipping_data_source = 'historical_match'
                batch_updated += 1
            else:
                skipped += 1

        if batch_updated > 0:
            await db.commit()
            updated += batch_updated

        # If we updated some orders in this batch, they won't appear in
        # the next query (they now have transport_cost), so don't advance offset.
        # Only advance offset for orders we couldn't match.
        if batch_updated == 0:
            offset += ESTIMATION_PAGE_SIZE
        else:
            # Some were updated (removed from query results),
            # some were skipped (still in results) — advance by skipped count only
            offset += (len(orders_page) - batch_updated)

        logger.info(
            f"Shipping estimation batch: {batch_updated} updated in this page, "
            f"running total: {updated} updated, {skipped} skipped"
        )

    logger.info(f"Shipping estimation complete: {updated} updated, {skipped} no match found")
    return {"updated": updated, "no_match": skipped}
