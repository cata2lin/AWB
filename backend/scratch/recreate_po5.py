import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

async def main():
    async with AsyncSessionLocal() as session:
        # Get PO-005
        res = await session.execute(text("SELECT id FROM purchase_orders WHERE po_number='PO-0005'"))
        po = res.fetchone()
        if not po:
            print("PO-0005 not found")
            return
        
        po_id = po[0]
        
        # Get all items
        res = await session.execute(text("SELECT sku, quantity, unit_cost, product_uid, barcode, product_name, variant_title, product_image FROM purchase_order_items WHERE purchase_order_id=:po_id"), {'po_id': po_id})
        items = res.fetchall()
        
        print(f"Found {len(items)} items in PO-0005")
        
        # Merge items by SKU
        merged = {}
        for it in items:
            sku = it[0]
            qty = it[1] or 0
            if sku not in merged:
                merged[sku] = list(it)
            else:
                merged[sku][1] += qty  # sum quantity
                
        print(f"Merged into {len(merged)} unique SKUs")
        
        # Fetch costs for those with 0 cost
        for sku, data in merged.items():
            if not data[2] or float(data[2]) == 0.0:
                cost_res = await session.execute(text("SELECT cost FROM sku_costs WHERE sku=:sku"), {'sku': sku})
                cost = cost_res.scalar()
                if cost:
                    data[2] = cost
                    print(f"Found cost for {sku}: {cost}")
                else:
                    print(f"WARNING: Cost still 0 for {sku}")
                    
        # Create new PO
        # First get the next PO number
        count_res = await session.execute(text("SELECT count(id) FROM purchase_orders"))
        count = count_res.scalar() or 0
        new_po_number = f"PO-{count + 1:04d}"
        
        # Insert PO
        po_insert = text("""
            INSERT INTO purchase_orders (po_number, title, po_category, status, po_type, supplier_name)
            VALUES (:num, 'Recreated from PO-0005', 'packaging', 'DRAFT', 'RESTOCK', 'NUBRA')
            RETURNING id
        """)
        new_po_res = await session.execute(po_insert, {'num': new_po_number})
        new_po_id = new_po_res.scalar()
        print(f"Created new PO: {new_po_number} with ID {new_po_id}")
        
        # Insert merged items
        item_insert = text("""
            INSERT INTO purchase_order_items 
            (purchase_order_id, sku, quantity, unit_cost, product_uid, barcode, product_name, variant_title, product_image, line_cost)
            VALUES 
            (:po_id, :sku, :qty, :cost, :p_uid, :barcode, :p_name, :v_title, :p_img, :l_cost)
        """)
        
        total_items = 0
        total_qty = 0
        total_cost = 0.0
        
        for sku, data in merged.items():
            qty = data[1]
            cost = float(data[2] or 0.0)
            line_cost = qty * cost
            await session.execute(item_insert, {
                'po_id': new_po_id,
                'sku': data[0],
                'qty': qty,
                'cost': cost,
                'p_uid': data[3],
                'barcode': data[4],
                'p_name': data[5],
                'v_title': data[6],
                'p_img': data[7],
                'l_cost': line_cost
            })
            total_items += 1
            total_qty += qty
            total_cost += line_cost
            
        # Update totals
        await session.execute(text("""
            UPDATE purchase_orders 
            SET total_items=:ti, total_quantity=:tq, total_cost=:tc 
            WHERE id=:id
        """), {'ti': total_items, 'tq': total_qty, 'tc': total_cost, 'id': new_po_id})
        
        await session.commit()
        print("Done!")

if __name__ == '__main__':
    asyncio.run(main())
