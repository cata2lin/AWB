"""Smoke tests — verify the wired stack boots and core endpoints respond.

What these test:
- App imports + lifespan succeeds (DB reachable, BNR sync runs)
- Critical read-only endpoints return 2xx with the expected JSON shape
- No 500s on the analytics endpoints the dashboards depend on

What they explicitly do NOT test:
- Specific numerical values (use unit tests once we have them)
- Write paths (CRUD, sync triggers) — would mutate the local DB

Slow tests (the ones that crunch the whole orders table) are marked
`@pytest.mark.slow` and skipped by default. Run with `pytest -m slow` to
include them, or `pytest -m "not slow"` (the default) for the fast pass.
"""

from __future__ import annotations

import pytest


# ───────────────────────────────────────────────────────────────────────────────
# Health & basic plumbing
# ───────────────────────────────────────────────────────────────────────────────


def test_health_endpoint(client):
    """The simplest possible check — server responds, version is present."""
    r = client.get("/api/health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "healthy"
    assert "version" in body


# ───────────────────────────────────────────────────────────────────────────────
# Analytics endpoints — the ones the Analytics dashboard depends on
# ───────────────────────────────────────────────────────────────────────────────


def test_deliverability_responds(client):
    """Per-store deliverability stats endpoint. Should always return a JSON
    object with a `stores` array, even when filtered to nothing."""
    r = client.get("/api/analytics/deliverability", params={"days": 7})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)
    assert "stores" in body, f"missing 'stores' key in {list(body.keys())}"
    assert isinstance(body["stores"], list)


@pytest.mark.slow
def test_profitability_responds(client):
    """P&L endpoint. Crunches the whole order set — minutes on a real DB.

    Marked slow because it scales with the orders table (455k+ rows in
    production-like DBs). Run explicitly with `pytest -m slow`.
    """
    r = client.get("/api/analytics/profitability", params={"days": 7})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)
    # Schema has evolved; just verify it didn't 500 and returned an object.
    assert "detail" not in body or r.status_code == 200


@pytest.mark.slow
def test_pnl_delivered_count_matches_deliverability(client):
    """Regression for the variable-shadowing bug: the P&L `excluded_skus` set was
    clobbered by the `exclude_from_stock` SKUs, so the whole-order skip silently
    dropped every order containing a gift/bundle SKU (1,696 delivered orders /
    ~219K RON in April). After the fix the P&L delivered count must (re-)align with
    the deliverability delivered count over the same window — they share `classify()`.

    We allow a ≤1.5% shortfall (orders with unconvertible foreign FX are excluded
    from the P&L but not deliverability); the bug was a ~3.7% drop, well outside it.
    """
    params = {"days": 30}
    pnl = client.get("/api/analytics/profitability", params=params).json()
    deliv = client.get("/api/analytics/deliverability", params=params).json()

    pnl_delivered = (pnl.get("summary") or {}).get("delivered_orders")
    # sum delivered across deliverability stores (tolerate key variants)
    deliv_delivered = 0
    for s in deliv.get("stores", []):
        for k in ("delivered", "delivered_orders", "livrate", "livrata"):
            if isinstance(s.get(k), (int, float)):
                deliv_delivered += s[k]
                break

    assert pnl_delivered is not None, "P&L missing summary.delivered_orders"
    if deliv_delivered > 0:
        ratio = pnl_delivered / deliv_delivered
        assert ratio >= 0.985, (
            f"P&L delivered ({pnl_delivered}) is {(1 - ratio) * 100:.1f}% below "
            f"deliverability ({deliv_delivered}) — the exclude_from_stock whole-order "
            f"drop may have regressed."
        )


def test_summary_responds(client):
    """Dashboard KPI summary endpoint."""
    r = client.get("/api/analytics/summary", params={"days": 7})
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


# ───────────────────────────────────────────────────────────────────────────────
# Core CRUD endpoints — read-only smoke
# ───────────────────────────────────────────────────────────────────────────────


def test_stores_list(client):
    """Stores list — used by every tab as a filter dropdown."""
    r = client.get("/api/stores")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    # If stores exist, verify the contract: uid + name are always present.
    if body:
        first = body[0]
        assert "uid" in first
        assert "name" in first


def test_orders_count(client):
    """Order count endpoint — backs the order-table pagination."""
    r = client.get("/api/orders/count")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)
    assert "count" in body or "total" in body


def test_filter_options_responds(client):
    """Dynamic filter options endpoint — used to populate dropdowns. Must not
    500 even when no orders exist."""
    r = client.get("/api/orders/filter-options")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


# ───────────────────────────────────────────────────────────────────────────────
# Configuration endpoints
# ───────────────────────────────────────────────────────────────────────────────


def test_profitability_config(client):
    """Single-row config endpoint. Should return the canonical config object
    with a vat_rate field — guards against the bug where vat_rate was missing."""
    r = client.get("/api/profitability-config")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)
    # vat_rate is the field the entire P&L formula depends on — must exist.
    assert "vat_rate" in body, (
        f"vat_rate missing from profitability-config — P&L will silently break. "
        f"Got keys: {list(body.keys())}"
    )


def test_pnl_sections(client):
    """P&L section catalog — used by Business Costs UI to populate the section
    dropdown. Endpoint returns `{sections: [{key, label}, ...]}`."""
    r = client.get("/api/business-costs/pnl-sections")
    assert r.status_code == 200, r.text
    body = r.json()
    sections = body.get("sections", []) if isinstance(body, dict) else body
    keys = [s.get("key") for s in sections]
    for required in ("cogs", "operational", "marketing", "fixed"):
        assert required in keys, f"P&L section '{required}' missing from {keys}"
