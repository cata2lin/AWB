"""Map store UIDs to org names by querying 1 order from each org token."""
import asyncio
import logging
from sqlalchemy import select, text
from app.core.database import AsyncSessionLocal, engine
from app.core.config import settings
from app.models import Store
from app.services.frisbo.client import FrisboClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
logger = logging.getLogger(__name__)


async def map_stores():
    org_tokens = settings.get_org_tokens()
    logger.info(f"Mapping store names for {len(org_tokens)} orgs")
    
    # Collect: org_name -> set of store_uids
    org_store_map = {}
    
    for org_idx, org in enumerate(org_tokens):
        org_name = org.get("name", f"org-{org_idx}")
        org_token = org.get("token", "")
        
        if not org_token:
            continue
        
        client = FrisboClient(token=org_token, org_name=org_name)
        
        try:
            # Fetch just a few orders to find store_uids
            result = await client.search_orders(skip=0, limit=5)
            orders = []
            if isinstance(result, dict):
                data = result.get("data", {})
                if isinstance(data, dict):
                    orders = data.get("orders", [])
            
            store_uids = set()
            for o in orders:
                if isinstance(o, dict) and o.get("store_uid"):
                    store_uids.add(o["store_uid"])
            
            org_store_map[org_name] = store_uids
            logger.info(f"[{org_idx+1}/{len(org_tokens)}] {org_name} -> {len(store_uids)} store(s): {store_uids}")
            
        except Exception as e:
            logger.error(f"Error for {org_name}: {e}")
    
    # Now update store names in DB
    async with AsyncSessionLocal() as db:
        updated = 0
        for org_name, store_uids in org_store_map.items():
            for store_uid in store_uids:
                result = await db.execute(
                    select(Store).where(Store.uid == store_uid)
                )
                store = result.scalar_one_or_none()
                if store:
                    store.name = org_name
                    updated += 1
                    logger.info(f"  Updated store {store_uid[:20]}... -> '{org_name}'")
        
        await db.commit()
        logger.info(f"Updated {updated} store names!")


asyncio.run(map_stores())
