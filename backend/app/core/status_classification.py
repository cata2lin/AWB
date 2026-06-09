"""
Canonical order-status classification — the single source of truth.

Every analytics report (deliverability, profitability, per-order profitability,
SKU profitability, product deliverability) MUST derive its delivered / returned /
cancelled / in_transit / other category from THIS module, so the reports can never
disagree on what a given Frisbo `aggregated_status` means.

History: this logic was previously copy-pasted (and had drifted) across
analytics/profitability.py, analytics/profitability_orders.py and
sku_profitability/endpoint.py. The canonical 5-category mapping below is the one
that lived in analytics/profitability.py (verified against
docs/PNL_KNOWLEDGE.md and deliverability_calculation_reference.md), with
`refused` / `unsuccessful_delivery` correctly folded into `returned`
(they are parcels that physically came back — a transport loss, not `other`).

Two layers are exposed:
  • Granular display buckets (DELIVERED, RETURNED, REFUSED, IN_TRANSIT,
    OUT_FOR_DELIVERY, …) — used by the deliverability tab which shows finer columns.
  • The 5-category `classify()` (delivered / returned / cancelled / in_transit /
    other) — used by every P&L / profit calculation.

`classify()`'s `returned` == granular RETURNED ∪ REFUSED, and `in_transit` ==
granular IN_TRANSIT ∪ OUT_FOR_DELIVERY, so the financial "shipped" set
(delivered ∪ returned ∪ in_transit) is identical to the deliverability tab's
`shipped = delivered + in_transit + out_for_delivery + returned + refused`.
"""

# ── Granular display buckets (match the deliverability tab's columns) ─────────
# Covers the FULL Frisbo OrderAggregatedStatusOption enum (53 values) so no real
# status silently falls through to "other". See ~/.claude/skills/frisbo-api.
DELIVERED = {"delivered", "customer_pickup", "personal_pickup", "in_parcel_locker"}
RETURNED = {
    "back_to_sender",
    "returned",
    "returning_to_sender",
    "received_by_sender",
    "incorrect_address",
    "lost",
    "lost_in_transit",
    "lost_in_warehouse",
    "shipment_refunded",
}
REFUSED = {"refused", "unsuccessful_delivery"}
CANCELLED = {"cancelled", "voided", "shipping_canceled", "fulfillment_cancelled"}
IN_TRANSIT = {
    "in_transit",
    "redirected",
    "deferred_delivery",
    "on_hold",
    "sending",
}
OUT_FOR_DELIVERY = {"out_for_delivery"}
# Genuinely not-shipped / pre-expedition statuses -> category "other".
# `fulfilled` lives here (NOT in_transit): verified against live prod data —
# all `fulfilled` orders have shipment_status='not_created' and most have no AWB,
# so the warehouse marked them fulfilled but no shipment was ever dispatched
# (matches DB_Reference.md "Not shipped" and Scripturi's "Netrimisa").
# `errors_incorrect_shipping_address` and `awaiting_shipment_generation_initialization`
# are likewise pre-shipment (not_created, 0 AWBs in prod) — added so they stop
# silently falling through `classify()` to "other".
NOT_SHIPPED = {
    "processing",
    "not_fulfilled",
    "fulfilled",
    "ready_for_pickup",
    "new",
    "waiting_for_courier",
    "waiting_for_pickup",
    "in_picking",
    "pending_fulfillment",
    "out_of_stock",
    "not_generated",
    "generating_awb",
    "generated_awb",
    "errors_incorrect_shipping_address",
    "awaiting_shipment_generation_initialization",
}

# ── 5-category mapping (the financial categories) ─────────────────────────────
# Ordered so callers can also build SQL CASE expressions from the same source.
CATEGORY_STATUS_LISTS = {
    "delivered": sorted(DELIVERED),
    "returned": sorted(RETURNED | REFUSED),  # refused parcels also came back
    "cancelled": sorted(CANCELLED),
    "in_transit": sorted(IN_TRANSIT | OUT_FOR_DELIVERY),
}

_LOOKUP = {}
for _cat, _statuses in CATEGORY_STATUS_LISTS.items():
    for _s in _statuses:
        _LOOKUP[_s] = _cat


def classify(aggregated_status) -> str:
    """Map a Frisbo `aggregated_status` to one of:
    delivered / returned / cancelled / in_transit / other.

    Case-insensitive; None/unknown -> "other".
    """
    if not aggregated_status:
        return "other"
    return _LOOKUP.get(str(aggregated_status).strip().lower(), "other")


# Categories whose parcels physically left the warehouse (the "shipped" set).
SHIPPED_CATEGORIES = ("delivered", "returned", "in_transit")


def is_shipped(aggregated_status) -> bool:
    """True if the order physically left the warehouse (delivered, in transit, or
    came back as returned/refused). Cancelled and not-shipped are excluded —
    matching deliverability_calculation_reference.md section 4."""
    return classify(aggregated_status) in SHIPPED_CATEGORIES
