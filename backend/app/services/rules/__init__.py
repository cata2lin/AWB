"""
Rules package — re-exports for backward compatibility.

Existing code can still import:
    from app.services.rules_engine import RulesEngine
But also supports:
    from app.services.rules.engine import RulesEngine
    from app.services.rules.matching import matches_rule
    from app.services.rules.sorting import smart_sort_group
"""
from app.services.rules.engine import RulesEngine
from app.services.rules.matching import matches_rule
from app.services.rules.sorting import smart_sort_group, smart_sort_orders, build_default_groups
from app.services.rules.helpers import get_sku, extract_skus, safe_dt

__all__ = [
    "RulesEngine",
    "matches_rule",
    "smart_sort_group", "smart_sort_orders", "build_default_groups",
    "get_sku", "extract_skus", "safe_dt",
]
