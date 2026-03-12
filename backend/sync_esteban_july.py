"""
One-off sync: Esteban.ro orders for June 30 - August 1, 2025.
Fetches from Frisbo API and upserts into local database.
"""
import asyncio
import json
import logging
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

async def main():
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal
    from app.services.frisbo.client import FrisboClient
    from app.services.frisbo.parser import parse_order
    from app.services.sync_service import ensure_store_exists
    from sqlalchemy import select
    from app.models import Order

    # Find esteban.ro token
    org_tokens = settings.get_org_tokens()
    esteban_token = None
    for org in org_tokens:
        if org.get("name", "").lower() == "esteban.ro":
            esteban_token = org["token"]
            break

    if not esteban_token:
        logger.error("❌ Could not find esteban.ro token in FRISBO_ORG_TOKENS")
        return

    logger.info("✅ Found esteban.ro token")

    # Date range: June 30 – August 1, 2025
    created_at_start = "2025-06-30T00:00:00"
    created_at_end = "2025-08-01T23:59:59"

    client = FrisboClient(token=esteban_token, org_name="esteban.ro")

    total_fetched = 0
    new_count = 0
    updated_count = 0
    skip = 0
    BATCH_SIZE = 100

    async with AsyncSessionLocal() as db:
        while True:
            try:
                result = await client.search_orders(
                    skip=skip,
                    limit=BATCH_SIZE,
                    created_at_start=created_at_start,
                    created_at_end=created_at_end
                )
            except Exception as e:
                logger.error(f"❌ API error at skip={skip}: {e}")
                break

            orders_batch = []
            if isinstance(result, dict):
                if result.get("success") is False:
                    logger.error(f"❌ Frisbo API error: {result}")
                    break
                data = result.get("data", {})
                if isinstance(data, dict):
                    orders_batch = data.get("orders", [])
                elif isinstance(data, list):
                    orders_batch = data

            if not orders_batch:
                logger.info(f"✅ No more orders at skip={skip}. Total fetched: {total_fetched}")
                break

            batch_fetched = len(orders_batch)
            total_fetched += batch_fetched

            for raw_order in orders_batch:
                parsed = parse_order(raw_order)
                if not parsed:
                    continue

                frisbo_id = parsed.get("frisbo_order_id")
                if not frisbo_id:
                    continue

                # Ensure the store exists
                store_uid = parsed.get("store_uid", "")
                if store_uid:
                    await ensure_store_exists(db, store_uid)

                # Check if order exists
                existing = await db.execute(
                    select(Order).where(Order.frisbo_order_id == frisbo_id)
                )
                existing_order = existing.scalar_one_or_none()

                if existing_order:
                    # Update existing order
                    for key, value in parsed.items():
                        if hasattr(existing_order, key) and value is not None:
                            setattr(existing_order, key, value)
                    updated_count += 1
                else:
                    # Insert new order
                    new_order = Order(**parsed)
                    db.add(new_order)
                    new_count += 1

            await db.commit()
            logger.info(f"📦 Batch: skip={skip}, fetched={batch_fetched}, running total={total_fetched} (new={new_count}, updated={updated_count})")
            skip += BATCH_SIZE

    logger.info(f"""
╔══════════════════════════════════════════╗
║  SYNC COMPLETE — esteban.ro July 2025   ║
║  Date range: {created_at_start[:10]} → {created_at_end[:10]}  ║
║  Total fetched: {total_fetched:>6}                  ║
║  New orders:    {new_count:>6}                  ║
║  Updated:       {updated_count:>6}                  ║
╚══════════════════════════════════════════╝
""")

if __name__ == "__main__":
    asyncio.run(main())
