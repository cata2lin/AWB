"""
Shared product grouping utilities — primary listing selection logic.

Used by products.py, sales_velocity/endpoint.py, and purchase_orders.py
to ensure consistent primary listing selection across all views.
"""
import json
import logging
from typing import List, Set, Optional

logger = logging.getLogger(__name__)

# International store name patterns (non-Romanian)
INTL_STORE_PATTERNS = frozenset(['.cz', '.pl', '.bg', '.hu'])


def classify_stores(store_list) -> tuple:
    """
    Classify stores into Romanian UIDs and International UIDs.

    Args:
        store_list: List of (uid, name) tuples from the stores table.

    Returns:
        (ro_uids: set, intl_uids: set)
    """
    ro_uids = set()
    intl_uids = set()
    for uid, name in store_list:
        name_lower = (name or '').lower()
        if any(p in name_lower for p in INTL_STORE_PATTERNS):
            intl_uids.add(uid)
        elif '.ro' in name_lower:
            ro_uids.add(uid)
    return ro_uids, intl_uids


def _product_has_image(product) -> bool:
    """Check if a product ORM object has at least one image with a src."""
    imgs = product.images
    if not imgs:
        return False
    if isinstance(imgs, str):
        try:
            imgs = json.loads(imgs)
        except (json.JSONDecodeError, TypeError):
            return False
    if isinstance(imgs, list) and len(imgs) > 0:
        first = imgs[0]
        if isinstance(first, dict):
            return bool(first.get('src', '').strip())
        return bool(str(first).strip())
    return False


def _product_store_uids(product) -> list:
    """Extract store UIDs from a product ORM object."""
    uids = product.store_uids
    if not uids:
        return []
    if isinstance(uids, str):
        try:
            return json.loads(uids)
        except (json.JSONDecodeError, TypeError):
            return []
    return uids if isinstance(uids, list) else []


def pick_best_primary(
    group: list,
    ro_store_uids: Set[str],
    intl_store_uids: Set[str],
    uid_to_product: Optional[dict] = None,
) -> tuple:
    """
    Pick the best primary listing from a product group.

    Priority order:
        1. User-set primary (primary_listing_uid) — always wins
        2. Romanian store + has image
        3. Romanian store + no image (at least correct language)
        4. Any store + has image
        5. Fallback: first in group (most recently synced)

    Args:
        group: List of Product ORM objects, pre-sorted by synced_at DESC.
        ro_store_uids: Set of store UIDs classified as Romanian.
        intl_store_uids: Set of store UIDs classified as International.
        uid_to_product: Optional mapping of uid -> Product for primary lookup.

    Returns:
        (primary_product, has_explicit_primary: bool)
    """
    if not group:
        return None, False

    # 1. Check for user-set primary
    for p in group:
        if p.primary_listing_uid:
            # Try to find the target in the group first
            for q in group:
                if q.uid == p.primary_listing_uid:
                    return q, True
            # Try global lookup
            if uid_to_product and p.primary_listing_uid in uid_to_product:
                return uid_to_product[p.primary_listing_uid], True
            break  # primary_listing_uid set but target not found, fall through

    # 2. Score each product: (is_ro, has_image) -> priority
    def _score(p):
        suids = _product_store_uids(p)
        is_ro = any(uid in ro_store_uids for uid in suids)
        is_intl = any(uid in intl_store_uids for uid in suids)
        has_img = _product_has_image(p)

        if is_ro and has_img:
            return 0  # Best: Romanian + image
        if is_ro and not has_img:
            return 1  # OK: Romanian, no image
        if not is_intl and has_img:
            return 2  # Neutral store with image
        if has_img:
            return 3  # International but has image
        if not is_intl:
            return 4  # Neutral store, no image
        return 5      # Worst: international, no image

    scored = sorted(group, key=_score)
    return scored[0], False
