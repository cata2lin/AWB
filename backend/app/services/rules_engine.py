"""
Backward-compatibility shim — imports from the rules/ package.

All code that does `from app.services.rules_engine import RulesEngine` continues to work.
New code should import directly from app.services.rules.
"""
from app.services.rules import RulesEngine, matches_rule, smart_sort_group, smart_sort_orders, build_default_groups, get_sku, extract_skus, safe_dt

__all__ = ["RulesEngine"]
