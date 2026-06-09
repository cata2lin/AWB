"""
Unit tests for the shared order-status classifier.

These run WITHOUT a database — they validate the single source of truth that
the deliverability, profitability, per-order, SKU-profitability and product-
deliverability reports all now consume (audit Findings B/F/J/K).
"""

import pytest

from app.core.status_classification import (
    classify,
    is_shipped,
    CATEGORY_STATUS_LISTS,
    DELIVERED,
    RETURNED,
    REFUSED,
    CANCELLED,
    IN_TRANSIT,
    OUT_FOR_DELIVERY,
    NOT_SHIPPED,
)

# Every distinct Frisbo aggregated_status seen in production (per
# deliverability_calculation_reference.md, section 2a) -> expected category.
EXPECTED = {
    "delivered": "delivered",
    "customer_pickup": "delivered",
    "in_parcel_locker": "delivered",
    "back_to_sender": "returned",
    "returning_to_sender": "returned",
    "incorrect_address": "returned",
    "lost": "returned",
    "refused": "returned",  # Finding B: was falling to "other"
    "unsuccessful_delivery": "returned",  # Finding B
    "cancelled": "cancelled",
    "voided": "cancelled",
    "in_transit": "in_transit",
    "out_for_delivery": "in_transit",
    "redirected": "in_transit",
    "deferred_delivery": "in_transit",
    "on_hold": "in_transit",
    # not-shipped / pre-expedition -> other
    "waiting_for_courier": "other",
    "not_fulfilled": "other",
    "processing": "other",
    "ready_for_pickup": "other",
    "new": "other",
    # Newer/rarer Frisbo aggregated statuses (full 53-value enum)
    "personal_pickup": "delivered",
    "received_by_sender": "returned",
    "lost_in_transit": "returned",
    "lost_in_warehouse": "returned",
    "shipment_refunded": "returned",
    "shipping_canceled": "cancelled",
    "fulfillment_cancelled": "cancelled",
    "sending": "in_transit",
    "waiting_for_pickup": "other",
    "in_picking": "other",
    "generated_awb": "other",
    "not_generated": "other",
    # `fulfilled` is NOT shipped — verified against live prod (shipment not_created,
    # most without an AWB); was wrongly mapped to in_transit before.
    "fulfilled": "other",
    # Real prod statuses that previously fell through to "other" implicitly; now explicit.
    "errors_incorrect_shipping_address": "other",
    "awaiting_shipment_generation_initialization": "other",
}


@pytest.mark.parametrize("status,expected", EXPECTED.items())
def test_classify_known_statuses(status, expected):
    assert classify(status) == expected


def test_refused_is_returned_not_other():
    """Finding B regression: a refused parcel must classify as 'returned' so the
    P&L books its transport loss instead of silently dropping it into 'other'."""
    assert classify("refused") == "returned"
    assert classify("unsuccessful_delivery") == "returned"


def test_classify_is_case_insensitive_and_null_safe():
    assert classify("DELIVERED") == "delivered"
    assert classify("  Back_To_Sender  ") == "returned"
    assert classify(None) == "other"
    assert classify("") == "other"
    assert classify("some_unknown_status") == "other"


def test_shipped_set_matches_deliverability_spec():
    """`is_shipped` must equal delivered + in_transit + out_for_delivery +
    returned + refused (deliverability_calculation_reference.md section 4) —
    i.e. everything that left the warehouse, excluding cancelled and not-shipped."""
    shipped = DELIVERED | IN_TRANSIT | OUT_FOR_DELIVERY | RETURNED | REFUSED
    for s in shipped:
        assert is_shipped(s), f"{s} should be shipped"
    for s in CANCELLED | NOT_SHIPPED:
        assert not is_shipped(s), f"{s} should NOT be shipped"


def test_category_lists_cover_granular_sets_without_overlap():
    """The 5-category lists must partition the granular buckets exactly:
    returned == RETURNED ∪ REFUSED and in_transit == IN_TRANSIT ∪ OUT_FOR_DELIVERY."""
    assert set(CATEGORY_STATUS_LISTS["delivered"]) == DELIVERED
    assert set(CATEGORY_STATUS_LISTS["returned"]) == RETURNED | REFUSED
    assert set(CATEGORY_STATUS_LISTS["cancelled"]) == CANCELLED
    assert set(CATEGORY_STATUS_LISTS["in_transit"]) == IN_TRANSIT | OUT_FOR_DELIVERY

    # No status appears in two categories.
    seen = {}
    for cat, statuses in CATEGORY_STATUS_LISTS.items():
        for s in statuses:
            assert s not in seen, f"{s} double-mapped to {seen.get(s)} and {cat}"
            seen[s] = cat


def test_every_lookup_status_roundtrips():
    """Every status in the category lists classifies back to that category."""
    for cat, statuses in CATEGORY_STATUS_LISTS.items():
        for s in statuses:
            assert classify(s) == cat
