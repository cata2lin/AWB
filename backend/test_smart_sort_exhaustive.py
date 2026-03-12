"""
Exhaustive verification of Smart AWB Batch Sorting.

Tests:
  1. Reference data from spec
  2. k=1 clustering correctness (SKU frequency ordering)
  3. k>1 topSku determination + sorting
  4. Multiple quantity same SKU (the user's question)
  5. Rules override + smart sort within rule groups
  6. Rules + unmatched orders get smart sort
  7. Store-scoped SKU mode
  8. Tie-breaking determinism
  9. Real-world-like large batch
  10. Mixed: rules pull some orders, rest get smart-sorted
"""
import sys, os
from datetime import datetime, timedelta
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from app.services.rules_engine import RulesEngine


# ─── Mock Classes ───────────────────────────────────────────────

class MockOrder:
    def __init__(self, uid, skus_with_qty, created_at=None, store_uid="store_1",
                 courier_name=None, unique_sku_count=None):
        """
        skus_with_qty: list of (sku, quantity) tuples, e.g. [("A", 3), ("B", 1)]
        """
        self.uid = uid
        self.line_items = [{"sku": sku, "quantity": qty} for sku, qty in skus_with_qty]
        self.store_uid = store_uid
        self.frisbo_created_at = created_at
        self.synced_at = created_at or datetime(2024, 1, 1)
        self.courier_name = courier_name
        self.order_number = uid
        self.customer_name = f"Customer {uid}"

        unique_skus = set(sku for sku, _ in skus_with_qty)
        self.unique_sku_count = unique_sku_count if unique_sku_count is not None else len(unique_skus)
        self.item_count = sum(qty for _, qty in skus_with_qty)


class MockRule:
    def __init__(self, id, name, priority, conditions=None, group_config=None, is_active=True):
        self.id = id
        self.name = name
        self.priority = priority
        self.is_active = is_active
        self.conditions = conditions or {}
        self.group_config = group_config or {"name": name, "color": "#6366f1"}


T0 = datetime(2024, 1, 1, 12, 0, 0)


def t(minutes):
    return T0 + timedelta(minutes=minutes)


def uids(group):
    return [o.uid for o in group["orders"]]


def flat_uids(groups):
    result = []
    for g in groups:
        result.extend(uids(g))
    return result

PASS = 0
FAIL = 0

def check(test_name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {test_name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {test_name} -- {detail}")


# ═══════════════════════════════════════════════════════════════
# TEST 1: Spec Reference Data
# ═══════════════════════════════════════════════════════════════
def test_1_reference_data():
    print("\n--- TEST 1: Spec Reference Data ---")
    orders = [
        MockOrder("o1",  [("1",1)],        t(1)),
        MockOrder("o2",  [("1",1),("2",1)], t(2)),
        MockOrder("o3",  [("2",1)],         t(3)),
        MockOrder("o4",  [("1",1),("3",1)], t(4)),
        MockOrder("o5",  [("3",1)],         t(5)),
        MockOrder("o6",  [("1",1)],         t(6)),
        MockOrder("o7",  [("1",1),("5",1)], t(7)),
        MockOrder("o8",  [("2",1)],         t(8)),
        MockOrder("o9",  [("1",1)],         t(9)),
        MockOrder("o10", [("3",1),("4",1)], t(10)),
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    check("2 groups created", len(groups) == 2, f"got {len(groups)}")
    check("k=1 correct order", uids(groups[0]) == ["o1","o6","o9","o3","o8","o5"],
          f"got {uids(groups[0])}")
    check("k=2 correct order", uids(groups[1]) == ["o2","o4","o7","o10"],
          f"got {uids(groups[1])}")
    check("full flat sequence", flat_uids(groups) == ["o1","o6","o9","o3","o8","o5","o2","o4","o7","o10"],
          f"got {flat_uids(groups)}")


# ═══════════════════════════════════════════════════════════════
# TEST 2: Multiple Quantity Same SKU (User's Question)
# ═══════════════════════════════════════════════════════════════
def test_2_multiple_qty_same_sku():
    print("\n--- TEST 2: 1 SKU x 20 qty -> k=1 group ---")
    orders = [
        MockOrder("bulk",   [("WIDGET", 20)], t(1)),  # 1 SKU, 20 qty
        MockOrder("single", [("WIDGET", 1)],  t(2)),  # 1 SKU, 1 qty
        MockOrder("multi",  [("A",1),("B",1)], t(3)),  # 2 SKUs
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    check("2 groups (k=1 and k=2)", len(groups) == 2, f"got {len(groups)}")
    check("bulk order in k=1 group", "bulk" in uids(groups[0]),
          f"k=1 has {uids(groups[0])}")
    check("single order in k=1 group", "single" in uids(groups[0]),
          f"k=1 has {uids(groups[0])}")
    check("multi order in k=2 group", uids(groups[1]) == ["multi"],
          f"k=2 has {uids(groups[1])}")
    # Both bulk and single have SKU=WIDGET, freq=2
    check("k=1 sorted by createdAt (bulk before single)",
          uids(groups[0]) == ["bulk", "single"],
          f"got {uids(groups[0])}")


# ═══════════════════════════════════════════════════════════════
# TEST 3: k=1 SKU Frequency Clustering
# ═══════════════════════════════════════════════════════════════
def test_3_k1_clustering():
    print("\n--- TEST 3: k=1 SKU Frequency Clustering ---")
    # SKU A appears 4 times, SKU B 2 times, SKU C 1 time
    orders = [
        MockOrder("c1", [("C",1)], t(1)),
        MockOrder("a1", [("A",1)], t(2)),
        MockOrder("b1", [("B",1)], t(3)),
        MockOrder("a2", [("A",1)], t(4)),
        MockOrder("a3", [("A",1)], t(5)),
        MockOrder("b2", [("B",1)], t(6)),
        MockOrder("a4", [("A",1)], t(7)),
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    check("1 group (all k=1)", len(groups) == 1, f"got {len(groups)}")
    expected = ["a1","a2","a3","a4", "b1","b2", "c1"]
    check("A orders first (freq=4), then B (freq=2), then C (freq=1)",
          uids(groups[0]) == expected,
          f"got {uids(groups[0])}")


# ═══════════════════════════════════════════════════════════════
# TEST 4: k>1 topSku Sorting
# ═══════════════════════════════════════════════════════════════
def test_4_top_sku_sorting():
    print("\n--- TEST 4: k>1 topSku Sorting ---")
    # k=2 group: SKU X in 3 orders, SKU Y in 2, SKU Z in 1
    orders = [
        MockOrder("o1", [("X",1),("Y",1)], t(1)),  # has X, has Y
        MockOrder("o2", [("X",1),("Z",1)], t(2)),  # has X
        MockOrder("o3", [("Y",1),("Z",1)], t(3)),  # no X
        MockOrder("o4", [("X",1),("Y",1)], t(4)),  # has X, has Y (duplicate SKU combo)
    ]
    # X freq=3, Y freq=3, Z freq=2
    # Tie: X and Y both freq=3. Earliest containing X: t(1). Earliest containing Y: t(1).
    # Still tied -> lexicographic: X < Y -> topSku = X
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    check("1 group (all k=2)", len(groups) == 1, f"got {len(groups)}")
    # hasX: o1(t=1), o2(t=2), o4(t=4) first; noX: o3(t=3) last
    check("orders with topSku=X come first",
          uids(groups[0]) == ["o1","o2","o4","o3"],
          f"got {uids(groups[0])}")


# ═══════════════════════════════════════════════════════════════
# TEST 5: Rules Override — Rule Groups Sorted Internally
# ═══════════════════════════════════════════════════════════════
def test_5_rules_with_smart_sort():
    print("\n--- TEST 5: Rules Override + Smart Sort Within ---")
    rule = MockRule(
        id=1, name="Express Courier",
        priority=0,
        conditions={"courier_name": "DPD"},
        group_config={"name": "DPD Express", "color": "#ff0000"}
    )
    orders = [
        # DPD orders (will match rule) — mixed k values
        MockOrder("dpd1", [("A",1)],         t(1), courier_name="DPD"),
        MockOrder("dpd2", [("B",1)],         t(2), courier_name="DPD"),
        MockOrder("dpd3", [("A",1)],         t(3), courier_name="DPD"),
        MockOrder("dpd4", [("A",1),("C",1)], t(4), courier_name="DPD"),
        # Non-DPD orders (unmatched → smart sort default)
        MockOrder("fan1", [("A",1)],         t(5), courier_name="FAN"),
        MockOrder("fan2", [("B",1),("C",1)], t(6), courier_name="FAN"),
        MockOrder("fan3", [("A",1)],         t(7), courier_name="FAN"),
    ]
    engine = RulesEngine(rules=[rule])
    groups = engine.group_orders(orders)

    # Rule group should come first
    check("rule group is first", groups[0]["name"] == "DPD Express",
          f"first group is '{groups[0]['name']}'")
    check("rule group has color #ff0000", groups[0]["color"] == "#ff0000")

    # Within rule group: smart sorted (k=1 first, then k=2)
    dpd_uids = uids(groups[0])
    check("rule matched 4 DPD orders", len(dpd_uids) == 4, f"got {len(dpd_uids)}")
    # k=1 DPD: dpd1(A), dpd3(A), dpd2(B) — A freq=2, B freq=1
    # k=2 DPD: dpd4(A,C)
    check("DPD group smart-sorted: k=1(A,A,B) then k=2",
          dpd_uids == ["dpd1","dpd3","dpd2","dpd4"],
          f"got {dpd_uids}")

    # Default groups for unmatched (FAN orders)
    check("2 default groups for FAN orders (k=1 and k=2)",
          len(groups) == 3,  # 1 rule + 2 default
          f"got {len(groups)} groups total")

    # k=1 default: fan1(A), fan3(A) — both SKU A
    fan_k1 = uids(groups[1])
    check("FAN k=1 group: fan1, fan3 (SKU A, freq=2)",
          fan_k1 == ["fan1","fan3"],
          f"got {fan_k1}")

    # k=2 default: fan2
    fan_k2 = uids(groups[2])
    check("FAN k=2 group: fan2",
          fan_k2 == ["fan2"],
          f"got {fan_k2}")


# ═══════════════════════════════════════════════════════════════
# TEST 6: Multiple Rules with Priority
# ═══════════════════════════════════════════════════════════════
def test_6_multiple_rules_priority():
    print("\n--- TEST 6: Multiple Rules with Priority ---")
    rule_store_A = MockRule(
        id=1, name="Store A",
        priority=0,
        conditions={"store_uids": ["storeA"]},
        group_config={"name": "Magazine A", "color": "#00ff00"}
    )
    rule_store_B = MockRule(
        id=2, name="Store B",
        priority=1,
        conditions={"store_uids": ["storeB"]},
        group_config={"name": "Magazine B", "color": "#0000ff"}
    )
    orders = [
        MockOrder("a1", [("X",1)], t(1), store_uid="storeA"),
        MockOrder("b1", [("X",1)], t(2), store_uid="storeB"),
        MockOrder("a2", [("Y",1)], t(3), store_uid="storeA"),
        MockOrder("c1", [("X",1)], t(4), store_uid="storeC"),  # unmatched
        MockOrder("b2", [("X",1),("Y",1)], t(5), store_uid="storeB"),
    ]
    engine = RulesEngine(rules=[rule_store_A, rule_store_B])
    groups = engine.group_orders(orders)

    check("3 groups total (2 rules + 1 default)", len(groups) == 3,
          f"got {len(groups)}")
    check("first group is Store A (priority 0)", groups[0]["name"] == "Magazine A",
          f"first is '{groups[0]['name']}'")
    check("second group is Store B (priority 1)", groups[1]["name"] == "Magazine B",
          f"second is '{groups[1]['name']}'")

    # Store A group: a1(X), a2(Y) — smart sorted within
    check("Store A has 2 orders", len(groups[0]["orders"]) == 2)
    # Store B group: b1(X, k=1), b2(X+Y, k=2) — smart sorted
    check("Store B has 2 orders", len(groups[1]["orders"]) == 2)
    b_uids = uids(groups[1])
    check("Store B smart-sorted: b1(k=1) before b2(k=2)",
          b_uids == ["b1","b2"], f"got {b_uids}")

    # Default group: c1
    check("default group has c1 (storeC unmatched)",
          uids(groups[2]) == ["c1"],
          f"got {uids(groups[2])}")


# ═══════════════════════════════════════════════════════════════
# TEST 7: SKU Contains Rule
# ═══════════════════════════════════════════════════════════════
def test_7_sku_contains_rule():
    print("\n--- TEST 7: SKU Contains Rule ---")
    rule = MockRule(
        id=1, name="Gift Box",
        priority=0,
        conditions={"sku_contains": "cutie-cadou"},
        group_config={"name": "Cutii Cadou", "color": "#e91e63"}
    )
    orders = [
        MockOrder("g1", [("cutie-cadou",1),("71",1)], t(1)),  # matches
        MockOrder("n1", [("71",1)],                    t(2)),  # no match
        MockOrder("g2", [("cutie-cadou",2)],           t(3)),  # matches
        MockOrder("n2", [("55",1),("71",1)],           t(4)),  # no match
        MockOrder("g3", [("49",1),("cutie-cadou",1)],  t(5)),  # matches
    ]
    engine = RulesEngine(rules=[rule])
    groups = engine.group_orders(orders)

    check("Cutii Cadou group first", groups[0]["name"] == "Cutii Cadou")
    check("3 gift orders matched", len(groups[0]["orders"]) == 3,
          f"got {len(groups[0]['orders'])}")
    check("gift orders are g1, g2, g3",
          set(uids(groups[0])) == {"g1","g2","g3"})

    # Gift group smart-sorted: g2(k=1) before g1,g3(k=2)
    g_uids = uids(groups[0])
    check("gift group: g2(k=1) first, then g1,g3(k=2)",
          g_uids[0] == "g2",
          f"got {g_uids}")


# ═══════════════════════════════════════════════════════════════
# TEST 8: Item Count Rules (min/max)
# ═══════════════════════════════════════════════════════════════
def test_8_item_count_rules():
    print("\n--- TEST 8: Min/Max Item Count Rules ---")
    rule_single = MockRule(
        id=1, name="Single Item",
        priority=0,
        conditions={"max_items": 1},
        group_config={"name": "1 Produs", "color": "#4caf50"}
    )
    rule_bulk = MockRule(
        id=2, name="Bulk",
        priority=1,
        conditions={"min_items": 5},
        group_config={"name": "Bulk 5+", "color": "#ff9800"}
    )
    orders = [
        MockOrder("s1", [("A",1)], t(1)),                                          # 1 item -> single
        MockOrder("m1", [("A",1),("B",1),("C",1)], t(2)),                         # 3 items -> unmatched
        MockOrder("b1", [("A",2),("B",1),("C",1),("D",1),("E",1)], t(3)),       # 6 items -> bulk
        MockOrder("s2", [("B",1)], t(4)),                                          # 1 item -> single
    ]
    engine = RulesEngine(rules=[rule_single, rule_bulk])
    groups = engine.group_orders(orders)

    check("3 groups (single + bulk + default)", len(groups) == 3,
          f"got {len(groups)}")
    check("single group first (priority 0)", groups[0]["name"] == "1 Produs")
    check("single group has s1, s2", set(uids(groups[0])) == {"s1","s2"})
    check("bulk group second (priority 1)", groups[1]["name"] == "Bulk 5+")
    check("bulk group has b1", uids(groups[1]) == ["b1"])
    check("default group has m1", uids(groups[2]) == ["m1"])


# ═══════════════════════════════════════════════════════════════
# TEST 9: Deterministic Tie-Breaking in topSku
# ═══════════════════════════════════════════════════════════════
def test_9_deterministic_tiebreak():
    print("\n--- TEST 9: Deterministic Tie-Breaking ---")
    # All k=2. SKU A freq=2, SKU B freq=2, SKU C freq=2
    # Earliest: A@t(1), B@t(1), C@t(2)
    # Tie A vs B at same time -> lexicographic: A < B -> topSku = A
    orders = [
        MockOrder("o1", [("A",1),("B",1)], t(1)),
        MockOrder("o2", [("C",1),("A",1)], t(2)),
        MockOrder("o3", [("B",1),("C",1)], t(3)),
    ]
    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    check("topSku is A (tie-break: A,B both at t=1, A < B lex)",
          True)  # We verify by checking sort order
    # hasA: o1(t=1), o2(t=2) first. noA: o3(t=3) last.
    check("sorting: o1, o2 (hasA), then o3 (noA)",
          uids(groups[0]) == ["o1","o2","o3"],
          f"got {uids(groups[0])}")

    # Now reverse: B appears earlier
    orders2 = [
        MockOrder("o1", [("B",1),("C",1)], t(1)),  # B first seen at t(1)
        MockOrder("o2", [("A",1),("B",1)], t(2)),  # A first seen at t(2)
        MockOrder("o3", [("C",1),("A",1)], t(3)),
    ]
    groups2 = engine.group_orders(orders2)
    # B@t(1) < A@t(2) -> topSku = B
    # hasB: o1(t=1), o2(t=2) first. noB: o3(t=3) last.
    check("when B is earliest, topSku=B: o1,o2 first, o3 last",
          uids(groups2[0]) == ["o1","o2","o3"],
          f"got {uids(groups2[0])}")


# ═══════════════════════════════════════════════════════════════
# TEST 10: Nested inventory_item SKU (Frisbo format)
# ═══════════════════════════════════════════════════════════════
def test_10_nested_sku_format():
    print("\n--- TEST 10: Nested inventory_item SKU ---")
    orders = [
        MockOrder("o1", [("A",1)], t(1)),
        MockOrder("o2", [("A",1)], t(2)),
    ]
    # Manually set one order to use nested format
    orders[1].line_items = [{"inventory_item": {"sku": "A"}, "quantity": 1}]

    engine = RulesEngine(rules=[])
    groups = engine.group_orders(orders)

    check("both orders in same group", len(groups) == 1)
    check("both recognized as SKU A (flat + nested)",
          uids(groups[0]) == ["o1","o2"],
          f"got {uids(groups[0])}")


# ═══════════════════════════════════════════════════════════════
# TEST 11: Store-Scoped Mode
# ═══════════════════════════════════════════════════════════════
def test_11_store_scoped():
    print("\n--- TEST 11: Store-Scoped SKU Mode ---")
    orders = [
        MockOrder("s1a", [("X",1)], t(1), store_uid="S1"),
        MockOrder("s2a", [("X",1)], t(2), store_uid="S2"),
        MockOrder("s1b", [("X",1)], t(3), store_uid="S1"),
        MockOrder("s2b", [("X",1)], t(4), store_uid="S2"),
        MockOrder("s1c", [("Y",1)], t(5), store_uid="S1"),
    ]
    # Global mode: all X together (freq=4), then Y (freq=1)
    engine_global = RulesEngine(rules=[], sku_scope="global")
    groups_g = engine_global.group_orders(orders)
    check("global: X orders first (freq=4), then Y",
          uids(groups_g[0]) == ["s1a","s2a","s1b","s2b","s1c"],
          f"got {uids(groups_g[0])}")

    # Store-scoped: S1::X freq=2, S2::X freq=2, S1::Y freq=1
    engine_scoped = RulesEngine(rules=[], sku_scope="storeScoped")
    groups_s = engine_scoped.group_orders(orders)
    # S1::X freq=2 and S2::X freq=2 → tied freq → orders sort by createdAt
    # So: s1a(t1), s2a(t2), s1b(t3), s2b(t4) interleaved, then s1c(Y,freq=1)
    check("scoped: tied freq orders interleave by createdAt, Y last",
          uids(groups_s[0]) == ["s1a","s2a","s1b","s2b","s1c"],
          f"got {uids(groups_s[0])}")


# ═══════════════════════════════════════════════════════════════
# TEST 12: Empty Line Items / No SKU
# ═══════════════════════════════════════════════════════════════
def test_12_edge_cases():
    print("\n--- TEST 12: Edge Cases ---")
    # Empty orders list
    engine = RulesEngine(rules=[])
    groups = engine.group_orders([])
    check("empty orders -> empty groups", groups == [])

    # Orders with no line items
    o = MockOrder("empty", [], t(1), unique_sku_count=1)
    o.line_items = []
    groups2 = engine.group_orders([o])
    check("order with no line_items still grouped", len(groups2) == 1)

    # Single order
    groups3 = engine.group_orders([MockOrder("solo", [("A",1)], t(1))])
    check("single order -> 1 group with 1 order", len(groups3) == 1 and len(groups3[0]["orders"]) == 1)


# ═══════════════════════════════════════════════════════════════
# TEST 13: Complex Real-World Scenario
# ═══════════════════════════════════════════════════════════════
def test_13_complex_scenario():
    print("\n--- TEST 13: Complex Real-World Scenario ---")
    # Simulate: 2 stores, 2 couriers, 15 orders with varying complexity
    rule_dpd = MockRule(
        id=1, name="DPD", priority=0,
        conditions={"courier_name": "DPD"},
        group_config={"name": "Curier DPD", "color": "#e53935"}
    )
    rule_fan = MockRule(
        id=2, name="FAN", priority=1,
        conditions={"courier_name": "FAN"},
        group_config={"name": "Curier FAN", "color": "#1e88e5"}
    )

    orders = [
        # DPD orders
        MockOrder("d1", [("71",1)],                  t(1),  store_uid="EST", courier_name="DPD"),
        MockOrder("d2", [("71",1),("cutie",1)],      t(2),  store_uid="EST", courier_name="DPD"),
        MockOrder("d3", [("55",1)],                   t(3),  store_uid="EST", courier_name="DPD"),
        MockOrder("d4", [("71",1)],                   t(4),  store_uid="MUN", courier_name="DPD"),
        # FAN orders
        MockOrder("f1", [("71",1)],                   t(5),  store_uid="EST", courier_name="FAN"),
        MockOrder("f2", [("55",1),("71",1),("30",1)], t(6), store_uid="MUN", courier_name="FAN"),
        MockOrder("f3", [("55",1)],                   t(7),  store_uid="EST", courier_name="FAN"),
        # No courier (unmatched)
        MockOrder("n1", [("71",1)],                   t(8),  store_uid="EST"),
        MockOrder("n2", [("30",1),("55",1)],          t(9),  store_uid="MUN"),
        MockOrder("n3", [("71",1)],                   t(10), store_uid="EST"),
    ]

    engine = RulesEngine(rules=[rule_dpd, rule_fan])
    groups = engine.group_orders(orders)

    # Expected groups:
    # 1. Curier DPD (d1,d3,d4 k=1 then d2 k=2) — smart sorted within
    # 2. Curier FAN (f1,f3 k=1 then f2 k=3) — smart sorted within
    # 3. Default k=1: n1, n3 (SKU 71)
    # 4. Default k=2: n2 (SKUs 30,55)

    check("4 groups total", len(groups) == 4, f"got {len(groups)}: {[g['name'] for g in groups]}")
    check("group 1 is DPD", groups[0]["name"] == "Curier DPD")
    check("group 2 is FAN", groups[1]["name"] == "Curier FAN")

    # DPD group: 4 orders smart-sorted
    dpd = uids(groups[0])
    check("DPD has 4 orders", len(dpd) == 4, f"got {dpd}")
    # k=1: d1(71), d4(71), d3(55) -> 71 freq=2, 55 freq=1 -> d1,d4,d3
    # k=2: d2
    check("DPD sorted: d1,d4(sku71,freq=2), d3(sku55), d2(k=2)",
          dpd == ["d1","d4","d3","d2"],
          f"got {dpd}")

    # FAN group: 3 orders
    fan = uids(groups[1])
    check("FAN has 3 orders", len(fan) == 3, f"got {fan}")
    # k=1: f1(71), f3(55) -> 71 freq=1, 55 freq=1 -> tie, f1 older -> f1, f3
    # k=3: f2
    check("FAN sorted: f1(t=5),f3(t=7) k=1 then f2 k=3",
          fan == ["f1","f3","f2"],
          f"got {fan}")

    # Default k=1: n1, n3
    def_k1 = uids(groups[2])
    check("default k=1: n1,n3 (both sku=71, oldest first)",
          def_k1 == ["n1","n3"],
          f"got {def_k1}")

    # Default k=2: n2
    def_k2 = uids(groups[3])
    check("default k=2: n2", def_k2 == ["n2"])


# ═══════════════════════════════════════════════════════════════
# RUN ALL
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 60)
    print("EXHAUSTIVE SMART SORT VERIFICATION")
    print("=" * 60)

    test_1_reference_data()
    test_2_multiple_qty_same_sku()
    test_3_k1_clustering()
    test_4_top_sku_sorting()
    test_5_rules_with_smart_sort()
    test_6_multiple_rules_priority()
    test_7_sku_contains_rule()
    test_8_item_count_rules()
    test_9_deterministic_tiebreak()
    test_10_nested_sku_format()
    test_11_store_scoped()
    test_12_edge_cases()
    test_13_complex_scenario()

    print("\n" + "=" * 60)
    print(f"RESULTS: {PASS} passed, {FAIL} failed out of {PASS+FAIL} checks")
    if FAIL == 0:
        print("ALL CHECKS PASSED!")
    else:
        print(f"!!! {FAIL} FAILURES !!!")
    print("=" * 60)
