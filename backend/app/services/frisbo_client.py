"""
Backward-compatibility shim — imports from the frisbo/ package.

All code that does `from app.services.frisbo_client import FrisboClient` continues to work.
New code should import directly from app.services.frisbo.
"""
from app.services.frisbo import FrisboClient, frisbo_client, RateLimiter, parse_order

__all__ = ["FrisboClient", "frisbo_client", "RateLimiter"]
