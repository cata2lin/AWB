import asyncio
from sqlalchemy import text
from app.core.database import engine

async def check():
    async with engine.begin() as c:
        r = await c.execute(text("SELECT count(*) FROM products"))
        print("Product count:", r.scalar())
        r2 = await c.execute(text("SELECT uid, title_1, sku, stock_available FROM products LIMIT 3"))
        for row in r2.fetchall():
            print(f"  {row[0][:12]}... | {row[1]} | SKU:{row[2]} | Stock:{row[3]}")

asyncio.run(check())
