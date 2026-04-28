"""
TOM API Client — HMAC-SHA256 signed HTTP requests to tom.arona.ro.

Spec: https://github.com/contact546/tom → docs/integration-guide.md

Canonical string: METHOD\nPATH\nTIMESTAMP\nSHA256_HEX(body)
All four headers (X-Tom-Key, X-Tom-Timestamp, X-Tom-Signature, Idempotency-Key)
must be present on every request. Server-to-server only.
"""
import hashlib
import hmac
import logging
import os
import time
from typing import Optional, Any

import httpx

logger = logging.getLogger(__name__)
from app.core.config import get_settings

# ── Configuration helpers (read fresh each call — avoids lru_cache freeze) ───

def _cfg():
    """Return a fresh settings read (bypasses the module-level lru_cache)."""
    from app.core.config import Settings
    return Settings()  # reads .env directly every time

def is_tom_configured() -> bool:
    """Check if TOM API credentials are configured."""
    c = _cfg()
    configured = bool(c.tom_base_url and c.tom_api_key_id and c.tom_hmac_secret)
    if not configured:
        logger.warning(f"TOM not configured — base_url={c.tom_base_url!r} key_id={c.tom_api_key_id!r} secret={'set' if c.tom_hmac_secret else 'MISSING'}")
    return configured

# Keep module-level aliases for backward compat with tom_sync.py imports
@property
def TOM_SOURCE_CODE():
    return _cfg().tom_source_code or "VIGO"


# ── HMAC-SHA256 Signing ──────────────────────────────────────────────────

def _sign_request(method: str, path: str, body_bytes: bytes) -> dict:
    """
    Generate HMAC-SHA256 signature headers for a TOM API request.

    Canonical string: METHOD\nPATH\nTIMESTAMP\nSHA256_HEX(body)
    """
    ts = str(int(time.time()))
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    canonical = "\n".join([method.upper(), path, ts, body_hash])
    sig = hmac.new(
        TOM_HMAC_SECRET.encode(),
        canonical.encode(),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Tom-Key": TOM_API_KEY_ID,
        "X-Tom-Timestamp": ts,
        "X-Tom-Signature": sig,
    }


# ── HTTP Client ──────────────────────────────────────────────────────────

async def tom_fetch(
    method: str,
    path: str,
    body: Optional[Any] = None,
    idempotency_key: Optional[str] = None,
    timeout: float = 30.0,
) -> dict:
    """
    Make an authenticated request to TOM API.

    Returns: {"status": int, "body": dict}
    Raises: on network/timeout errors (caller should handle)
    """
    if not is_tom_configured():
        raise RuntimeError("TOM client not configured. Set TOM_BASE_URL, TOM_API_KEY_ID, TOM_HMAC_SECRET.")

    cfg = _cfg()
    base_url = cfg.tom_base_url.rstrip("/")
    api_key_id = cfg.tom_api_key_id
    hmac_secret = cfg.tom_hmac_secret
    source_code = cfg.tom_source_code or "VIGO"

    import json
    from urllib.parse import quote

    # Compact JSON serialization (no spaces) ensures hash consistency with TOM spec
    raw_body = json.dumps(body, separators=(',', ':')).encode() if body else b""

    # URL-encode the path segments (e.g. "FB Products" → "FB%20Products")
    # so the signed canonical string matches what TOM sees via url.pathname
    encoded_path = quote(path, safe="/")

    # Sign with the URL-encoded path (what the TOM server verifies against url.pathname)
    ts = str(int(time.time()))
    body_hash = hashlib.sha256(raw_body).hexdigest()
    canonical = "\n".join([method.upper(), encoded_path, ts, body_hash])
    sig = hmac.new(hmac_secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

    headers = {
        "X-Tom-Key": api_key_id,
        "X-Tom-Timestamp": ts,
        "X-Tom-Signature": sig,
    }
    if method.upper() != "GET":
        headers["Content-Type"] = "application/json"
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    url = f"{base_url}{encoded_path}"
    logger.info(f"TOM → {method} {url} | key={api_key_id[:20]}... | ts={ts} | body_hash={body_hash[:16]}...")

    async with httpx.AsyncClient(timeout=timeout) as client:
        if method.upper() == "GET":
            response = await client.get(url, headers=headers)
        elif method.upper() == "POST":
            response = await client.post(url, headers=headers, content=raw_body)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")

    try:
        response_body = response.json()
    except Exception:
        response_body = {"raw": response.text}

    if response.status_code not in (200, 201, 409):
        logger.error(f"TOM error {response.status_code} ← {url} | body={response_body}")
    else:
        logger.info(f"TOM ← {response.status_code} OK")

    return {"status": response.status_code, "body": response_body}


async def tom_fetch_with_config(
    method: str,
    path: str,
    body: Optional[Any] = None,
    idempotency_key: Optional[str] = None,
    config: dict = None,
    timeout: float = 30.0,
) -> dict:
    """
    Like tom_fetch but uses an explicit config dict instead of env vars.
    Config keys: base_url, api_key_id, hmac_secret, source_code.
    """
    cfg = config or {}
    base_url = cfg.get("base_url", TOM_BASE_URL)
    api_key = cfg.get("api_key_id", TOM_API_KEY_ID)
    secret = cfg.get("hmac_secret", TOM_HMAC_SECRET)

    if not base_url or not api_key or not secret:
        raise RuntimeError("TOM credentials incomplete in provided config.")

    import json
    # Compact JSON serialization (no spaces) ensures hash consistency with TOM spec
    raw_body = json.dumps(body, separators=(',', ':')).encode() if body else b""

    ts = str(int(time.time()))
    body_hash = hashlib.sha256(raw_body).hexdigest()
    canonical = "\n".join([method.upper(), path, ts, body_hash])
    sig = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

    headers = {
        "X-Tom-Key": api_key,
        "X-Tom-Timestamp": ts,
        "X-Tom-Signature": sig,
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    url = f"{base_url}{path}"
    logger.info(f"TOM API (config) {method} {path}")

    async with httpx.AsyncClient(timeout=timeout) as client:
        if method.upper() == "GET":
            response = await client.get(url, headers=headers)
        elif method.upper() == "POST":
            response = await client.post(url, headers=headers, content=raw_body)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")

    try:
        response_body = response.json()
    except Exception:
        response_body = {"raw": response.text}

    return {"status": response.status_code, "body": response_body}
