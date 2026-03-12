"""
Frisbo package — re-exports for backward compatibility.

Existing code can still import:
    from app.services.frisbo_client import FrisboClient, frisbo_client
"""
from app.services.frisbo.client import FrisboClient, frisbo_client
from app.services.frisbo.rate_limiter import RateLimiter
from app.services.frisbo.parser import parse_order

__all__ = ["FrisboClient", "frisbo_client", "RateLimiter", "parse_order"]
