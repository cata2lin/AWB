DO $$ 
DECLARE 
    po_005_id INT;
    new_po_id INT;
    new_po_num VARCHAR;
BEGIN
    SELECT id INTO po_005_id FROM purchase_orders WHERE po_number = 'PO-0005';
    
    IF po_005_id IS NULL THEN
        RAISE NOTICE 'PO-0005 not found';
        RETURN;
    END IF;
    
    SELECT 'PO-' || LPAD((COUNT(id) + 1)::TEXT, 4, '0') INTO new_po_num FROM purchase_orders;
    
    INSERT INTO purchase_orders (po_number, title, po_category, status, po_type, supplier_name, total_items, total_quantity, total_cost, created_at, updated_at)
    VALUES (new_po_num, 'Recreated from PO-0005', 'packaging', 'DRAFT', 'RESTOCK', 'NUBRA', 0, 0, 0, NOW(), NOW())
    RETURNING id INTO new_po_id;

    INSERT INTO purchase_order_items (purchase_order_id, sku, quantity, unit_cost, product_uid, barcode, product_name, variant_title, product_image, received_qty, is_new_product, created_at, updated_at)
    SELECT 
        new_po_id,
        items.sku,
        SUM(items.quantity),
        COALESCE(NULLIF(MAX(items.unit_cost), 0), (SELECT cost FROM sku_costs WHERE sku = items.sku), 0),
        MAX(items.product_uid),
        MAX(items.barcode),
        MAX(items.product_name),
        MAX(items.variant_title),
        MAX(items.product_image),
        0, FALSE, NOW(), NOW()
    FROM purchase_order_items items
    WHERE items.purchase_order_id = po_005_id
    GROUP BY items.sku;

    UPDATE purchase_orders 
    SET total_items = (SELECT COUNT(id) FROM purchase_order_items WHERE purchase_order_id = new_po_id),
        total_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_items WHERE purchase_order_id = new_po_id),
        total_cost = (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM purchase_order_items WHERE purchase_order_id = new_po_id)
    WHERE id = new_po_id;
    
    RAISE NOTICE 'Created new PO: % with ID %', new_po_num, new_po_id;
END $$;
