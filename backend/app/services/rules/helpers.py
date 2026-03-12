"""
SKU extraction and date utilities shared across the rules package.
"""
from datetime import datetime
from typing import Optional


# Sentinel for missing dates (sorts to end)
_MAX_DT = datetime(9999, 12, 31)


def safe_dt(order) -> datetime:
    """Get the order's createdAt datetime, with a safe fallback."""
    return order.frisbo_created_at or order.synced_at or _MAX_DT


def get_sku(item: dict) -> Optional[str]:
    """
    Extract SKU from a line item dict.
    Handles both flat and nested Frisbo structures:
    - item["sku"]
    - item["inventory_item"]["sku"]
    """
    sku = item.get("sku")
    if sku:
        return sku
    inv = item.get("inventory_item")
    if inv and isinstance(inv, dict):
        return inv.get("sku")
    return None


def extract_skus(order, sku_scope: str = "global") -> set:
    """Extract all unique SKUs from an order's line items."""
    skus = set()
    for item in (order.line_items or []):
        sku = get_sku(item)
        if sku:
            if sku_scope == "storeScoped":
                sku = f"{order.store_uid}::{sku}"
            skus.add(sku)
    return skus


def get_line_item_count(order) -> int:
    """Get the total item count for grouping (matches what user sees in UI)."""
    # Use item_count (total quantity) which matches the "X items" UI label
    if order.item_count and order.item_count > 0:
        return order.item_count
    # Fallback: sum quantities from line_items
    items = order.line_items or []
    total = sum(item.get("quantity", 1) for item in items)
    return max(total, 1)
