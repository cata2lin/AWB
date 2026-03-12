"""Pull all orders from Dec 2025 to today across all 20 Frisbo organizations."""
import asyncio
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)

from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models import Order, OrderAwb, Store, SyncLog
from app.services.frisbo.client import FrisboClient
from app.services.frisbo.parser import parse_order
from sqlalchemy import select

BATCH_SIZE = 100
CREATED_AT_START = "2025-12-01T00:00:00+02:00"


async def ensure_store_exists(db, store_uid):
    if not store_uid:
        return
    result = await db.execute(select(Store).where(Store.uid == store_uid))
    if not result.scalar_one_or_none():
        colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#ef4444',
                  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4']
        hash_val = sum(ord(c) for c in store_uid)
        store = Store(uid=store_uid, name=store_uid, color_code=colors[hash_val % len(colors)])
        db.add(store)
        await db.flush()


async def run_sync():
    org_tokens = settings.get_org_tokens()
    logger.info(f"Starting sync across {len(org_tokens)} orgs from {CREATED_AT_START}")
    
    total_fetched = 0
    total_new = 0
    total_updated = 0
    
    async with AsyncSessionLocal() as db:
        # Create sync log
        sync_log = SyncLog(status="running")
        db.add(sync_log)
        await db.flush()
        
        for org_idx, org in enumerate(org_tokens):
            org_name = org.get("name", f"org-{org_idx}")
            org_token = org.get("token", "")
            
            if not org_token:
                logger.warning(f"Skipping org '{org_name}' — no token")
                continue
            
            logger.info(f"[{org_idx+1}/{len(org_tokens)}] Syncing: {org_name}")
            
            client = FrisboClient(token=org_token, org_name=org_name)
            org_fetched = 0
            skip = 0
            
            while True:
                try:
                    result = await client.search_orders(
                        skip=skip,
                        limit=BATCH_SIZE,
                        created_at_start=CREATED_AT_START
                    )
                except Exception as e:
                    logger.error(f"API error for '{org_name}' at skip={skip}: {e}")
                    break
                
                # Parse response
                orders_batch = []
                if isinstance(result, dict):
                    if result.get("success") is False:
                        logger.error(f"API error for '{org_name}': {result}")
                        break
                    data = result.get("data", {})
                    if isinstance(data, dict):
                        orders_batch = data.get("orders", [])
                    elif isinstance(data, list):
                        orders_batch = data
                
                if not orders_batch:
                    logger.info(f"[{org_name}] Done. Org total: {org_fetched}")
                    break
                
                batch_fetched = len(orders_batch)
                org_fetched += batch_fetched
                total_fetched += batch_fetched
                
                for raw_order in orders_batch:
                    if not isinstance(raw_order, dict):
                        continue
                    
                    parsed = parse_order(raw_order)
                    await ensure_store_exists(db, parsed["store_uid"])
                    
                    existing_result = await db.execute(
                        select(Order).where(Order.uid == parsed["uid"])
                    )
                    existing = existing_result.scalar_one_or_none()
                    
                    if existing:
                        existing.tracking_number = parsed.get("tracking_number") or existing.tracking_number
                        existing.awb_pdf_url = parsed.get("awb_pdf_url") or existing.awb_pdf_url
                        existing.courier_name = parsed.get("courier_name") or existing.courier_name
                        existing.shipment_uid = parsed.get("shipment_uid") or existing.shipment_uid
                        existing.fulfillment_status = parsed["fulfillment_status"]
                        existing.shipment_status = parsed.get("shipment_status")
                        existing.aggregated_status = parsed.get("aggregated_status")
                        existing.fulfilled_at = parsed.get("fulfilled_at") or existing.fulfilled_at
                        existing.total_price = parsed.get("total_price") or existing.total_price
                        existing.subtotal_price = parsed.get("subtotal_price") or existing.subtotal_price
                        existing.total_discounts = parsed.get("total_discounts") or existing.total_discounts
                        existing.currency = parsed.get("currency") or existing.currency
                        existing.payment_gateway = parsed.get("payment_gateway") or existing.payment_gateway
                        existing.synced_at = datetime.utcnow()
                        total_updated += 1
                        order_obj = existing
                    else:
                        order_obj = Order(
                            uid=parsed["uid"],
                            order_number=parsed["order_number"],
                            store_uid=parsed["store_uid"],
                            customer_name=parsed["customer_name"],
                            customer_email=parsed.get("customer_email"),
                            shipping_address=parsed.get("shipping_address"),
                            line_items=parsed["line_items"],
                            item_count=parsed["item_count"],
                            unique_sku_count=parsed["unique_sku_count"],
                            tracking_number=parsed.get("tracking_number"),
                            courier_name=parsed.get("courier_name"),
                            awb_pdf_url=parsed.get("awb_pdf_url"),
                            shipment_uid=parsed.get("shipment_uid"),
                            fulfillment_status=parsed["fulfillment_status"],
                            financial_status=parsed.get("financial_status", "pending"),
                            shipment_status=parsed.get("shipment_status"),
                            aggregated_status=parsed.get("aggregated_status"),
                            frisbo_created_at=parsed.get("frisbo_created_at"),
                            fulfilled_at=parsed.get("fulfilled_at"),
                            total_price=parsed.get("total_price"),
                            subtotal_price=parsed.get("subtotal_price"),
                            total_discounts=parsed.get("total_discounts"),
                            currency=parsed.get("currency", "RON"),
                            payment_gateway=parsed.get("payment_gateway"),
                            synced_at=datetime.utcnow()
                        )
                        db.add(order_obj)
                        total_new += 1
                    
                    # Upsert order_awbs
                    all_awbs = parsed.get("all_awbs", [])
                    if all_awbs:
                        await db.flush()
                        existing_awbs_result = await db.execute(
                            select(OrderAwb).where(OrderAwb.order_id == order_obj.id)
                        )
                        existing_awbs = {oa.tracking_number: oa for oa in existing_awbs_result.scalars().all()}
                        
                        for awb_data in all_awbs:
                            tn = awb_data["tracking_number"]
                            if tn in existing_awbs:
                                ea = existing_awbs[tn]
                                ea.courier_name = awb_data.get("courier_name") or ea.courier_name
                                ea.awb_type = awb_data.get("awb_type") or ea.awb_type
                            else:
                                db.add(OrderAwb(
                                    order_id=order_obj.id,
                                    tracking_number=tn,
                                    courier_name=awb_data.get("courier_name"),
                                    awb_type=awb_data.get("awb_type", "outbound"),
                                    data_source="frisbo_sync",
                                    created_at=datetime.utcnow(),
                                ))
                
                # Commit batch
                sync_log.orders_fetched = total_fetched
                sync_log.orders_new = total_new
                sync_log.orders_updated = total_updated
                await db.commit()
                
                logger.info(f"[{org_name}] Batch saved: {org_fetched} org / {total_fetched} total (new: {total_new}, upd: {total_updated})")
                
                if batch_fetched < BATCH_SIZE:
                    break
                
                skip += BATCH_SIZE
        
        # Final
        sync_log.status = "completed"
        sync_log.completed_at = datetime.utcnow()
        await db.commit()
        
        logger.info(f"SYNC COMPLETE: {total_fetched} orders across {len(org_tokens)} orgs ({total_new} new, {total_updated} updated)")


if __name__ == "__main__":
    asyncio.run(run_sync())
