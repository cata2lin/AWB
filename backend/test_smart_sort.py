"""
Unit tests for the Smart AWB Batch Sorting algorithm.

Reference data from the spec:
  o1:[1], o2:[1,2], o3:[2], o4:[1,3], o5:[3], o6:[1], o7:[1,5], o8:[2], o9:[1], o10:[3,4]
  Expected order: o1, o6, o9, o3, o8, o5, o2, o4, o7, o10

  Breakdown:
    k=1 group (5 orders): o1:[1], o3:[2], o5:[3], o6:[1], o8:[2], o9:[1]
      SKU freqs: 1→3, 2→2, 3→1
      Sort by primarySkuFreq DESC → createdAt ASC:
        o1(sku=1,freq=3), o6(sku=1,freq=3), o9(sku=1,freq=3),
        o3(sku=2,freq=2), o8(sku=2,freq=2),
        o5(sku=3,freq=1)

    k=2 group (4 orders): o2:[1,2], o4:[1,3], o7:[1,5], o10:[3,4]
      SKU freqs: 1→3, 2→1, 3→2, 4→1, 5→1
      topSku = 1 (freq=3)
      Sort by hasTopSku DESC → topSkuCount DESC → createdAt ASC:
        o2(has1,created=2nd), o4(has1,created=4th), o7(has1,created=7th),
        o10(no1,created=10th)
"""
import sys
import os
from datetime import datetime, timedelta

# Add the backend directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from app.services.rules_engine import RulesEngine


class MockOrder:
    """Minimal Order mock for testing."""
    def __init__(self, uid, line_items, created_at=None, store_uid="store_1",
                 unique_sku_count=None, item_count=None):
        self.uid = uid
        self.line_items = [{"sku": sku, "quantity": 1} for sku in line_items]
        self.store_uid = store_uid
        self.frisbo_created_at = created_at
        self.synced_at = created_at or datetime(2024, 1, 1)
        
        # Compute unique_sku_count from line_items
        unique_skus = set(line_items)
        self.unique_sku_count = unique_sku_count or len(unique_skus)
        self.item_count = item_count or len(line_items)
        
        # Fields used by _matches_rule
        self.courier_name = None
        self.order_number = uid
        self.customer_name = f"Customer {uid}"


def make_orders_from_spec():
    """
    Build the 10 reference orders from the spec.
    o1:[1], o2:[1,2], o3:[2], o4:[1,3], o5:[3], o6:[1], o7:[1,5], o8:[2], o9:[1], o10:[3,4]
    """
    base = datetime(2024, 1, 1, 12, 0, 0)
    orders = [
        MockOrder("o1",  ["1"],      base + timedelta(minutes=1)),
        MockOrder("o2",  ["1", "2"], base + timedelta(minutes=2)),
        MockOrder("o3",  ["2"],      base + timedelta(minutes=3)),
        MockOrder("o4",  ["1", "3"], base + timedelta(minutes=4)),
        MockOrder("o5",  ["3"],      base + timedelta(minutes=5)),
        MockOrder("o6",  ["1"],      base + timedelta(minutes=6)),
        MockOrder("o7",  ["1", "5"], base + timedelta(minutes=7)),
        MockOrder("o8",  ["2"],      base + timedelta(minutes=8)),
        MockOrder("o9",  ["1"],      base + timedelta(minutes=9)),
        MockOrder("o10", ["3", "4"], base + timedelta(minutes=10)),
    ]
    return orders


def test_smart_sort_reference_data():
    """Test with the spec's reference data. Expected: o1,o6,o9,o3,o8,o5,o2,o4,o7,o10"""
    orders = make_orders_from_spec()
    engine = RulesEngine(rules=[])  # No rules → all orders smart-sorted

    groups = engine.group_orders(orders)

    # Should have 2 groups: k=1 (6 orders) and k=2 (4 orders)
    assert len(groups) == 2, f"Expected 2 groups, got {len(groups)}"
    
    # Group 1: k=1
    g1 = groups[0]
    assert g1["rule_id"] is None
    g1_uids = [o.uid for o in g1["orders"]]
    expected_k1 = ["o1", "o6", "o9", "o3", "o8", "o5"]
    assert g1_uids == expected_k1, f"k=1 group: expected {expected_k1}, got {g1_uids}"

    # Group 2: k=2
    g2 = groups[1]
    g2_uids = [o.uid for o in g2["orders"]]
    expected_k2 = ["o2", "o4", "o7", "o10"]
    assert g2_uids == expected_k2, f"k=2 group: expected {expected_k2}, got {g2_uids}"

    # Flat sequence
    all_uids = g1_uids + g2_uids
    expected_flat = ["o1", "o6", "o9", "o3", "o8", "o5", "o2", "o4", "o7", "o10"]
    assert all_uids == expected_flat, f"Full sequence: expected {expected_flat}, got {all_uids}"

    print("✅ Reference data test PASSED")
    print(f"   k=1 group: {g1_uids}")
    print(f"   k=2 group: {g2_uids}")


def test_all_single_item():
    """All orders have 1 item — should be one group sorted by SKU frequency."""
    base = datetime(2024, 1, 1)
    orders = [
        MockOrder("a", ["X"], base + timedelta(minutes=1)),
        MockOrder("b", ["Y"], base + timedelta(minutes=2)),
        MockOrder("c", ["X"], base + timedelta(minutes=3)),
        MockOrder("d", ["Z"], base + timedelta(minutes=4)),
        MockOrder("e", ["X"], base + timedelta(minutes=5)),
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    assert len(groups) == 1
    uids = [o.uid for o in groups[0]["orders"]]
    # X has freq 3, Y has freq 1, Z has freq 1
    # Expected: a,c,e (X, oldest first), then b (Y), then d (Z)
    assert uids == ["a", "c", "e", "b", "d"], f"Got {uids}"
    print("✅ All single-item test PASSED")


def test_empty_orders():
    """No orders → empty groups."""
    engine = RulesEngine(rules=[])
    groups = engine.group_orders([])
    assert groups == []
    print("✅ Empty orders test PASSED")


def test_no_sku():
    """Orders with no SKU should sort last."""
    base = datetime(2024, 1, 1)
    orders = [
        MockOrder("a", ["X"], base + timedelta(minutes=1)),
        MockOrder("b", [], base + timedelta(minutes=2), unique_sku_count=1),
        MockOrder("c", ["X"], base + timedelta(minutes=3)),
    ]
    # Give order "b" empty line_items
    orders[1].line_items = []
    
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    uids = [o.uid for o in groups[0]["orders"]]
    # X has freq 2 → a, c first, then b (no SKU → last)
    assert uids == ["a", "c", "b"], f"Got {uids}"
    print("✅ No-SKU test PASSED")


def test_tie_breaking_top_sku():
    """When multiple SKUs tie for highest frequency, pick earliest createdAt then lexicographic."""
    base = datetime(2024, 1, 1)
    orders = [
        # k=2 group: SKU A appears in 2 orders, SKU B appears in 2 orders
        MockOrder("o1", ["A", "C"], base + timedelta(minutes=1)),  # A first seen at t=1
        MockOrder("o2", ["B", "C"], base + timedelta(minutes=2)),  # B first seen at t=2
        MockOrder("o3", ["A", "D"], base + timedelta(minutes=3)),
        MockOrder("o4", ["B", "D"], base + timedelta(minutes=4)),
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    # A and B both have freq=2, C has freq=2, D has freq=2
    # Tie-break: A earliest at t=1, so topSku=A (or C also at t=1 — A < C lexicographically)
    # Actually: A freq=2 (o1,o3), B freq=2 (o2,o4), C freq=2 (o1,o2), D freq=2 (o3,o4)
    # Earliest: A@t=1, C@t=1 → tie → lexicographic: A < C → topSku = A
    g = groups[0]
    uids = [o.uid for o in g["orders"]]
    # hasA: o1(t=1), o3(t=3) → first; no A: o2(t=2), o4(t=4)
    assert uids == ["o1", "o3", "o2", "o4"], f"Got {uids}"
    print("✅ Tie-breaking test PASSED")


def test_store_scoped():
    """storeScoped mode treats same SKU from different stores as different."""
    base = datetime(2024, 1, 1)
    orders = [
        MockOrder("a", ["X"], base + timedelta(minutes=1), store_uid="S1"),
        MockOrder("b", ["X"], base + timedelta(minutes=2), store_uid="S2"),
        MockOrder("c", ["X"], base + timedelta(minutes=3), store_uid="S1"),
    ]
    engine = RulesEngine(rules=[], sku_scope="storeScoped")
    groups = engine.group_orders(orders)

    # S1::X has freq 2, S2::X has freq 1
    # Expected: a(S1::X), c(S1::X), b(S2::X)
    uids = [o.uid for o in groups[0]["orders"]]
    assert uids == ["a", "c", "b"], f"Got {uids}"
    print("✅ Store-scoped test PASSED")


def test_mixed_k_values():
    """Orders with k=1,2,3 should produce 3 sub-groups."""
    base = datetime(2024, 1, 1)
    orders = [
        MockOrder("a", ["X"], base),
        MockOrder("b", ["X", "Y"], base + timedelta(minutes=1)),
        MockOrder("c", ["X", "Y", "Z"], base + timedelta(minutes=2)),
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    assert len(groups) == 3, f"Expected 3 groups, got {len(groups)}"
    assert len(groups[0]["orders"]) == 1  # k=1
    assert len(groups[1]["orders"]) == 1  # k=2
    assert len(groups[2]["orders"]) == 1  # k=3
    print("✅ Mixed k-values test PASSED")


if __name__ == "__main__":
    print("=" * 60)
    print("Smart Sort Algorithm — Unit Tests")
    print("=" * 60)
    
    test_smart_sort_reference_data()
    test_all_single_item()
    test_empty_orders()
    test_no_sku()
    test_tie_breaking_top_sku()
    test_store_scoped()
    test_mixed_k_values()
    
    print()
    print("=" * 60)
    print("ALL TESTS PASSED ✅")
    print("=" * 60)
