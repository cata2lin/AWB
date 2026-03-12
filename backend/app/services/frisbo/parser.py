"""
Frisbo order parser — transforms raw Frisbo API JSON into internal format.

Edit THIS file to change how order data is mapped from the Frisbo API.
"""
from typing import Optional, Dict
from datetime import datetime


def parse_order(raw_order: Dict) -> Dict:
    """
    Parse raw Frisbo order into our internal format.
    
    Frisbo order structure:
    - uid: unique order ID
    - reference: order number (e.g., "EST74670")
    - store_uid: store ID
    - shipping_address: {name, email, phone, address1, city, ...}
    - aggregated_courier: {name, tracking_number, key}
    - aggregated_status: {key, priority, date}
    - fulfillment_status: {key, date}
    - line_items: [] (may be empty)
    - created_at: ISO date string
    """
    # Extract basic order info
    parsed = {
        "uid": raw_order.get("uid"),
        "order_number": raw_order.get("reference", raw_order.get("uid", "")),
        "store_uid": raw_order.get("store_uid", ""),
        "customer_name": _get_customer_name(raw_order),
        "shipping_address": raw_order.get("shipping_address"),
        "frisbo_created_at": _parse_datetime(raw_order.get("created_at")),
    }
    
    # Get customer email from shipping_address
    shipping_addr = raw_order.get("shipping_address", {}) or {}
    parsed["customer_email"] = shipping_addr.get("email")
    
    # Handle fulfillment_status which can be a dict or string
    fulfillment_status = raw_order.get("fulfillment_status", "unfulfilled")
    if isinstance(fulfillment_status, dict):
        parsed["fulfillment_status"] = fulfillment_status.get("key", "unfulfilled")
        # Extract fulfilled_at date
        fulfilled_date = fulfillment_status.get("date")
        if fulfilled_date and parsed["fulfillment_status"] == "fulfilled":
            parsed["fulfilled_at"] = _parse_datetime(fulfilled_date)
        else:
            parsed["fulfilled_at"] = None
    else:
        parsed["fulfillment_status"] = fulfillment_status or "unfulfilled"
        parsed["fulfilled_at"] = None
    
    # Handle financial_status
    financial_status = raw_order.get("financial_status", "pending")
    if isinstance(financial_status, dict):
        parsed["financial_status"] = financial_status.get("key", "pending")
    else:
        parsed["financial_status"] = financial_status or "pending"
    
    # Process line items
    line_items = raw_order.get("line_items", []) or []
    parsed["line_items"] = line_items
    parsed["item_count"] = sum(item.get("quantity", 1) for item in line_items) if line_items else 0
    parsed["unique_sku_count"] = len(set(
        item.get("sku") for item in line_items if item.get("sku")
    )) if line_items else 0
    
    # Extract courier/AWB info from aggregated_courier
    agg_courier = raw_order.get("aggregated_courier", {}) or {}
    parsed["tracking_number"] = agg_courier.get("tracking_number")
    parsed["courier_name"] = agg_courier.get("name")
    
    # Extract ALL AWBs from shipments array (multi-AWB support)
    # Each shipment may have its own tracking number
    shipments = raw_order.get("shipments", []) or []
    all_awbs = []
    seen_tracking = set()
    
    for shipment in shipments:
        if not isinstance(shipment, dict):
            continue
        tracking = shipment.get("tracking_number")
        courier = shipment.get("courier_name") or shipment.get("courier", {}).get("name") if isinstance(shipment.get("courier"), dict) else shipment.get("courier_name")
        
        # Determine AWB type from shipment status/type
        shipment_type = shipment.get("type", "").lower() if shipment.get("type") else ""
        if "return" in shipment_type or "retur" in shipment_type:
            awb_type = "return"
        else:
            awb_type = "outbound"
        
        if tracking and tracking not in seen_tracking:
            seen_tracking.add(tracking)
            all_awbs.append({
                "tracking_number": tracking,
                "courier_name": courier or agg_courier.get("name"),
                "awb_type": awb_type,
            })
    
    # If no shipments found but aggregated_courier has a tracking number, use that
    if not all_awbs and parsed["tracking_number"]:
        all_awbs.append({
            "tracking_number": parsed["tracking_number"],
            "courier_name": parsed["courier_name"],
            "awb_type": "outbound",
        })
    
    parsed["all_awbs"] = all_awbs
    
    # Extract shipment_status and aggregated_status for delivery tracking
    shipment_status = raw_order.get("shipment_status", {}) or {}
    if isinstance(shipment_status, dict):
        parsed["shipment_status"] = shipment_status.get("key")
    else:
        parsed["shipment_status"] = shipment_status
    
    agg_status = raw_order.get("aggregated_status", {}) or {}
    if isinstance(agg_status, dict):
        parsed["aggregated_status"] = agg_status.get("key")
    else:
        parsed["aggregated_status"] = agg_status
    
    # Extract pricing data
    prices = raw_order.get("prices", {}) or {}
    parsed["total_price"] = prices.get("total_price")
    parsed["subtotal_price"] = prices.get("subtotal_price")
    parsed["total_discounts"] = prices.get("total_discounts")
    
    payment = raw_order.get("payment", {}) or {}
    parsed["currency"] = payment.get("currency", "RON")
    gateway_names = payment.get("gateway_names", []) or []
    parsed["payment_gateway"] = gateway_names[0] if gateway_names else None
    
    # shipment_uid and awb_pdf_url may not be directly available
    parsed["shipment_uid"] = None
    parsed["awb_pdf_url"] = None
    
    return parsed


def _get_customer_name(order: Dict) -> str:
    """Extract customer name from order."""
    # Frisbo orders have shipping_address.name as full name
    shipping = order.get("shipping_address", {}) or {}
    
    # Try full name first
    if shipping.get("name"):
        return shipping["name"]
    
    # Try first + last name from shipping
    first = shipping.get("first_name", "") or ""
    last = shipping.get("last_name", "") or ""
    if first or last:
        return f"{first} {last}".strip()
    
    # Fallback to customer object
    customer = order.get("customer", {}) or {}
    if customer:
        first = customer.get("first_name", "") or ""
        last = customer.get("last_name", "") or ""
        if first or last:
            return f"{first} {last}".strip()
    
    return "Unknown Customer"


def _parse_datetime(dt_string: Optional[str]) -> Optional[datetime]:
    """Parse ISO datetime string."""
    if not dt_string:
        return None
    try:
        # Handle various ISO formats
        if "Z" in dt_string:
            dt_string = dt_string.replace("Z", "+00:00")
        return datetime.fromisoformat(dt_string)
    except (ValueError, TypeError):
        return None
