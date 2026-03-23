"""
Order synchronization service.

Fetches orders from Frisbo and syncs them to local database.
- Multi-org support: iterates through ALL organization tokens
- Default sync: orders created in the last 45 days
- Full sync: all orders
- TRUE BATCH SAVING: saves every 100 orders as they are fetched (not at the end)
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, AsyncGenerator, List, Dict
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models import Order, OrderAwb, Store, SyncLog
from app.services.frisbo.client import FrisboClient
from app.services.frisbo.parser import parse_order

logger = logging.getLogger(__name__)

# Default: sync orders created in the last 45 days
DEFAULT_SYNC_DAYS = 45
BATCH_SIZE = 100  # Save to database every N orders


async def sync_orders(
    sync_id: Optional[int] = None,
    full_sync: bool = False,
    sync_type: str = "45_day",
    store_uids: Optional[List[str]] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """
    Synchronize orders from Frisbo organizations to local database.
    
    Iterates through every org token in FRISBO_ORG_TOKENS.
    For each org, does streaming batch fetch + save (100 orders at a time).
    
    Args:
        sync_id: ID of the SyncLog entry to update
        full_sync: If True, fetch ALL orders. If False, fetch only last 45 days.
        sync_type: "45_day", "full", "custom"
        store_uids: Optional list of store UIDs to filter (only sync matching orgs)
        date_from: Optional ISO start date for custom sync
        date_to: Optional ISO end date for custom sync
    """
    org_tokens = settings.get_org_tokens()
    if not org_tokens:
        logger.error("📦 No Frisbo org tokens configured! Check FRISBO_ORG_TOKENS in .env")
        return
    
    logger.info(f"📦 Starting {sync_type} sync across {len(org_tokens)} organizations")
    
    async with AsyncSessionLocal() as db:
        try:
            # Update sync log to running
            sync_log = None
            if sync_id:
                result = await db.execute(
                    select(SyncLog).where(SyncLog.id == sync_id)
                )
                sync_log = result.scalar_one_or_none()
            
            if not sync_log:
                sync_log = SyncLog(status="running", sync_type=sync_type)
                db.add(sync_log)
                await db.flush()
            
            # Record sync metadata in the log
            sync_log.sync_type = sync_type
            if store_uids:
                sync_log.store_uids = store_uids
            if date_from:
                try:
                    parsed = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                    sync_log.date_from = parsed.replace(tzinfo=None)
                except Exception:
                    pass
            if date_to:
                try:
                    parsed = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                    sync_log.date_to = parsed.replace(tzinfo=None)
                except Exception:
                    pass
            await db.commit()
            
            # Determine date range for sync
            created_at_start = None
            created_at_end = None
            if sync_type == "custom" and date_from:
                # Custom sync: use user-provided dates
                created_at_start = date_from
                created_at_end = date_to
                logger.info(f"📦 CUSTOM SYNC: Orders from {date_from} to {date_to or 'now'}")
                if store_uids:
                    logger.info(f"📦 CUSTOM SYNC: Filtering stores: {store_uids}")
            elif not full_sync:
                # Smart sync: only orders from the last 45 days
                cutoff_date = datetime.utcnow() - timedelta(days=DEFAULT_SYNC_DAYS)
                created_at_start = cutoff_date.isoformat()
                logger.info(f"📦 SMART SYNC: Fetching orders created since {created_at_start} (last {DEFAULT_SYNC_DAYS} days)")
            else:
                logger.info(f"📦 FULL SYNC: Fetching all orders")
            
            # Global counters across all orgs
            total_fetched = 0
            new_count = 0
            updated_count = 0
            
            # --- Iterate through ALL organizations ---
            for org_idx, org in enumerate(org_tokens):
                org_name = org.get("name", f"org-{org_idx}")
                org_token = org.get("token", "")
                
                if not org_token:
                    logger.warning(f"📦 Skipping org '{org_name}' — no token")
                    continue
                
                logger.info(f"📦 [{org_idx+1}/{len(org_tokens)}] Syncing org: {org_name}")
                
                # Create a client for this specific org
                client = FrisboClient(token=org_token, org_name=org_name)
                
                org_fetched = 0
                skip = 0
                
                while True:
                    # Fetch one batch from this org's Frisbo API
                    try:
                        result = await client.search_orders(
                            skip=skip,
                            limit=BATCH_SIZE,
                            store_uids=store_uids,
                            created_at_start=created_at_start,
                            created_at_end=created_at_end
                        )
                    except Exception as e:
                        logger.error(f"📦 API error for org '{org_name}' at skip={skip}: {e}")
                        break
                    
                    # Parse response
                    orders_batch = []
                    if isinstance(result, dict):
                        if result.get("success") is False:
                            logger.error(f"Frisbo API error for org '{org_name}': {result}")
                            break
                        data = result.get("data", {})
                        if isinstance(data, dict):
                            orders_batch = data.get("orders", [])
                        elif isinstance(data, list):
                            orders_batch = data
                    
                    if not orders_batch:
                        logger.info(f"📦 [{org_name}] No more orders. Total for org: {org_fetched}")
                        break
                    
                    batch_fetched = len(orders_batch)
                    org_fetched += batch_fetched
                    total_fetched += batch_fetched
                    
                    # Process and save this batch immediately
                    for raw_order in orders_batch:
                        if not isinstance(raw_order, dict):
                            continue
                        
                        parsed = parse_order(raw_order)
                        
                        # Ensure store exists
                        await ensure_store_exists(db, parsed["store_uid"])
                        
                        # Check if order exists
                        existing_result = await db.execute(
                            select(Order).where(Order.uid == parsed["uid"])
                        )
                        existing = existing_result.scalar_one_or_none()
                        
                        if existing:
                            # Update existing order — statuses, tracking, pricing, AND line items
                            existing.tracking_number = parsed.get("tracking_number") or existing.tracking_number
                            existing.awb_pdf_url = parsed.get("awb_pdf_url") or existing.awb_pdf_url
                            existing.courier_name = parsed.get("courier_name") or existing.courier_name
                            existing.shipment_uid = parsed.get("shipment_uid") or existing.shipment_uid
                            existing.fulfillment_status = parsed["fulfillment_status"]
                            existing.shipment_status = parsed.get("shipment_status")
                            existing.aggregated_status = parsed.get("aggregated_status")
                            # Auto-clear stale courier alert when status moves past 'waiting_for_courier'
                            new_agg = parsed.get("aggregated_status")
                            if (existing.waiting_for_courier_since and
                                    new_agg and new_agg != "waiting_for_courier"):
                                existing.waiting_for_courier_since = None
                            existing.fulfilled_at = parsed.get("fulfilled_at") or existing.fulfilled_at
                            # Update pricing
                            existing.total_price = parsed.get("total_price") or existing.total_price
                            existing.subtotal_price = parsed.get("subtotal_price") or existing.subtotal_price
                            existing.total_discounts = parsed.get("total_discounts") or existing.total_discounts
                            existing.currency = parsed.get("currency") or existing.currency
                            existing.payment_gateway = parsed.get("payment_gateway") or existing.payment_gateway
                            # Update line items (captures added/removed items in Frisbo)
                            if parsed.get("line_items") is not None:
                                existing.line_items = parsed["line_items"]
                                existing.item_count = parsed["item_count"]
                                existing.unique_sku_count = parsed["unique_sku_count"]
                            existing.synced_at = datetime.utcnow()
                            updated_count += 1
                            order_obj = existing
                        else:
                            # Create new order
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
                                # Pricing
                                total_price=parsed.get("total_price"),
                                subtotal_price=parsed.get("subtotal_price"),
                                total_discounts=parsed.get("total_discounts"),
                                currency=parsed.get("currency", "RON"),
                                payment_gateway=parsed.get("payment_gateway"),
                                synced_at=datetime.utcnow()
                            )
                            db.add(order_obj)
                            new_count += 1
                        
                        # --- Upsert order_awbs for multi-AWB support ---
                        all_awbs = parsed.get("all_awbs", [])
                        if all_awbs:
                            await db.flush()  # Ensure order_obj.id is set
                            # Get existing AWBs for this order
                            existing_awbs_result = await db.execute(
                                select(OrderAwb).where(OrderAwb.order_id == order_obj.id)
                            )
                            existing_awbs = {oa.tracking_number: oa for oa in existing_awbs_result.scalars().all()}
                            
                            for awb_data in all_awbs:
                                tn = awb_data["tracking_number"]
                                if tn in existing_awbs:
                                    # Update existing AWB (preserve csv_import costs, update shipment data)
                                    existing_awb = existing_awbs[tn]
                                    existing_awb.courier_name = awb_data.get("courier_name") or existing_awb.courier_name
                                    existing_awb.awb_type = awb_data.get("awb_type") or existing_awb.awb_type
                                    # Update Frisbo shipment data (these change over time)
                                    existing_awb.shipment_uid = awb_data.get("shipment_uid") or existing_awb.shipment_uid
                                    existing_awb.awb_pdf_url = awb_data.get("awb_pdf_url") or existing_awb.awb_pdf_url
                                    existing_awb.awb_pdf_format = awb_data.get("awb_pdf_format") or existing_awb.awb_pdf_format
                                    existing_awb.shipment_status = awb_data.get("shipment_status") or existing_awb.shipment_status
                                    existing_awb.shipment_status_date = awb_data.get("shipment_status_date") or existing_awb.shipment_status_date
                                    existing_awb.shipment_events = awb_data.get("shipment_events") or existing_awb.shipment_events
                                    existing_awb.is_return_label = awb_data.get("is_return_label") if awb_data.get("is_return_label") is not None else existing_awb.is_return_label
                                    existing_awb.is_redirect_label = awb_data.get("is_redirect_label") if awb_data.get("is_redirect_label") is not None else existing_awb.is_redirect_label
                                    existing_awb.paid_by = awb_data.get("paid_by") or existing_awb.paid_by
                                    existing_awb.cod_value = awb_data.get("cod_value") if awb_data.get("cod_value") is not None else existing_awb.cod_value
                                    existing_awb.cod_currency = awb_data.get("cod_currency") or existing_awb.cod_currency
                                    existing_awb.shipment_created_at = awb_data.get("shipment_created_at") or existing_awb.shipment_created_at
                                else:
                                    # Create new AWB record with full shipment data
                                    new_awb = OrderAwb(
                                        order_id=order_obj.id,
                                        tracking_number=tn,
                                        courier_name=awb_data.get("courier_name"),
                                        awb_type=awb_data.get("awb_type", "outbound"),
                                        shipment_uid=awb_data.get("shipment_uid"),
                                        awb_pdf_url=awb_data.get("awb_pdf_url"),
                                        awb_pdf_format=awb_data.get("awb_pdf_format"),
                                        shipment_status=awb_data.get("shipment_status"),
                                        shipment_status_date=awb_data.get("shipment_status_date"),
                                        is_return_label=awb_data.get("is_return_label", False),
                                        is_redirect_label=awb_data.get("is_redirect_label", False),
                                        paid_by=awb_data.get("paid_by"),
                                        cod_value=awb_data.get("cod_value"),
                                        cod_currency=awb_data.get("cod_currency"),
                                        shipment_created_at=awb_data.get("shipment_created_at"),
                                        shipment_events=awb_data.get("shipment_events"),
                                        data_source="frisbo_sync",
                                        created_at=datetime.utcnow(),
                                    )
                                    db.add(new_awb)
                    
                    # COMMIT THIS BATCH TO DATABASE IMMEDIATELY
                    sync_log.orders_fetched = total_fetched
                    sync_log.orders_new = new_count
                    sync_log.orders_updated = updated_count
                    await db.commit()
                    
                    logger.info(f"📦 [{org_name}] BATCH SAVED: {org_fetched} org / {total_fetched} total (new: {new_count}, updated: {updated_count})")
                    
                    # Check if we got fewer orders than requested (end of data)
                    if batch_fetched < BATCH_SIZE:
                        logger.info(f"📦 [{org_name}] Reached end of orders. Org total: {org_fetched}")
                        break
                    
                    skip += BATCH_SIZE
                
                logger.info(f"📦 [{org_name}] Completed: {org_fetched} orders")
            
            # Final update
            sync_log.orders_fetched = total_fetched
            sync_log.orders_new = new_count
            sync_log.orders_updated = updated_count
            sync_log.status = "completed"
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            logger.info(f"📦 SYNC COMPLETED: {total_fetched} fetched across {len(org_tokens)} orgs, {new_count} new, {updated_count} updated")
            
        except Exception as e:
            logger.error(f"📦 SYNC FAILED: {e}")
            import traceback
            traceback.print_exc()
            if sync_log:
                sync_log.status = "failed"
                sync_log.error_message = str(e)
                sync_log.completed_at = datetime.utcnow()
                await db.commit()
            raise


async def ensure_store_exists(db: AsyncSession, store_uid: str):
    """Ensure a store exists in the database, create if not."""
    if not store_uid:
        return
    
    result = await db.execute(
        select(Store).where(Store.uid == store_uid)
    )
    if not result.scalar_one_or_none():
        store = Store(
            uid=store_uid,
            name=store_uid,  # Will be updated from API response
            color_code=generate_color_from_uid(store_uid),
        )
        db.add(store)
        await db.flush()


def generate_color_from_uid(uid: str) -> str:
    """Generate a consistent color from a UID string."""
    colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#ef4444',
              '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4']
    hash_val = sum(ord(c) for c in uid)
    return colors[hash_val % len(colors)]
