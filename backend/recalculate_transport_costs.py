"""
One-time script: Recalculate all order transport costs using billable AWB status filtering.

Fixes orders where ghost AWBs (created but never picked up / cancelled) were
incorrectly included in the transport cost sum.

Usage:
    python recalculate_transport_costs.py
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Add parent to path
sys.path.insert(0, '.')

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import Order
from app.models.order_awb import OrderAwb, is_billable_status


async def recalculate_all():
    """Recalculate transport costs for ALL orders that have AWB data."""
    async with AsyncSessionLocal() as db:
        # Find all orders with CSV-imported transport costs
        result = await db.execute(
            select(Order.id, Order.uid, Order.order_number, Order.transport_cost)
            .where(Order.transport_cost.isnot(None))
            .where(Order.transport_cost > 0)
        )
        orders_with_costs = result.all()
        
        logger.info(f"Found {len(orders_with_costs)} orders with transport costs")
        
        fixed_count = 0
        total_savings = 0
        
        for order_id, order_uid, order_number, old_cost in orders_with_costs:
            # Get all outbound AWBs for this order
            awb_result = await db.execute(
                select(OrderAwb)
                .where(OrderAwb.order_id == order_id)
                .where(OrderAwb.awb_type == 'outbound')
                .where(OrderAwb.transport_cost.isnot(None))
            )
            awbs = awb_result.scalars().all()
            
            if not awbs:
                continue
            
            # Calculate billable vs total
            billable_cost = 0
            total_cost = 0
            non_billable = []
            
            for awb in awbs:
                total_cost += awb.transport_cost
                if is_billable_status(awb.csv_status):
                    billable_cost += awb.transport_cost
                else:
                    non_billable.append(f"{awb.tracking_number} (status='{awb.csv_status}', cost={awb.transport_cost})")
            
            billable_cost = round(billable_cost, 2)
            
            if non_billable and billable_cost != old_cost:
                # Update the order
                order_result = await db.execute(
                    select(Order).where(Order.id == order_id)
                )
                order = order_result.scalar_one()
                
                savings = round(old_cost - billable_cost, 2)
                total_savings += savings
                fixed_count += 1
                
                logger.info(
                    f"  #{order_number} (uid={order_uid}): "
                    f"{old_cost} → {billable_cost} (saved {savings})"
                )
                for nb in non_billable:
                    logger.info(f"    ❌ Excluded: {nb}")
                
                order.transport_cost = billable_cost
        
        if fixed_count > 0:
            await db.commit()
            logger.info(f"\n✅ Fixed {fixed_count} orders. Total savings: {total_savings} RON")
        else:
            logger.info("\n✅ No orders needed fixing. All transport costs are already correct.")


if __name__ == '__main__':
    asyncio.run(recalculate_all())
