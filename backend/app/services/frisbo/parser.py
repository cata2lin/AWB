"""
Frisbo order parser — transforms raw Frisbo API JSON into internal format.

Edit THIS file to change how order data is mapped from the Frisbo API.
"""
from typing import Optional, Dict
from datetime import datetime


def _get_item_sku(item: dict) -> Optional[str]:
    """Extract SKU from a line item — checks top-level and inventory_item."""
    sku = item.get("sku")
    if sku:
        return sku
    inv = item.get("inventory_item")
    if inv and isinstance(inv, dict):
        return inv.get("sku")
    return None

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
    
    # Process line items — filter out removed/cancelled items (quantity=0)
    line_items = raw_order.get("line_items", []) or []
    active_items = [item for item in line_items if int(item.get("quantity", 0) or 0) > 0]
    parsed["line_items"] = active_items
    parsed["item_count"] = sum(
        int(item.get("quantity", 1)) for item in active_items
    ) if active_items else 0
    # SKU can be at top level or nested in inventory_item
    parsed["unique_sku_count"] = len(set(
        _get_item_sku(item) for item in active_items if _get_item_sku(item)
    )) if active_items else 0
    
    # Extract courier/AWB info from aggregated_courier
    agg_courier = raw_order.get("aggregated_courier", {}) or {}
    parsed["tracking_number"] = agg_courier.get("tracking_number")
    parsed["courier_name"] = agg_courier.get("name")
    
    # Extract ALL AWBs with full shipment data from the Frisbo response
    # The /orders/search response includes shipment objects with documents, events, etc.
    shipments_raw = raw_order.get("shipments", []) or []
    all_awbs = []
    seen_tracking = set()
    first_outbound_pdf_url = None
    
    for shipment in shipments_raw:
        if not isinstance(shipment, dict):
            continue
        
        shipment_uid = shipment.get("uid")
        courier_id = shipment.get("courier_id")
        shipment_created = _parse_datetime(shipment.get("created_at"))
        tracking_only = shipment.get("tracking_only", False)
        
        # Extract tracking number from shipment identifiers
        identifiers = shipment.get("identifiers", []) or []
        tracking = None
        for ident in identifiers:
            if isinstance(ident, dict) and ident.get("key") == "tracking_number":
                tracking = ident.get("value")
                break
        
        # Fallback: try direct tracking_number field
        if not tracking:
            tracking = shipment.get("tracking_number")
        
        # Extract courier name
        courier = courier_id or shipment.get("courier_name")
        if isinstance(shipment.get("courier"), dict):
            courier = courier or shipment["courier"].get("name")
        
        # Extract events (latest + history)
        events_obj = shipment.get("events", {}) or {}
        latest_event = events_obj.get("latest_event", {}) or {} if isinstance(events_obj, dict) else {}
        processed_events = events_obj.get("processed", []) or [] if isinstance(events_obj, dict) else []
        
        latest_event_key = latest_event.get("key") if isinstance(latest_event, dict) else None
        latest_event_date = _parse_datetime(latest_event.get("date")) if isinstance(latest_event, dict) else None
        
        # Build serializable events list for storage
        events_list = []
        for evt in processed_events:
            if isinstance(evt, dict):
                events_list.append({
                    "key": evt.get("key"),
                    "date": evt.get("date"),
                    "id": evt.get("id"),
                    "returning": evt.get("returning", False),
                    "redirected": evt.get("redirected", False),
                    "reason_status": evt.get("reason_status"),
                })
        
        # Extract documents and label URLs
        documents = shipment.get("documents", []) or []
        awb_pdf_url = None
        awb_pdf_format = None
        is_return_doc = False
        is_redirect_doc = False
        
        for doc in documents:
            if not isinstance(doc, dict):
                continue
            is_return_doc = doc.get("is_return", False) or is_return_doc
            is_redirect_doc = doc.get("is_redirect", False) or is_redirect_doc
            labels = doc.get("labels", []) or []
            for label in labels:
                if isinstance(label, dict) and label.get("download_url"):
                    awb_pdf_url = label["download_url"]
                    awb_pdf_format = label.get("format", "pdf")
                    break  # Take first label
            if awb_pdf_url:
                break
        
        # Extract payment/COD details from shipment.details
        details = shipment.get("details", {}) or {}
        payment = details.get("payment", {}) or {} if isinstance(details, dict) else {}
        paid_by = payment.get("paid_by") if isinstance(payment, dict) else None
        cod_value = payment.get("cash_on_delivery_value") if isinstance(payment, dict) else None
        cod_currency = payment.get("currency") if isinstance(payment, dict) else None
        is_cod = payment.get("cash_on_delivery", False) if isinstance(payment, dict) else False
        
        # Determine AWB type
        shipment_type = shipment.get("type", "").lower() if shipment.get("type") else ""
        if "return" in shipment_type or "retur" in shipment_type or is_return_doc:
            awb_type = "return"
        else:
            awb_type = "outbound"
        
        # Track first outbound PDF URL for the order
        if awb_type == "outbound" and awb_pdf_url and not first_outbound_pdf_url:
            first_outbound_pdf_url = awb_pdf_url
        
        # Use tracking number or shipment_uid as dedup key
        dedup_key = tracking or shipment_uid
        if dedup_key and dedup_key not in seen_tracking:
            seen_tracking.add(dedup_key)
            all_awbs.append({
                "tracking_number": tracking or "",
                "courier_name": courier or agg_courier.get("name"),
                "awb_type": awb_type,
                "shipment_uid": shipment_uid,
                "awb_pdf_url": awb_pdf_url,
                "awb_pdf_format": awb_pdf_format,
                "shipment_status": latest_event_key,
                "shipment_status_date": latest_event_date,
                "is_return_label": is_return_doc,
                "is_redirect_label": is_redirect_doc,
                "paid_by": paid_by,
                "cod_value": cod_value if is_cod else None,
                "cod_currency": cod_currency if is_cod else None,
                "shipment_created_at": shipment_created,
                "shipment_events": events_list if events_list else None,
            })
    
    # Fallback: if no shipments found but aggregated_courier has a tracking number
    if not all_awbs and parsed["tracking_number"]:
        all_awbs.append({
            "tracking_number": parsed["tracking_number"],
            "courier_name": parsed["courier_name"],
            "awb_type": "outbound",
            "shipment_uid": None,
            "awb_pdf_url": None,
            "awb_pdf_format": None,
            "shipment_status": None,
            "shipment_status_date": None,
            "is_return_label": False,
            "is_redirect_label": False,
            "paid_by": None,
            "cod_value": None,
            "cod_currency": None,
            "shipment_created_at": None,
            "shipment_events": None,
        })
    
    parsed["all_awbs"] = all_awbs
    
    # Set order's AWB PDF URL from the first outbound shipment
    parsed["awb_pdf_url"] = first_outbound_pdf_url
    # Set the shipment UID from the first AWB
    if all_awbs:
        parsed["shipment_uid"] = all_awbs[0].get("shipment_uid")
    
    # Extract order-level shipment_status and aggregated_status for delivery tracking
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
