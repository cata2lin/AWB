"""
Smart sorting and default grouping logic for order batches.

Edit THIS file to change how orders are sorted within groups
or how unmatched orders are bucketed into default groups.
"""
from typing import List, Dict, Any, Optional
from collections import defaultdict

from app.services.rules.helpers import safe_dt, get_sku, extract_skus, get_line_item_count, _MAX_DT


# Sub-group visual config for item-count-based default groups
LINE_ITEM_GROUP_CONFIG = {
    1: {"name": "📦 Comenzi 1 articol", "color": "#22c55e"},    # green
    2: {"name": "📦📦 Comenzi 2 articole", "color": "#3b82f6"},  # blue
    3: {"name": "📦📦📦 Comenzi 3+ articole", "color": "#f59e0b"},  # amber
}


def build_default_groups(orders, sku_scope: str = "global") -> List[Dict[str, Any]]:
    """
    Split unmatched orders into sub-groups by lineItemCount,
    then smart-sort each sub-group.
    """
    # Bucket by item_count
    buckets: Dict[int, list] = defaultdict(list)
    for order in orders:
        k = get_line_item_count(order)
        buckets[k].append(order)

    result = []
    for k in sorted(buckets.keys()):
        cfg = LINE_ITEM_GROUP_CONFIG.get(k if k <= 2 else 3)
        # Build display name based on item count
        if k == 1:
            display_name = "📦 Comenzi 1 articol"
        else:
            display_name = f"📦 Comenzi {k} articole"
        color = cfg["color"] if cfg else "#f59e0b"

        sorted_orders = smart_sort_group(buckets[k], k, sku_scope)

        result.append({
            "name": display_name,
            "color": color,
            "rule_id": None,
            "k": k,
            "orders": sorted_orders,
        })

    return result


def smart_sort_orders(orders, sku_scope: str = "global"):
    """
    Smart-sort a list of orders: group by lineItemCount, sort within each group.
    Returns a flat sorted list.
    """
    if not orders:
        return orders

    # Bucket by lineItemCount
    buckets: Dict[int, list] = defaultdict(list)
    for order in orders:
        k = get_line_item_count(order)
        buckets[k].append(order)

    # Sort each bucket and flatten
    result = []
    for k in sorted(buckets.keys()):
        result.extend(smart_sort_group(buckets[k], k, sku_scope))

    return result


def smart_sort_group(orders, k: int, sku_scope: str = "global"):
    """
    Sort orders within a lineItemCount group Gk.

    k=1: sort by primarySkuFreq DESC → createdAt ASC → uid ASC
    k>1: sort by hasTopSku DESC → topSkuCount DESC → createdAt ASC → uid ASC
    """
    if not orders:
        return orders

    # Step 1: Compute SKU order frequency (presence-based) within this group
    sku_freq: Dict[str, int] = defaultdict(int)
    order_skus: Dict[str, set] = {}  # order uid → set of SKUs

    for order in orders:
        skus = extract_skus(order, sku_scope)
        order_skus[order.uid] = skus
        for sku in skus:
            sku_freq[sku] += 1

    if k == 1:
        return _sort_single_item_group(orders, order_skus, sku_freq)
    else:
        return _sort_multi_item_group(orders, order_skus, sku_freq, sku_scope)


def _sort_single_item_group(orders, order_skus, sku_freq):
    """
    k=1 special handling:
    Sort by primarySkuFreq DESC → createdAt ASC → uid ASC
    Clusters all orders of the most common single-SKU together.
    """
    def sort_key(order):
        skus = order_skus.get(order.uid, set())
        if not skus:
            # No SKU → sort last
            return (0, "", safe_dt(order), order.uid)

        primary_sku = next(iter(skus))
        freq = sku_freq.get(primary_sku, 0)
        # Negate freq for descending; cluster by SKU name; then by date/uid
        return (-freq, primary_sku.lower(), safe_dt(order), order.uid)

    return sorted(orders, key=sort_key)


def _sort_multi_item_group(orders, order_skus, sku_freq, sku_scope: str = "global"):
    """
    k>1 handling:
    1. Determine topSku (highest freq, deterministic tie-breaking)
    2. Sort by hasTopSku DESC → topSkuCount DESC → createdAt ASC → uid ASC
    """
    # Determine topSku with deterministic tie-breaking
    top_sku = _determine_top_sku(orders, order_skus, sku_freq)

    def sort_key(order):
        skus = order_skus.get(order.uid, set())
        has_top = 1 if top_sku and top_sku in skus else 0

        # Count how many line items have the topSku
        top_count = 0
        if top_sku:
            for item in (order.line_items or []):
                if get_sku(item) == top_sku:
                    top_count += 1

        # Determine a dominant SKU for secondary clustering
        # (most frequent SKU in this order within the group)
        dominant_sku = ""
        dom_freq = 0
        if skus:
            dominant_sku = min(skus, key=lambda s: (-sku_freq.get(s, 0), s.lower()))
            dom_freq = sku_freq.get(dominant_sku, 0)

        # has_top DESC, top_count DESC, dom_freq DESC, cluster by SKU name, createdAt, uid
        return (-has_top, -top_count, -dom_freq, dominant_sku.lower(), safe_dt(order), order.uid)

    return sorted(orders, key=sort_key)


def _determine_top_sku(orders, order_skus, sku_freq) -> Optional[str]:
    """
    Determine the topSku for a group: highest frequency, with tie-breaking:
    1. Earliest createdAt of any order containing the SKU
    2. Lexicographically smallest SKU
    """
    if not sku_freq:
        return None

    max_freq = max(sku_freq.values())
    candidates = [sku for sku, freq in sku_freq.items() if freq == max_freq]

    if len(candidates) == 1:
        return candidates[0]

    # Tie-breaking: earliest order containing the SKU
    sku_earliest: Dict[str, Any] = {}
    for order in orders:
        dt = safe_dt(order)
        for sku in order_skus.get(order.uid, set()):
            if sku in candidates:
                if sku not in sku_earliest or dt < sku_earliest[sku]:
                    sku_earliest[sku] = dt

    # Sort candidates by (earliest_dt, sku_name)
    candidates.sort(key=lambda s: (sku_earliest.get(s, _MAX_DT), s.lower()))

    return candidates[0]
