"""Unit tests for the configurable order-exclusion helpers (sync parts).

Covers the always-on built-in tags (test/sample — Finding G/V + the 'sample'
addition) and the SKU whole-order exclusion (Scripturi rule_type='sku' parity).
The async DB-backed loaders are exercised by the smoke suite, not here.
"""

from app.core.order_filters import (
    DEFAULT_EXCLUDED_TAGS,
    is_test_order,
    order_has_excluded_sku,
)


def test_builtin_excluded_tags_include_test_and_sample():
    assert "test" in DEFAULT_EXCLUDED_TAGS
    assert "sample" in DEFAULT_EXCLUDED_TAGS


def test_is_test_order_matches_builtins_case_insensitively():
    assert is_test_order(["TEST"]) is True
    assert is_test_order(["Sample", "vip"]) is True
    assert is_test_order(["vip", "wholesale"]) is False
    assert is_test_order([]) is False
    assert is_test_order(None) is False


def test_is_test_order_honours_custom_excluded_set():
    assert is_test_order(["wholesale"], excluded_tags=("wholesale",)) is True
    assert is_test_order(["test"], excluded_tags=("wholesale",)) is False


def test_order_has_excluded_sku():
    line_items = [
        {"inventory_item": {"sku": "ABC-123"}, "quantity": 1},
        {"inventory_item": {"sku": "XYZ-9"}, "quantity": 2},
    ]
    assert order_has_excluded_sku(line_items, ["xyz-9"]) is True  # case-insensitive
    assert order_has_excluded_sku(line_items, ["ABC-123"]) is True
    assert order_has_excluded_sku(line_items, ["nope"]) is False
    assert order_has_excluded_sku(line_items, []) is False
    assert order_has_excluded_sku(None, ["abc-123"]) is False
    # malformed line items must never raise
    assert (
        order_has_excluded_sku([None, {"x": 1}, {"inventory_item": None}], ["a"])
        is False
    )
