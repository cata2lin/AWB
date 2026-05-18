"""Shared pytest fixtures for the smoke test suite.

These tests boot the real FastAPI app via TestClient — including the lifespan
event (BNR sync, admin-user bootstrap, scheduler start). The local PostgreSQL
DB must be reachable at the DATABASE_URL configured in backend/.env. Tests are
read-only / behavior-shape checks; they don't mutate data.

CLAUDE.md Tier-4 rule: no mocked DB. Smoke tests prove the wired stack works.

All API endpoints (except /api/health) are auth-gated, so the default `client`
fixture logs in as the bootstrap admin user (admin/admin123, created by the
lifespan when the users table is empty) and attaches the JWT to every request.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def _raw_client():
    """Unauthenticated TestClient — boots the app once per test session.

    The TestClient context-manager triggers the lifespan (startup + shutdown),
    so this fixture exercises the same code path uvicorn uses in production.
    """
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_token(_raw_client) -> str:
    """Authenticate as the bootstrap admin and return a JWT.

    The lifespan creates admin/admin123 when the users table is empty (see
    backend/app/main.py). If the password has been changed for this DB, set
    AWB_TEST_ADMIN_USER / AWB_TEST_ADMIN_PASSWORD env vars to override.
    """
    import os

    username = os.environ.get("AWB_TEST_ADMIN_USER", "admin")
    password = os.environ.get("AWB_TEST_ADMIN_PASSWORD", "admin123")
    r = _raw_client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert r.status_code == 200, (
        f"Test admin login failed (HTTP {r.status_code}): {r.text}. "
        f"If you changed the admin password, set AWB_TEST_ADMIN_USER / "
        f"AWB_TEST_ADMIN_PASSWORD before running pytest."
    )
    return r.json()["token"]


@pytest.fixture(scope="session")
def client(_raw_client, auth_token):
    """Authenticated TestClient — every request carries the admin JWT.

    Use `_raw_client` (the unauthenticated one) directly only if you're
    specifically testing the auth gate.
    """
    _raw_client.headers.update({"Authorization": f"Bearer {auth_token}"})
    yield _raw_client
