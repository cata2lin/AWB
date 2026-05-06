import asyncio
from sqlalchemy import text
from app.db.database import async_session

async def main():
    async with async_session() as session:
        # Get PO
        res = await session.execute(text("SELECT id, po_category, status FROM purchase_orders WHERE po_number='PO-0005'"))
        po = res.fetchone()
        if not po:
            print('PO-0005 not found')
            return
        print(f'PO ID: {po[0]}, Category: {po[1]}, Status: {po[2]}')

        # Get items
        res = await session.execute(text("SELECT id, sku, quantity, unit_cost FROM purchase_order_items WHERE purchase_order_id=:po_id"), {'po_id': po[0]})
        items = res.fetchall()
        print(f'Items: {len(items)}')
        for i in items:
            print(f' - SKU: {i[1]}, Qty: {i[2]}, Cost: {i[3]}')

if __name__ == '__main__':
    asyncio.run(main())
