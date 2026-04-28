"""
System Settings API — runtime-configurable TOM credentials + PO categories.

Settings are stored in the `system_settings` table (key/value).
Falls back to env vars for TOM config if no DB override exists.
"""
import logging
import os
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.system_setting import SystemSetting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

# ── Default PO categories (seeded on first read) ─────────────────────────
DEFAULT_PO_CATEGORIES = [
    {"key": "pajamas", "label": "🌙 Pajamas", "stores": ["nocturna.ro", "nocturnalux.ro", "nocturna.bg"], "tom_enabled": True},
    {"key": "home_garden", "label": "🏠 Home & Garden", "stores": ["grandia.ro", "casaofertelor.ro"], "tom_enabled": True},
    {"key": "beauty", "label": "💅 Beauty", "stores": ["rossinails.ro", "belasil.ro"], "tom_enabled": True},
    {"key": "fashion", "label": "👔 Fashion", "stores": ["georgetalent.ro", "apreciat.ro", "gento.ro"], "tom_enabled": True},
    {"key": "home_textiles", "label": "🧶 Home Textiles", "stores": ["carpetto.ro", "covoria.ro", "bonhaus.pl", "bonhaus.cz", "bonhaus.bg"], "tom_enabled": True},
    {"key": "deals", "label": "🏷️ Deals", "stores": ["reduceribune.ro", "ofertelezilei.ro", "cepatai.ro", "magdeal.ro"], "tom_enabled": True},
    {"key": "oils", "label": "🫒 Oils / Internal", "stores": [], "tom_enabled": False},
]

# Known settings keys
TOM_KEYS = ["tom.base_url", "tom.api_key_id", "tom.hmac_secret", "tom.source_code"]
ENV_DEFAULTS = {
    "tom.base_url": "TOM_BASE_URL",
    "tom.api_key_id": "TOM_API_KEY_ID",
    "tom.hmac_secret": "TOM_HMAC_SECRET",
    "tom.source_code": "TOM_SOURCE_CODE",
}


# ── Pydantic schemas ─────────────────────────────────────────────────────

class SettingUpdate(BaseModel):
    value: Optional[str] = None
    value_json: Optional[dict | list] = None

class TomConfigUpdate(BaseModel):
    base_url: Optional[str] = None
    api_key_id: Optional[str] = None
    hmac_secret: Optional[str] = None
    source_code: Optional[str] = None

class POCategoryItem(BaseModel):
    key: str
    label: str
    stores: List[str] = []
    tom_enabled: bool = True


# ── Helpers ───────────────────────────────────────────────────────────────

async def _get_setting(db: AsyncSession, key: str) -> Optional[SystemSetting]:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    return result.scalar_one_or_none()

async def _upsert_setting(db: AsyncSession, key: str, value: str = None, value_json=None, description: str = None):
    setting = await _get_setting(db, key)
    if setting:
        if value is not None:
            setting.value = value
        if value_json is not None:
            setting.value_json = value_json
        setting.updated_at = datetime.utcnow()
    else:
        setting = SystemSetting(key=key, value=value, value_json=value_json, description=description, updated_at=datetime.utcnow())
        db.add(setting)
    await db.flush()
    return setting


# ── Public helper: get TOM config (DB > env fallback) ────────────────────

async def get_tom_config(db: AsyncSession) -> dict:
    """Read TOM config from DB, falling back to env vars."""
    config = {}
    for key in TOM_KEYS:
        setting = await _get_setting(db, key)
        short = key.replace("tom.", "")
        if setting and setting.value:
            config[short] = setting.value
        else:
            env_key = ENV_DEFAULTS.get(key, "")
            config[short] = os.getenv(env_key, "")
    return config


async def get_po_categories(db: AsyncSession) -> list:
    """Read PO categories from DB, seeding defaults if missing."""
    setting = await _get_setting(db, "po.categories")
    if setting and setting.value_json:
        return setting.value_json
    # Seed defaults
    await _upsert_setting(db, "po.categories", value_json=DEFAULT_PO_CATEGORIES, description="PO category definitions with store groupings")
    return DEFAULT_PO_CATEGORIES


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/tom")
async def get_tom_settings(db: AsyncSession = Depends(get_db)):
    """Get current TOM API configuration (secrets partially masked)."""
    config = await get_tom_config(db)
    # Mask secrets for display
    masked = {**config}
    if masked.get("hmac_secret"):
        s = masked["hmac_secret"]
        masked["hmac_secret"] = s[:8] + "•" * max(0, len(s) - 16) + s[-8:] if len(s) > 16 else "••••"
        masked["hmac_secret_set"] = True
    else:
        masked["hmac_secret_set"] = False
    if masked.get("api_key_id"):
        masked["api_key_id_display"] = masked["api_key_id"]
    # Include source info
    for key in TOM_KEYS:
        short = key.replace("tom.", "")
        setting = await _get_setting(db, key)
        masked[f"{short}_source"] = "database" if (setting and setting.value) else "env"
    return masked


@router.put("/tom")
async def update_tom_settings(body: TomConfigUpdate, db: AsyncSession = Depends(get_db)):
    """Update TOM API configuration. Only non-null fields are updated."""
    updated = []
    if body.base_url is not None:
        await _upsert_setting(db, "tom.base_url", value=body.base_url, description="TOM API base URL")
        updated.append("base_url")
    if body.api_key_id is not None:
        await _upsert_setting(db, "tom.api_key_id", value=body.api_key_id, description="TOM API key identifier (X-Tom-Key header)")
        updated.append("api_key_id")
    if body.hmac_secret is not None:
        await _upsert_setting(db, "tom.hmac_secret", value=body.hmac_secret, description="TOM HMAC-SHA256 signing secret")
        updated.append("hmac_secret")
    if body.source_code is not None:
        await _upsert_setting(db, "tom.source_code", value=body.source_code, description="TOM source app identifier (e.g. VIGO)")
        updated.append("source_code")
    logger.info(f"TOM settings updated: {updated}")
    return {"ok": True, "updated": updated}


@router.get("/tom/test")
async def test_tom_connection(db: AsyncSession = Depends(get_db)):
    """Test TOM API connectivity with current credentials."""
    config = await get_tom_config(db)
    if not config.get("base_url") or not config.get("api_key_id") or not config.get("hmac_secret"):
        return {"ok": False, "error": "TOM credentials not fully configured", "config_status": {
            k: bool(config.get(k)) for k in ["base_url", "api_key_id", "hmac_secret", "source_code"]
        }}
    try:
        from app.services.tom_client import tom_fetch_with_config
        res = await tom_fetch_with_config("GET", "/api/v1/health", None, None, config)
        return {"ok": res["status"] in (200, 404), "status": res["status"], "body": res.get("body")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/po-categories")
async def get_po_categories_endpoint(db: AsyncSession = Depends(get_db)):
    """Get PO category definitions."""
    categories = await get_po_categories(db)
    return {"categories": categories}


@router.put("/po-categories")
async def update_po_categories(categories: List[POCategoryItem], db: AsyncSession = Depends(get_db)):
    """Replace all PO category definitions."""
    cats = [c.model_dump() for c in categories]
    await _upsert_setting(db, "po.categories", value_json=cats, description="PO category definitions with store groupings")
    logger.info(f"PO categories updated: {len(cats)} categories")
    return {"ok": True, "categories": cats}
