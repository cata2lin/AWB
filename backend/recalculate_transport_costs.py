"""
One-time script: Recalculate all order transport costs using billable AWB status filtering.

Fixes orders where ghost AWBs (created but never picked up / cancelled) were
incorrectly included in the transport cost sum.

IMPORTANT: csv_status must be populated first! This requires:
  1. Run migrate_csv_status.py (adds the column)
  2. Re-import courier CSVs (populates csv_status values)
  3. THEN run this script

If csv_status is NULL for all AWBs, this script will report "no fixes needed"
because NULL status = assumed billable (conservative default).

Usage:
    python recalculate_transport_costs.py
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

sys.path.insert(0, '.')

from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import Order
from app.models.order_awb import OrderAwb, is_billable_status


async def check_csv_status_exists():
    """Check if csv_status column exists in the DB."""
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'order_awbs' AND column_name = 'csv_status'"
            ))
            return result.scalar() is not None
        except Exception:
            return False


async def check_csv_status_populated():
    """Check how many AWBs have csv_status populated."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(
            "SELECT COUNT(*) FROM order_awbs WHERE csv_status IS NOT NULL"
        ))
        return result.scalar() or 0


async def recalculate_all():
    """Recalculate transport costs for ALL orders that have AWB data."""
    
    # Pre-flight checks
    if not await check_csv_status_exists():
        logger.error("❌ csv_status column does not exist! Run migrate_csv_status.py first.")
        return
    
    populated = await check_csv_status_populated()
    if populated == 0:
        logger.warning("⚠️  csv_status is NULL for ALL AWBs.")
        logger.warning("   You need to re-import courier CSVs first to populate status values.")
        logger.warning("   Without status data, all AWBs are assumed billable (no changes will be made).")
        logger.warning("   To re-import: use the Settings page → 'Import din folder server'")
        return
    
    logger.info(f"Found {populated} AWBs with csv_status populated")
    
    # Batch process: find orders where non-billable AWBs exist
    async with AsyncSessionLocal() as db:
        # First, find all orders that have at least one AWB with a non-billable status
        # This is much more efficient than iterating ALL 300K orders
        result = await db.execute(text("""
            SELECT DISTINCT oa.order_id
            FROM order_awbs oa
            WHERE oa.awb_type = 'outbound'
            AND oa.transport_cost IS NOT NULL
            AND oa.csv_status IS NOT NULL
            AND (
                oa.csv_status IN ('0', '1', '7', '8',
                    '0 - Fara comanda', '1 - Neridicat', '7 - Anulat', '8 - Inchis intern',
                    'Cancelled', 'We are waiting for the package handover')
                OR LOWER(oa.csv_status) LIKE '%anulat%'
                OR LOWER(oa.csv_status) LIKE '%cancelled%'
                OR LOWER(oa.csv_status) LIKE '%neridicat%'
                OR LOWER(oa.csv_status) LIKE '%fara comanda%'
                OR LOWER(oa.csv_status) LIKE '%inchis intern%'
                OR LOWER(oa.csv_status) LIKE '%înregistrată%'
                OR LOWER(oa.csv_status) LIKE '%așteptăm ridicarea%'
                OR LOWER(oa.csv_status) LIKE '%așteptăm predarea%'
                OR LOWER(oa.csv_status) LIKE '%waiting for the package handover%'
                OR LOWER(oa.csv_status) LIKE '%ridicarea nu a avut loc%'
            )
        """))
        affected_order_ids = [row[0] for row in result.fetchall()]
        
        logger.info(f"Found {len(affected_order_ids)} orders with non-billable AWBs")
        
        if not affected_order_ids:
            logger.info("✅ No orders need fixing.")
            return
        
        fixed_count = 0
        total_savings = 0
        
        for order_id in affected_order_ids:
            # Get order
            order_result = await db.execute(
                select(Order).where(Order.id == order_id)
            )
            order = order_result.scalar_one_or_none()
            if not order or not order.transport_cost:
                continue
            
            old_cost = order.transport_cost
            
            # Get all outbound AWBs
            awb_result = await db.execute(
                select(OrderAwb)
                .where(OrderAwb.order_id == order_id)
                .where(OrderAwb.awb_type == 'outbound')
                .where(OrderAwb.transport_cost.isnot(None))
            )
            awbs = awb_result.scalars().all()
            
            billable_cost = 0
            non_billable = []
            
            for awb in awbs:
                if is_billable_status(awb.csv_status):
                    billable_cost += awb.transport_cost
                else:
                    non_billable.append(
                        f"{awb.tracking_number} (status='{awb.csv_status}', cost={awb.transport_cost})"
                    )
            
            billable_cost = round(billable_cost, 2)
            
            if non_billable and billable_cost != old_cost:
                savings = round(old_cost - billable_cost, 2)
                total_savings += savings
                fixed_count += 1
                
                logger.info(
                    f"  #{order.order_number} (uid={order.uid}): "
                    f"{old_cost} → {billable_cost} (saved {savings})"
                )
                for nb in non_billable:
                    logger.info(f"    ❌ Excluded: {nb}")
                
                order.transport_cost = billable_cost
            
            # Commit in batches of 100
            if fixed_count % 100 == 0 and fixed_count > 0:
                await db.commit()
                logger.info(f"  ... committed batch ({fixed_count} orders so far)")
        
        if fixed_count > 0:
            await db.commit()
            logger.info(f"\n✅ Fixed {fixed_count} orders. Total savings: {total_savings} RON")
        else:
            logger.info("\n✅ No orders needed fixing. All transport costs are already correct.")


if __name__ == '__main__':
    asyncio.run(recalculate_all())
