"""
Product synchronization service.

Fetches inventory items from Frisbo and syncs them to local database.
- Multi-org support: iterates through ALL organization tokens
- Streaming batch save: commits every BATCH_SIZE products
- Upserts by product UID
"""
import logging
from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models import SyncLog
from app.models.product import Product
from app.services.frisbo.client import FrisboClient
from app.services.frisbo.product_parser import parse_product

logger = logging.getLogger(__name__)

BATCH_SIZE = 100  # Save to database every N products


async def sync_products(sync_id: Optional[int] = None):
    """
    Synchronize products from ALL Frisbo organizations to local database.
    
    Iterates through every org token in FRISBO_ORG_TOKENS.
    For each org, does streaming batch fetch + save.
    
    Args:
        sync_id: ID of the SyncLog entry to update
    """
    org_tokens = settings.get_org_tokens()
    if not org_tokens:
        logger.error("📦 No Frisbo org tokens configured! Check FRISBO_ORG_TOKENS in .env")
        return
    
    logger.info(f"📦 Starting product sync across {len(org_tokens)} organizations")
    
    async with AsyncSessionLocal() as db:
        try:
            # Update or create sync log
            sync_log = None
            if sync_id:
                result = await db.execute(
                    select(SyncLog).where(SyncLog.id == sync_id)
                )
                sync_log = result.scalar_one_or_none()
            
            if not sync_log:
                sync_log = SyncLog(status="running")
                db.add(sync_log)
                await db.flush()
            
            total_fetched = 0
            new_count = 0
            updated_count = 0
            
            for org_idx, org in enumerate(org_tokens):
                org_name = org.get("name", f"org-{org_idx}")
                org_token = org.get("token", "")
                
                if not org_token:
                    logger.warning(f"📦 Skipping org '{org_name}' — no token")
                    continue
                
                logger.info(f"📦 [{org_idx+1}/{len(org_tokens)}] Syncing products for org: {org_name}")
                
                client = FrisboClient(token=org_token, org_name=org_name)
                
                org_fetched = 0
                skip = 0
                
                while True:
                    # Fetch one batch of products
                    try:
                        result = await client.search_products(skip=skip, limit=BATCH_SIZE)
                    except Exception as e:
                        logger.error(f"📦 Product API error for org '{org_name}' at skip={skip}: {e}")
                        break
                    
                    # Parse response - Frisbo structure: {"success": true, "data": {"inventory_items": [...]}}
                    items_batch = []
                    if isinstance(result, dict):
                        if result.get("success") is False:
                            logger.error(f"Frisbo product API error for org '{org_name}': {result}")
                            break
                        data = result.get("data", {})
                        if isinstance(data, dict):
                            items_batch = data.get("inventory_items", [])
                        elif isinstance(data, list):
                            items_batch = data
                    
                    if not items_batch:
                        logger.info(f"📦 [{org_name}] No more products. Total for org: {org_fetched}")
                        break
                    
                    batch_fetched = len(items_batch)
                    org_fetched += batch_fetched
                    total_fetched += batch_fetched
                    
                    # Process and save this batch
                    for raw_item in items_batch:
                        if not isinstance(raw_item, dict):
                            continue
                        
                        parsed = parse_product(raw_item)
                        
                        if not parsed.get("uid"):
                            continue
                        
                        # Check if product exists
                        existing_result = await db.execute(
                            select(Product).where(Product.uid == parsed["uid"])
                        )
                        existing = existing_result.scalar_one_or_none()
                        
                        if existing:
                            # Update existing product
                            existing.organization_uid = parsed.get("organization_uid") or existing.organization_uid
                            existing.external_identifier = parsed.get("external_identifier") or existing.external_identifier
                            existing.title_1 = parsed.get("title_1") or existing.title_1
                            existing.title_2 = parsed.get("title_2") or existing.title_2
                            existing.sku = parsed.get("sku") or existing.sku
                            existing.barcode = parsed.get("barcode") or existing.barcode
                            existing.hs_code = parsed.get("hs_code") or existing.hs_code
                            # State: always take Frisbo's value when provided (draft, archived, etc.)
                            if parsed.get("state") is not None:
                                existing.state = parsed["state"]
                            existing.weight = parsed.get("weight") if parsed.get("weight") is not None else existing.weight
                            existing.height = parsed.get("height") if parsed.get("height") is not None else existing.height
                            existing.width = parsed.get("width") if parsed.get("width") is not None else existing.width
                            existing.length = parsed.get("length") if parsed.get("length") is not None else existing.length
                            existing.requires_shipping = parsed.get("requires_shipping") if parsed.get("requires_shipping") is not None else existing.requires_shipping
                            existing.quantity_tracked = parsed.get("quantity_tracked") if parsed.get("quantity_tracked") is not None else existing.quantity_tracked
                            existing.managed_by = parsed.get("managed_by") or existing.managed_by
                            existing.selling_policy = parsed.get("selling_policy") or existing.selling_policy
                            # Always update dynamic data
                            existing.images = parsed.get("images") if parsed.get("images") else existing.images
                            existing.store_uids = parsed.get("store_uids") if parsed.get("store_uids") else existing.store_uids
                            existing.stock_available = parsed.get("stock_available", 0)
                            existing.stock_committed = parsed.get("stock_committed", 0)
                            existing.stock_incoming = parsed.get("stock_incoming", 0)
                            existing.stock_frisbo_available = parsed.get("stock_frisbo_available", 0)
                            existing.stock_other_available = parsed.get("stock_other_available", 0)
                            existing.frisbo_updated_at = parsed.get("frisbo_updated_at") or existing.frisbo_updated_at
                            existing.synced_at = datetime.utcnow()
                            updated_count += 1
                        else:
                            # Create new product
                            product_obj = Product(
                                uid=parsed["uid"],
                                organization_uid=parsed.get("organization_uid"),
                                external_identifier=parsed.get("external_identifier"),
                                title_1=parsed.get("title_1"),
                                title_2=parsed.get("title_2"),
                                sku=parsed.get("sku"),
                                barcode=parsed.get("barcode"),
                                hs_code=parsed.get("hs_code"),
                                state=parsed.get("state", "active"),
                                weight=parsed.get("weight"),
                                height=parsed.get("height"),
                                width=parsed.get("width"),
                                length=parsed.get("length"),
                                requires_shipping=parsed.get("requires_shipping", True),
                                quantity_tracked=parsed.get("quantity_tracked", True),
                                managed_by=parsed.get("managed_by"),
                                selling_policy=parsed.get("selling_policy"),
                                images=parsed.get("images"),
                                store_uids=parsed.get("store_uids"),
                                stock_available=parsed.get("stock_available", 0),
                                stock_committed=parsed.get("stock_committed", 0),
                                stock_incoming=parsed.get("stock_incoming", 0),
                                stock_frisbo_available=parsed.get("stock_frisbo_available", 0),
                                stock_other_available=parsed.get("stock_other_available", 0),
                                frisbo_created_at=parsed.get("frisbo_created_at"),
                                frisbo_updated_at=parsed.get("frisbo_updated_at"),
                                synced_at=datetime.utcnow(),
                            )
                            db.add(product_obj)
                            new_count += 1
                    
                    # Commit this batch
                    sync_log.orders_fetched = total_fetched
                    sync_log.orders_new = new_count
                    sync_log.orders_updated = updated_count
                    await db.commit()
                    
                    logger.info(f"📦 [{org_name}] PRODUCT BATCH SAVED: {org_fetched} org / {total_fetched} total (new: {new_count}, updated: {updated_count})")
                    
                    if batch_fetched < BATCH_SIZE:
                        logger.info(f"📦 [{org_name}] Reached end of products. Org total: {org_fetched}")
                        break
                    
                    skip += BATCH_SIZE
                
                logger.info(f"📦 [{org_name}] Product sync completed: {org_fetched} products")
            
            # Final update
            sync_log.orders_fetched = total_fetched
            sync_log.orders_new = new_count
            sync_log.orders_updated = updated_count
            sync_log.status = "completed"
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            logger.info(f"📦 PRODUCT SYNC COMPLETED: {total_fetched} fetched across {len(org_tokens)} orgs, {new_count} new, {updated_count} updated")
            
        except Exception as e:
            logger.error(f"📦 PRODUCT SYNC FAILED: {e}")
            import traceback
            traceback.print_exc()
            if sync_log:
                sync_log.status = "failed"
                sync_log.error_message = str(e)
                sync_log.completed_at = datetime.utcnow()
                await db.commit()
            raise
