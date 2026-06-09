"""Trendyol seller-API service package.

Async httpx client for Trendyol's seller integration API, used by the
Trendyol SALES & SETTLEMENTS profitability report. Ported from Scripturi's
``core/trendyol_client.py`` + ``trendyol_profitability.py``, preserving every
load-bearing quirk (Basic auth, mandatory User-Agent, storeFrontCode rules,
one-transaction-type-per-call settlements, date-window widening).

Credentials are read from environment variables only — the client is inert
(``is_configured()`` → False) until all three are set.
"""

from app.services.trendyol.client import TrendyolClient

__all__ = ["TrendyolClient"]
