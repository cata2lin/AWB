"""
Async eMAG Marketplace API client (multi-marketplace).

Ported from Scripturi's ``core/emag_client.py`` (the sync ``requests`` version) to
``httpx.AsyncClient`` to match the AWB backend (see ``services/frisbo/client.py``).

INERT BY DESIGN: this client reads credentials ONLY from environment variables —
there is no config.py entry and no saved-settings file. A marketplace is
``configured`` only when BOTH its user and pass env vars are set. With no creds the
report stays empty and the sync returns immediately (see ``services/emag/sync.py``).

Env vars (per marketplace, both required):
    EMAG_RO_USER / EMAG_RO_PASS
    EMAG_BG_USER / EMAG_BG_PASS
    EMAG_HU_USER / EMAG_HU_PASS

Preserved behaviour from the port:
  - HTTP Basic auth, per marketplace.
  - 0.5s pacing between calls.
  - 429 → sleep 10s + retry once.
  - never-raise envelope: every call returns {isError, messages, status_code, results}.
  - paginated order reads, 100/page.

NOTE on eMAG IP allow-listing: even with valid creds, eMAG only answers requests
from IPs the seller has whitelisted in their eMAG account. A 401/403 with valid
creds usually means the server's public IP is not allow-listed yet.
"""

import os
import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


# ─── Marketplace definitions ─────────────────────────────────

MARKETPLACES: Dict[str, Dict[str, str]] = {
    "RO": {
        "name": "România",
        "flag": "🇷🇴",
        "currency": "RON",
        "base_url": "https://marketplace-api.emag.ro/api-3",
        "env_user": "EMAG_RO_USER",
        "env_pass": "EMAG_RO_PASS",
    },
    "BG": {
        "name": "Bulgaria",
        "flag": "🇧🇬",
        "currency": "BGN",
        "base_url": "https://marketplace-api.emag.bg/api-3",
        "env_user": "EMAG_BG_USER",
        "env_pass": "EMAG_BG_PASS",
    },
    "HU": {
        "name": "Ungaria",
        "flag": "🇭🇺",
        "currency": "HUF",
        "base_url": "https://marketplace-api.emag.hu/api-3",
        "env_user": "EMAG_HU_USER",
        "env_pass": "EMAG_HU_PASS",
    },
}

_RATE_DELAY = 0.5  # seconds between calls (preserve eMAG pacing)
_RETRY_SLEEP = 10  # seconds to wait after a 429 before the single retry
_ITEMS_PER_PAGE = 100
_MAX_PAGES = 20


def _creds_for(marketplace: str) -> tuple:
    """Read (user, pass) for a marketplace from env vars. Either may be ''."""
    info = MARKETPLACES.get(marketplace.upper(), {})
    user = os.getenv(info.get("env_user", ""), "") or ""
    password = os.getenv(info.get("env_pass", ""), "") or ""
    return user.strip(), password.strip()


class EmagClient:
    """Async eMAG Marketplace API client for a single marketplace."""

    def __init__(
        self,
        marketplace: str = "RO",
        username: str = "",
        password: str = "",
        base_url: str = "",
    ):
        self.marketplace = marketplace.upper()
        info = MARKETPLACES.get(self.marketplace, {})
        self.username = username
        self.password = password
        self.base_url = (base_url or info.get("base_url", "")).rstrip("/")
        self.currency = info.get("currency", "RON")

    @classmethod
    def from_env(cls, marketplace: str = "RO") -> "EmagClient":
        """Build a client for a marketplace, reading creds from env vars."""
        user, password = _creds_for(marketplace)
        return cls(marketplace=marketplace, username=user, password=password)

    @property
    def is_configured(self) -> bool:
        """A marketplace is configured only if BOTH user and pass are set."""
        return bool(self.username and self.password)

    @classmethod
    def configured_marketplaces(cls) -> List[str]:
        """Return MP codes that have BOTH env creds set (e.g. ['RO', 'BG'])."""
        out = []
        for code in MARKETPLACES:
            user, password = _creds_for(code)
            if user and password:
                out.append(code)
        return out

    # ─── Low-level POST (never raises; returns the eMAG envelope) ─────────

    async def _post(
        self,
        endpoint: str,
        data: Any = None,
        timeout: float = 30.0,
        _retried: bool = False,
    ) -> dict:
        """POST to the eMAG API with 0.5s pacing and a single 429 retry.

        Always returns a dict shaped like the eMAG envelope:
        {isError, messages, status_code, results}.
        """
        await asyncio.sleep(_RATE_DELAY)
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    url,
                    json=data if data is not None else {},
                    auth=(self.username, self.password),
                    headers={"Content-Type": "application/json"},
                )
            if resp.status_code == 429 and not _retried:
                logger.warning(
                    "[eMAG/%s] Rate limited (429), waiting %ss then retrying once",
                    self.marketplace,
                    _RETRY_SLEEP,
                )
                await asyncio.sleep(_RETRY_SLEEP)
                return await self._post(endpoint, data, timeout, _retried=True)

            if resp.status_code >= 400:
                logger.error(
                    "[eMAG/%s] HTTP %s on %s: %s",
                    self.marketplace,
                    resp.status_code,
                    endpoint,
                    resp.text[:300],
                )
                return {
                    "isError": True,
                    "messages": [f"HTTP {resp.status_code}"],
                    "status_code": resp.status_code,
                    "results": [],
                }

            try:
                body = resp.json()
            except Exception as e:
                return {
                    "isError": True,
                    "messages": [f"Invalid JSON response: {e}"],
                    "status_code": resp.status_code,
                    "results": [],
                }

            if not isinstance(body, dict):
                body = {"isError": False, "messages": [], "results": body}
            body.setdefault("isError", False)
            body.setdefault("messages", [])
            body.setdefault("status_code", resp.status_code)
            body.setdefault("results", [])
            return body
        except httpx.TimeoutException:
            logger.error("[eMAG/%s] Request timeout on %s", self.marketplace, endpoint)
            return {
                "isError": True,
                "messages": ["Connection timeout"],
                "status_code": 0,
                "results": [],
            }
        except httpx.RequestError as e:
            logger.error(
                "[eMAG/%s] Request error on %s: %s", self.marketplace, endpoint, e
            )
            return {
                "isError": True,
                "messages": [f"Connection error: {e}"],
                "status_code": 0,
                "results": [],
            }
        except Exception as e:  # never raise into the caller
            logger.error(
                "[eMAG/%s] Unexpected error on %s: %s", self.marketplace, endpoint, e
            )
            return {
                "isError": True,
                "messages": [str(e)],
                "status_code": 0,
                "results": [],
            }

    # ─── Orders ──────────────────────────────────────────────────────────

    async def read_orders(
        self,
        status: Optional[int] = None,
        page: int = 1,
        items_per_page: int = _ITEMS_PER_PAGE,
        created_after: Optional[str] = None,
    ) -> List[dict]:
        """Read one page of orders. Returns [] on any error (logged)."""
        payload: Dict[str, Any] = {
            "currentPage": page,
            "itemsPerPage": items_per_page,
        }
        if status is not None:
            payload["status"] = status
        if created_after:
            payload["createdAfter"] = created_after

        result = await self._post("order/read", payload)
        if result.get("isError"):
            logger.warning(
                "[eMAG/%s] Error reading orders page %s: %s",
                self.marketplace,
                page,
                result.get("messages"),
            )
            return []
        return result.get("results") or []

    async def read_orders_all_pages(
        self,
        marketplace: Optional[str] = None,
        status: Optional[int] = None,
        created_after: Optional[str] = None,
        max_pages: int = _MAX_PAGES,
    ) -> List[dict]:
        """Read all order pages (100/page) for this client's marketplace.

        ``marketplace`` is accepted for call-site clarity but must match the
        client's own marketplace (the client is bound to one marketplace).
        """
        if marketplace and marketplace.upper() != self.marketplace:
            logger.warning(
                "[eMAG/%s] read_orders_all_pages called with marketplace=%s; "
                "using bound marketplace %s",
                self.marketplace,
                marketplace,
                self.marketplace,
            )

        all_orders: List[dict] = []
        for page in range(1, max_pages + 1):
            orders = await self.read_orders(
                status=status,
                page=page,
                items_per_page=_ITEMS_PER_PAGE,
                created_after=created_after,
            )
            if not orders:
                break
            all_orders.extend(orders)
            if len(orders) < _ITEMS_PER_PAGE:
                break
        return all_orders
