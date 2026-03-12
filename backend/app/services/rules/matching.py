"""
Rule matching logic — evaluates whether an order satisfies a rule's conditions.

Edit THIS file to add new rule conditions.
All conditions use AND logic (all must pass for a match).
"""
from typing import Optional
from app.services.rules.helpers import get_sku, extract_skus


def matches_rule(order, rule, sku_scope: str = "global") -> bool:
    """Check if an order matches a rule's conditions (AND logic — all must pass)."""
    conditions = rule.conditions or {}
    if not conditions:
        return True  # No conditions = matches everything

    # ─── Group 1: Order Size ───────────────────────────────────
    # Min total items (supports both old "item_count_min" and new "min_items")
    min_items = conditions.get("min_items") or conditions.get("item_count_min")
    if min_items is not None and (order.item_count or 0) < int(min_items):
        return False

    # Max total items (supports both old "item_count" as exact and new "max_items")
    max_items = conditions.get("max_items")
    if max_items is not None and (order.item_count or 0) > int(max_items):
        return False

    # Exact item count (legacy: "item_count" means exact match)
    exact_items = conditions.get("item_count")
    if exact_items is not None and (order.item_count or 0) != int(exact_items):
        return False

    # Min unique SKUs (line items / distinct products)
    min_line_items = conditions.get("min_line_items")
    if min_line_items is not None:
        sku_count = order.unique_sku_count or len(extract_skus(order, sku_scope))
        if sku_count < int(min_line_items):
            return False

    # Max unique SKUs
    max_line_items = conditions.get("max_line_items")
    if max_line_items is not None:
        sku_count = order.unique_sku_count or len(extract_skus(order, sku_scope))
        if sku_count > int(max_line_items):
            return False

    # ─── Group 2: SKU Filters ─────────────────────────────────
    line_items = order.line_items or []
    all_skus = [
        (get_sku(item) or "").lower()
        for item in line_items
    ]

    # SKU contains (substring match)
    sku_contains = conditions.get("sku_contains")
    if sku_contains:
        pattern = sku_contains.lower()
        if not any(pattern in sku for sku in all_skus):
            return False

    # SKU exact match (order has at least one of these exact SKUs)
    sku_exact = conditions.get("sku_exact")
    if sku_exact:
        exact_set = {s.lower() for s in sku_exact}
        if not any(sku in exact_set for sku in all_skus):
            return False

    # SKU excludes (order must NOT have any SKU containing this)
    sku_excludes = conditions.get("sku_excludes")
    if sku_excludes:
        pattern = sku_excludes.lower()
        if any(pattern in sku for sku in all_skus):
            return False

    # ─── Group 3: Logistics ────────────────────────────────────
    # Store filter
    store_uids = conditions.get("store_uids")
    if store_uids and order.store_uid not in store_uids:
        return False

    # Courier filter
    courier_name = conditions.get("courier_name")
    if courier_name:
        if not order.courier_name or courier_name.lower() not in order.courier_name.lower():
            return False

    # Payment gateway filter (e.g., "ramburs" for COD, "shopify" for card)
    payment_gateway = conditions.get("payment_gateway")
    if payment_gateway:
        if not order.payment_gateway or payment_gateway.lower() not in order.payment_gateway.lower():
            return False

    # ─── Group 4: Location ─────────────────────────────────────
    shipping = order.shipping_address or {}

    city_contains = conditions.get("city_contains")
    if city_contains:
        city = (shipping.get("city") or "").lower()
        if city_contains.lower() not in city:
            return False

    county_contains = conditions.get("county_contains")
    if county_contains:
        province = (shipping.get("province") or shipping.get("county") or "").lower()
        if county_contains.lower() not in province:
            return False

    country_code = conditions.get("country_code")
    if country_code:
        order_country = (shipping.get("country_code") or shipping.get("country") or "").upper()
        if order_country != country_code.upper():
            return False

    # ─── Group 5: Price Range ──────────────────────────────────
    min_total_price = conditions.get("min_total_price")
    if min_total_price is not None and (order.total_price or 0) < float(min_total_price):
        return False

    max_total_price = conditions.get("max_total_price")
    if max_total_price is not None and (order.total_price or 0) > float(max_total_price):
        return False

    return True
