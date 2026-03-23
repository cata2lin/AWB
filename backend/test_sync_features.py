"""Test script to verify enhanced AWB parsing and product parsing."""
from app.services.frisbo.parser import parse_order
from app.services.frisbo.product_parser import parse_product

def test_awb_parsing():
    """Test that full shipment data is extracted from order."""
    mock_order = {
        "uid": "test-order-123",
        "reference": "EST99999",
        "store_uid": "store-1",
        "shipping_address": {"name": "John Doe", "email": "john@test.com", "city": "Bucharest"},
        "line_items": [{"sku": "SKU-001", "quantity": 2, "price": 50.0}],
        "fulfillment_status": {"key": "fulfilled", "date": "2026-03-15T10:00:00Z"},
        "financial_status": {"key": "paid"},
        "shipment_status": {"key": "delivered"},
        "aggregated_status": {"key": "delivered"},
        "aggregated_courier": {"name": "DPD", "tracking_number": "DPD123456"},
        "prices": {"total_price": 120.0, "subtotal_price": 100.0, "total_discounts": 0},
        "payment": {"currency": "RON", "gateway_names": ["Ramburs"]},
        "created_at": "2026-03-10T08:00:00Z",
        "shipments": [
            {
                "uid": "shipment-001",
                "courier_id": "dpd_ro",
                "tracking_number": "DPD123456",
                "created_at": "2026-03-11T09:00:00Z",
                "documents": [{
                    "is_return": False,
                    "is_redirect": False,
                    "labels": [{"download_url": "https://cdn.frisbo.dev/labels/DPD123456.pdf", "format": "pdf"}]
                }],
                "events": {
                    "latest_event": {"key": "delivered", "date": "2026-03-15T14:00:00Z"},
                    "processed": [
                        {"key": "generated_awb", "date": "2026-03-11T09:00:00Z"},
                        {"key": "in_transit", "date": "2026-03-12T10:00:00Z"},
                        {"key": "delivered", "date": "2026-03-15T14:00:00Z"},
                    ]
                },
                "details": {
                    "payment": {
                        "paid_by": "receiver",
                        "cash_on_delivery": True,
                        "cash_on_delivery_value": 120.0,
                        "currency": "RON",
                    }
                }
            }
        ]
    }

    parsed = parse_order(mock_order)
    awbs = parsed["all_awbs"]
    
    assert len(awbs) == 1, f"Expected 1 AWB, got {len(awbs)}"
    awb = awbs[0]
    assert awb["tracking_number"] == "DPD123456"
    assert awb["shipment_uid"] == "shipment-001"
    assert awb["awb_pdf_url"] == "https://cdn.frisbo.dev/labels/DPD123456.pdf"
    assert awb["awb_pdf_format"] == "pdf"
    assert awb["shipment_status"] == "delivered"
    assert awb["shipment_status_date"] is not None
    assert awb["is_return_label"] == False
    assert awb["is_redirect_label"] == False
    assert awb["paid_by"] == "receiver"
    assert awb["cod_value"] == 120.0
    assert awb["cod_currency"] == "RON"
    assert awb["shipment_created_at"] is not None
    assert len(awb["shipment_events"]) == 3
    
    # Order-level fields
    assert parsed["awb_pdf_url"] == "https://cdn.frisbo.dev/labels/DPD123456.pdf"
    assert parsed["shipment_uid"] == "shipment-001"
    assert parsed["shipment_status"] == "delivered"
    assert parsed["aggregated_status"] == "delivered"
    assert parsed["total_price"] == 120.0
    assert parsed["currency"] == "RON"
    assert parsed["payment_gateway"] == "Ramburs"
    
    print("AWB parsing: ALL TESTS PASSED!")


def test_product_parsing():
    """Test that product data is correctly parsed."""
    mock_product = {
        "uid": "prod-001",
        "organization_uid": "org-001",
        "external_identifier": "shopify-12345",
        "title_1": "Premium Widget",
        "title_2": "Red / Large",
        "state": "active",
        "weight": 500, "height": 100, "width": 50, "length": 200,
        "codes": [
            {"key": "sku", "value": "WIDGET-RED-L"},
            {"key": "barcode", "value": "1234567890123"},
            {"key": "hs_code", "value": "9503.00"},
        ],
        "images": [
            {"src": "https://cdn.frisbo.dev/img/widget1.jpg", "position": 0},
            {"src": "https://cdn.frisbo.dev/img/widget2.jpg", "position": 1},
        ],
        "selling_channels_store_uids": ["store-1", "store-2", "store-3"],
        "aggregated_inventory_levels": {
            "all": {"available": 150, "committed": 25, "incoming": 50},
            "frisbo": {"available": 100, "committed": 20, "incoming": 30},
            "other": {"available": 50, "committed": 5, "incoming": 20},
        },
        "requires_shipping": True,
        "quantity_tracked": True,
        "managed_by": "frisbo",
        "selling_policy": "deny",
        "created_at": "2025-01-15T10:00:00Z",
        "updated_at": "2026-03-19T08:00:00Z",
    }

    parsed = parse_product(mock_product)
    
    assert parsed["uid"] == "prod-001"
    assert parsed["sku"] == "WIDGET-RED-L"
    assert parsed["barcode"] == "1234567890123"
    assert parsed["hs_code"] == "9503.00"
    assert parsed["title_1"] == "Premium Widget"
    assert parsed["title_2"] == "Red / Large"
    assert parsed["store_uids"] == ["store-1", "store-2", "store-3"]
    assert parsed["stock_available"] == 150
    assert parsed["stock_committed"] == 25
    assert parsed["stock_incoming"] == 50
    assert parsed["stock_frisbo_available"] == 100
    assert parsed["stock_other_available"] == 50
    assert len(parsed["images"]) == 2
    assert parsed["weight"] == 500
    assert parsed["managed_by"] == "frisbo"
    assert parsed["frisbo_created_at"] is not None
    assert parsed["frisbo_updated_at"] is not None
    
    print("Product parsing: ALL TESTS PASSED!")


def test_multi_awb_parsing():
    """Test parsing order with multiple shipments (outbound + return)."""
    mock_order = {
        "uid": "multi-awb-order",
        "reference": "EST88888",
        "store_uid": "store-1",
        "shipping_address": {"name": "Jane Doe"},
        "line_items": [{"sku": "SKU-002", "quantity": 1}],
        "fulfillment_status": "fulfilled",
        "financial_status": "paid",
        "shipment_status": {"key": "returning_to_sender"},
        "aggregated_status": {"key": "back_to_sender"},
        "aggregated_courier": {"name": "Sameday", "tracking_number": "SM100001"},
        "prices": {"total_price": 80.0, "subtotal_price": 70.0, "total_discounts": 10.0},
        "payment": {"currency": "RON", "gateway_names": []},
        "created_at": "2026-03-05T08:00:00Z",
        "shipments": [
            {
                "uid": "ship-outbound",
                "courier_id": "sameday_ro",
                "tracking_number": "SM100001",
                "type": "outbound",
                "created_at": "2026-03-06T10:00:00Z",
                "documents": [{
                    "is_return": False,
                    "labels": [{"download_url": "https://cdn.frisbo.dev/labels/SM100001.pdf", "format": "pdf"}]
                }],
                "events": {
                    "latest_event": {"key": "delivered", "date": "2026-03-08T12:00:00Z"},
                    "processed": [
                        {"key": "generated_awb", "date": "2026-03-06T10:00:00Z"},
                        {"key": "delivered", "date": "2026-03-08T12:00:00Z"},
                    ]
                },
                "details": {"payment": {"paid_by": "sender", "cash_on_delivery": False}}
            },
            {
                "uid": "ship-return",
                "courier_id": "sameday_ro",
                "tracking_number": "SM100002",
                "type": "return",
                "created_at": "2026-03-10T14:00:00Z",
                "documents": [{
                    "is_return": True,
                    "labels": [{"download_url": "https://cdn.frisbo.dev/labels/SM100002.pdf", "format": "pdf"}]
                }],
                "events": {
                    "latest_event": {"key": "returning_to_sender", "date": "2026-03-12T09:00:00Z"},
                    "processed": [
                        {"key": "returning_to_sender", "date": "2026-03-12T09:00:00Z"},
                    ]
                },
                "details": {"payment": {"paid_by": "sender", "cash_on_delivery": False}}
            }
        ]
    }

    parsed = parse_order(mock_order)
    awbs = parsed["all_awbs"]
    
    assert len(awbs) == 2, f"Expected 2 AWBs (outbound+return), got {len(awbs)}"
    
    # First should be outbound
    assert awbs[0]["awb_type"] == "outbound"
    assert awbs[0]["tracking_number"] == "SM100001"
    assert awbs[0]["awb_pdf_url"] == "https://cdn.frisbo.dev/labels/SM100001.pdf"
    
    # Second should be return
    assert awbs[1]["awb_type"] == "return"
    assert awbs[1]["tracking_number"] == "SM100002"
    assert awbs[1]["is_return_label"] == True
    assert awbs[1]["awb_pdf_url"] == "https://cdn.frisbo.dev/labels/SM100002.pdf"
    
    # Order's awb_pdf_url should be the OUTBOUND one
    assert parsed["awb_pdf_url"] == "https://cdn.frisbo.dev/labels/SM100001.pdf"
    
    print("Multi-AWB parsing: ALL TESTS PASSED!")


if __name__ == "__main__":
    test_awb_parsing()
    test_product_parsing()
    test_multi_awb_parsing()
    print("\n=== ALL TESTS PASSED! ===")
