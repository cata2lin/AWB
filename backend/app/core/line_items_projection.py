"""
Shared server-side projection of the heavy ``orders.line_items`` JSON.

The raw ``line_items`` column averages ~1.9 kB/order — each item carries ~20 keys
(tax_lines, discount_allocations, tip_*, properties, …) that the P&L never reads.
The analytics endpoints only need ``{sku, quantity, price}`` per item. Projecting
the column to just those three fields in SQL shrinks the transferred payload ~19x
and cuts the cold full-table load of the P&L from ~16s to ~4s (and the delivered
fallback scan from ~12s to ~2s) — without instantiating full ORM objects.

Use it as a labelled column in a ``select(...)`` instead of ``select(Order)``:

    from app.core.line_items_projection import PROJECTED_LINE_ITEMS, sku_hash
    rows = (await db.execute(select(Order.store_uid, ..., PROJECTED_LINE_ITEMS)
                             .where(...))).all()
    for r in rows:
        for item in (r.li or []):
            sku = item["sku"]; qty = int(item["q"] or 1); price = item["p"] or 0

Each projected item is ``{"sku": str|None, "q": number, "p": number}``. NULL/empty
``line_items`` yield ``r.li is None`` (guard with ``r.li or []``).
"""

import hashlib
from typing import Optional

from sqlalchemy import literal_column

# Correlated scalar subquery — references the outer ``orders`` table, so it works
# in any ``select(...)`` whose FROM is the Order model (table ``orders``).
PROJECTED_LINE_ITEMS = literal_column(
    "(SELECT jsonb_agg(jsonb_build_object("
    "'sku', e->'inventory_item'->>'sku', 'q', e->'quantity', 'p', e->'price')) "
    "FROM jsonb_array_elements(orders.line_items::jsonb) e)"
).label("li")

# Same projection plus the product display name (``inventory_item.title_1``) for
# endpoints that show per-SKU names (sales-velocity, sku-risk). Item shape:
# ``{"sku": str|None, "q": number, "p": number, "name": str|None}``.
PROJECTED_LINE_ITEMS_NAMED = literal_column(
    "(SELECT jsonb_agg(jsonb_build_object("
    "'sku', e->'inventory_item'->>'sku', 'q', e->'quantity', 'p', e->'price', "
    "'name', e->'inventory_item'->>'title_1')) "
    "FROM jsonb_array_elements(orders.line_items::jsonb) e)"
).label("li")


def sku_hash(line_items) -> Optional[str]:
    """Deterministic md5 of an order's sorted SKU set (for transport-cost fallback).

    Shape-tolerant: accepts projected items (``{"sku": ...}``) and full Frisbo
    items (``{"inventory_item": {"sku": ...}}``). Returns None for an empty SKU set.
    """
    if not line_items or not isinstance(line_items, list):
        return None
    skus = []
    for item in line_items:
        if isinstance(item, dict):
            sku = item.get("sku")
            if not sku:
                inv = item.get("inventory_item", {})
                sku = inv.get("sku") if isinstance(inv, dict) else None
            if sku:
                skus.append(sku)
    if not skus:
        return None
    return hashlib.md5(",".join(sorted(skus)).encode("utf-8")).hexdigest()
