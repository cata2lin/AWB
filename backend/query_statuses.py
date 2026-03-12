import asyncio, json
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def main():
    async with AsyncSessionLocal() as db:
        # 1) Sample a line_items JSON to see structure
        r = await db.execute(text("SELECT line_items FROM orders WHERE line_items IS NOT NULL LIMIT 1"))
        row = r.fetchone()
        if row:
            items = json.loads(row[0]) if isinstance(row[0], str) else row[0]
            print("=== LINE_ITEMS SAMPLE (first item) ===")
            if items and len(items) > 0:
                print(json.dumps(items[0], indent=2, default=str))
            print(f"\nTotal items in this order: {len(items)}")
        
        # 2) Check how many orders have transport_cost
        r = await db.execute(text("SELECT COUNT(*) FROM orders WHERE transport_cost IS NOT NULL"))
        print(f"\n=== Orders with transport_cost: {r.scalar()} ===")
        
        # 3) Check shipping_address structure
        r = await db.execute(text("SELECT shipping_address FROM orders WHERE shipping_address IS NOT NULL LIMIT 1"))
        row = r.fetchone()
        if row:
            addr = json.loads(row[0]) if isinstance(row[0], str) else row[0]
            print("\n=== SHIPPING_ADDRESS KEYS ===")
            print(list(addr.keys()) if addr else "None")
        
        # 4) Check pricing samples
        r = await db.execute(text("""
            SELECT total_price, subtotal_price, total_discounts, currency,
                   transport_cost, shipping_data_source
            FROM orders 
            WHERE total_price IS NOT NULL AND subtotal_price IS NOT NULL 
            LIMIT 3
        """))
        rows = r.fetchall()
        print("\n=== PRICING SAMPLES ===")
        for row in rows:
            shipping_charged = (row[0] or 0) - (row[1] or 0)
            print(f"  total={row[0]}, subtotal={row[1]}, discounts={row[2]}, currency={row[3]}, "
                  f"transport_cost={row[4]}, source={row[5]}, shipping_charged_est={shipping_charged:.2f}")

        # 5) Multi-item order sample
        r = await db.execute(text("SELECT uid, line_items, item_count, unique_sku_count FROM orders WHERE unique_sku_count > 1 LIMIT 1"))
        row = r.fetchone()
        if row:
            items = json.loads(row[1]) if isinstance(row[1], str) else row[1]
            print(f"\n=== MULTI-ITEM ORDER (uid={row[0]}, items={row[2]}, skus={row[3]}) ===")
            for i, item in enumerate(items[:3]):
                print(f"  Item {i}: sku={item.get('inventory_item',{}).get('sku','?')}, qty={item.get('quantity',1)}, price={item.get('price','?')}")

asyncio.run(main())
