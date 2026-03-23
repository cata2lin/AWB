"""
Frisbo product parser — transforms raw Frisbo inventory item JSON into internal format.

Edit THIS file to change how product data is mapped from the Frisbo API.
"""
from typing import Optional, Dict
from datetime import datetime


def parse_product(raw_item: Dict) -> Dict:
    """
    Parse raw Frisbo inventory item into internal format.
    
    Frisbo inventory_item structure:
    - uid: unique product ID
    - organization_uid: organization ID
    - external_identifier: external selling channel product ID
    - title_1: product name
    - title_2: variant name
    - state: active/draft/archived/deleted/replaced
    - weight/height/width/length: dimensions
    - codes: [{key: "sku", value: "..."}, {key: "barcode", value: "..."}, ...]
    - images: [{src: "url", position: 0}, ...]
    - selling_channels_store_uids: [store_uid_1, ...]
    - aggregated_inventory_levels:
        - all: {available, committed, incoming}
        - frisbo: {available, committed, incoming}
        - other: {available, committed, incoming}
    - requires_shipping, quantity_tracked, managed_by, selling_policy
    - created_at, updated_at
    """
    parsed = {
        "uid": raw_item.get("uid"),
        "organization_uid": raw_item.get("organization_uid"),
        "external_identifier": raw_item.get("external_identifier"),
        "title_1": raw_item.get("title_1"),
        "title_2": raw_item.get("title_2"),
        "state": raw_item.get("state"),  # None if not provided by Frisbo
    }
    
    # Extract dimensions
    parsed["weight"] = raw_item.get("weight")
    parsed["height"] = raw_item.get("height")
    parsed["width"] = raw_item.get("width")
    parsed["length"] = raw_item.get("length")
    
    # Extract codes (SKU, barcode, HS code) from the codes array
    codes = raw_item.get("codes", []) or []
    sku = None
    barcode = None
    hs_code = None
    
    for code in codes:
        if not isinstance(code, dict):
            continue
        key = code.get("key", "").lower()
        value = code.get("value")
        if key == "sku":
            sku = value
        elif key == "barcode":
            barcode = value
        elif key == "hs_code":
            hs_code = value
    
    parsed["sku"] = sku
    parsed["barcode"] = barcode
    parsed["hs_code"] = hs_code
    
    # Flags
    parsed["requires_shipping"] = raw_item.get("requires_shipping", True)
    parsed["quantity_tracked"] = raw_item.get("quantity_tracked", True)
    parsed["managed_by"] = raw_item.get("managed_by")
    parsed["selling_policy"] = raw_item.get("selling_policy")
    
    # Images
    images = raw_item.get("images", []) or []
    parsed["images"] = [
        {"src": img.get("src"), "position": img.get("position", 0)}
        for img in images
        if isinstance(img, dict) and img.get("src")
    ] if images else []
    
    # Store associations
    parsed["store_uids"] = raw_item.get("selling_channels_store_uids", []) or []
    
    # Stock levels from aggregated_inventory_levels
    agg_levels = raw_item.get("aggregated_inventory_levels", {}) or {}
    
    all_levels = agg_levels.get("all", {}) or {}
    frisbo_levels = agg_levels.get("frisbo", {}) or {}
    other_levels = agg_levels.get("other", {}) or {}
    
    parsed["stock_available"] = _safe_int(all_levels.get("available"))
    parsed["stock_committed"] = _safe_int(all_levels.get("committed"))
    parsed["stock_incoming"] = _safe_int(all_levels.get("incoming"))
    parsed["stock_frisbo_available"] = _safe_int(frisbo_levels.get("available"))
    parsed["stock_other_available"] = _safe_int(other_levels.get("available"))
    
    # Timestamps
    parsed["frisbo_created_at"] = _parse_datetime(raw_item.get("created_at"))
    parsed["frisbo_updated_at"] = _parse_datetime(raw_item.get("updated_at"))
    
    return parsed


def _safe_int(val) -> int:
    """Safely convert to int, defaulting to 0."""
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _parse_datetime(dt_string: Optional[str]) -> Optional[datetime]:
    """Parse ISO datetime string."""
    if not dt_string:
        return None
    try:
        if "Z" in dt_string:
            dt_string = dt_string.replace("Z", "+00:00")
        return datetime.fromisoformat(dt_string)
    except (ValueError, TypeError):
        return None
