import asyncio
import os
import sys

# Setup paths so we can import app modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)) + "/../")

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.product import Product

async def main():
    async with AsyncSessionLocal() as db:
        stock_query = await db.execute(
            select(Product).where(Product.sku.in_(['set-5-lavete-magice', 'set-5-s', 'set-5-m', 'set-5-s-5-m']))
        )
        products = stock_query.scalars().all()
        for p in products:
            print(f"UID: {p.uid}, SKU: {p.sku}, Barcode: {p.barcode}, Excluded: {p.exclude_from_stock}, Stores: {p.store_uids}")

asyncio.run(main())
