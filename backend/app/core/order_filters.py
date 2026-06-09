"""
Shared order-filtering helpers for analytics reports.

Test/junk orders are excluded from ALL reports to match the Scripturi reference,
which excludes orders by configurable rules (its ``profit_exclusion_rules`` table
with ``tag`` and ``sku`` rule types, plus an ``exclude_test`` default). Tags arrive
from Frisbo's ``OrderTags`` via the sync (``app/services/frisbo/parser.py``) and
are stored lowercased on ``Order.tags`` (a JSON list, e.g. ``["test", "duplicata"]``).

Two layers:
  • DEFAULT_EXCLUDED_TAGS — always-on built-ins (``test``, ``sample``), matching
    Scripturi's seeded ``test`` rule and the product report's ``test, sample`` default.
  • ExclusionRule table — user-configurable extra ``tag``/``sku`` rules (CRUD via
    ``app/api/exclusion_rules.py``), so admins can exclude arbitrary tags/SKUs
    without a code change, exactly like Scripturi's ``profit_exclusion_rules``.

NOTE: until the ``orders.tags`` column is migrated and orders are re-synced to
backfill tags, every order has ``tags = NULL`` and the tag filter excludes nothing
(safe no-op). After backfill, test/sample orders drop out of every report — making
AWB's order counts match Scripturi.
"""

from sqlalchemy import cast, Text, or_, not_, and_, select

from app.models import Order
from app.models.exclusion_rule import ExclusionRule

# Always-on built-in tag exclusions (lowercased). Mirrors Scripturi's seeded
# ``test`` rule + the product profitability default ``test, sample``.
DEFAULT_EXCLUDED_TAGS = ("test", "sample")

# Backwards-compatible alias — some call sites still import EXCLUDED_TAGS.
EXCLUDED_TAGS = DEFAULT_EXCLUDED_TAGS


def is_test_order(tags, excluded_tags=DEFAULT_EXCLUDED_TAGS) -> bool:
    """True if an order's tags mark it as excluded (Python-side filter)."""
    if not tags:
        return False
    low = {str(t).strip().lower() for t in tags}
    return any(t in low for t in excluded_tags)


def tag_condition(excluded_tags):
    """Build the SQLAlchemy WHERE condition dropping orders whose ``tags`` contain
    any excluded tag. Matches the quoted tag (so ``"test"`` matches the tag *test*
    but not ``latest``/``testing``). Orders with NULL tags are KEPT."""
    keep = []
    for t in excluded_tags:
        t = str(t).strip().lower()
        if not t:
            continue
        keep.append(
            or_(
                Order.tags.is_(None),
                not_(cast(Order.tags, Text).ilike(f'%"{t}"%')),
            )
        )
    return and_(*keep) if keep else and_(True)


def exclude_test_orders_condition():
    """SQLAlchemy WHERE condition dropping the BUILT-IN excluded tags only
    (``test``, ``sample``). Synchronous — for callers that don't load the
    configurable DB rules. Prefer ``build_tag_exclusion_condition(db)`` to also
    honour user-configured tag rules."""
    return tag_condition(DEFAULT_EXCLUDED_TAGS)


async def load_exclusion_rules(db):
    """Return ``(excluded_tags, excluded_skus)`` = built-ins + the configurable
    ExclusionRule rows. Tags and SKUs are lowercased and de-duplicated."""
    tags = set(DEFAULT_EXCLUDED_TAGS)
    skus = set()
    try:
        rows = (await db.execute(select(ExclusionRule))).scalars().all()
    except Exception:
        # Table not migrated yet → roll back the aborted transaction (so the
        # endpoint's next query still works) and fall back to the built-ins.
        try:
            await db.rollback()
        except Exception:
            pass
        return sorted(tags), []
    for r in rows:
        val = (r.value or "").strip().lower()
        if not val:
            continue
        if r.rule_type == "tag":
            tags.add(val)
        elif r.rule_type == "sku":
            skus.add(val)
    return sorted(tags), sorted(skus)


async def build_tag_exclusion_condition(db):
    """Async: SQLAlchemy WHERE condition dropping orders tagged with any excluded
    tag — built-ins PLUS user-configured ``tag`` rules. Use this in analytics
    endpoints (they already have ``db``) so the exclusion list is configurable."""
    excluded_tags, _ = await load_exclusion_rules(db)
    return tag_condition(excluded_tags)


def order_has_excluded_sku(line_items, excluded_skus) -> bool:
    """True if any line item's SKU is in the excluded set (case-insensitive).
    Used by the P&L loops to drop a whole order that contains an excluded SKU,
    mirroring Scripturi's ``rule_type='sku'`` whole-order exclusion."""
    if not excluded_skus or not isinstance(line_items, list):
        return False
    excl = {s.strip().lower() for s in excluded_skus}
    for item in line_items:
        if not isinstance(item, dict):
            continue
        # Shape-tolerant: full Frisbo items nest sku under inventory_item; the P&L's
        # projected line_items (SQL jsonb_build_object) put sku at the top level.
        inv = item.get("inventory_item") or {}
        sku = (
            item.get("sku") or (inv.get("sku") if isinstance(inv, dict) else None) or ""
        )
        if sku.strip().lower() in excl:
            return True
    return False
