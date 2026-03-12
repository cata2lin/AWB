"""
Rules Engine — orchestrates rule matching and order grouping.

This is the main entry point. For specific logic, see:
- matching.py  → Rule condition evaluation (add new conditions here)
- sorting.py   → SKU frequency sorting and default groups (edit sorting here)
- helpers.py   → SKU extraction and date utilities
"""
from typing import List, Dict, Any

from app.services.rules.matching import matches_rule
from app.services.rules.sorting import smart_sort_orders, build_default_groups


class RulesEngine:
    """
    Priority-based rules engine with smart default sorting.

    Rules are evaluated in priority order (lower number = higher priority).
    Each order is assigned to exactly one group based on the first matching rule.
    Orders that don't match any rule get smart-sorted by lineItemCount + SKU frequency.
    """

    def __init__(self, rules, sku_scope: str = "global"):
        """
        Initialize with a list of rules sorted by priority.

        Args:
            rules: List of Rule objects
            sku_scope: "global" (default) or "storeScoped"
                       If storeScoped, SKU keys become storeId::sku
        """
        self.rules = sorted(rules, key=lambda r: r.priority)
        self.sku_scope = sku_scope

    def group_orders(self, orders) -> List[Dict[str, Any]]:
        """
        Group orders according to rules, then smart-sort unmatched orders.

        Returns:
            List of groups, each containing:
            - name: Group name
            - color: Group color
            - rule_id: ID of the matching rule (None for default groups)
            - orders: List of orders in this group (sorted)
        """
        groups: Dict[str, Dict[str, Any]] = {}
        unmatched_orders = []

        # Phase 1: Match orders against rules
        for order in orders:
            matched = False

            for rule in self.rules:
                if matches_rule(order, rule, self.sku_scope):
                    group_key = f"rule_{rule.id}"

                    if group_key not in groups:
                        config = rule.group_config or {}
                        groups[group_key] = {
                            "name": config.get("name", rule.name),
                            "color": config.get("color", "#6366f1"),
                            "rule_id": rule.id,
                            "orders": []
                        }

                    groups[group_key]["orders"].append(order)
                    matched = True
                    break

            if not matched:
                unmatched_orders.append(order)

        # Phase 2: Smart-sort orders within each rule group
        for group in groups.values():
            group["orders"] = smart_sort_orders(group["orders"], self.sku_scope)

        # Phase 3: Smart-group unmatched orders by lineItemCount
        if unmatched_orders:
            default_groups = build_default_groups(unmatched_orders, self.sku_scope)
            for dg in default_groups:
                gk = f"default_k{dg['k']}"
                groups[gk] = dg

        # Phase 4: Assemble final ordered list
        result = []

        # Rule groups first (by priority)
        for rule in self.rules:
            key = f"rule_{rule.id}"
            if key in groups:
                result.append(groups[key])

        # Default groups by lineItemCount ascending
        default_keys = sorted(
            [k for k in groups if k.startswith("default_k")],
            key=lambda k: int(k.replace("default_k", ""))
        )
        for dk in default_keys:
            result.append(groups[dk])

        return result
