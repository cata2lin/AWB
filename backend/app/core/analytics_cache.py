"""
Tiny in-memory TTL cache for the heavy analytics endpoints.

The P&L / SKU-profitability / velocity / deliverability endpoints recompute from
the full orders window on every request — expensive, and dashboards/tab-switches
hit them repeatedly with identical params. This caches successful results for a
short TTL so repeat loads are instant, and is CLEARED on sync completion so a sync
never leaves stale numbers on screen (see sync_service).

Per-process and intentionally simple (no eviction beyond TTL); the working set is a
handful of (endpoint, params) keys. Mirrors the existing comision_agentie cache.
"""

import time
import functools

_CACHE = {}  # key -> {"data": ..., "expires_at": float}
DEFAULT_TTL = 120  # seconds


def make_key(name: str, **params) -> str:
    """Stable cache key from an endpoint name + its params (order-independent)."""
    parts = [name]
    for k in sorted(params):
        v = params[k]
        if isinstance(v, (list, tuple, set)):
            v = ",".join(str(x) for x in sorted(v))
        parts.append(f"{k}={v}")
    return "|".join(parts)


def cache_get(key: str):
    entry = _CACHE.get(key)
    if entry and time.time() < entry["expires_at"]:
        return entry["data"]
    return None


def cache_set(key: str, data, ttl: int = DEFAULT_TTL):
    _CACHE[key] = {"data": data, "expires_at": time.time() + ttl}
    return data


def cache_clear():
    """Invalidate everything — called when a sync completes so reports refresh."""
    _CACHE.clear()


def cached_analytics(name: str, ttl: int = DEFAULT_TTL):
    """Decorator: cache an async analytics endpoint's result keyed on its params.

    Apply BELOW the @router.get decorator. Uses functools.wraps so FastAPI still
    sees the original signature (Depends etc.). The `db` session is excluded from
    the cache key. Cleared on sync completion via cache_clear().
    """

    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            key_params = {k: v for k, v in kwargs.items() if k != "db"}
            ck = make_key(name, **key_params)
            hit = cache_get(ck)
            if hit is not None:
                return hit
            result = await fn(*args, **kwargs)
            return cache_set(ck, result, ttl)

        return wrapper

    return deco
