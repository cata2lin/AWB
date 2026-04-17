"""
Migration script: Populate frisbo_store_slug for all known stores.

Maps store names to their Frisbo dashboard slugs so the frontend
can link directly to orders in the Frisbo admin panel.

Run once after deploying the frisbo_store_slug column:
    python migrate_store_slugs.py
"""
import asyncio
import logging
from sqlalchemy import select, update
from app.core.database import AsyncSessionLocal
from app.models.store import Store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Mapping: store name (lowercase) → frisbo store slug ──
# These are the /store/{slug}/ paths in the Frisbo dashboard
STORE_SLUG_MAP = {
    # Name-based lookup (case-insensitive)
    "nubra":            "bmuwvv-jy",
    "esteban":          "6f9e22-9d",
    "gt":               "ix5bxc-hr",
    "lab noir":         "31k0py-bi",
    "ofertele zilei":   "ofertelezilei",
    "carpetto":         "nxfer1-n4",
    "covoria":          "bb4nmc-pb",
    "reduceri bune":    "audusp-rf",
    "grandia":          "n12w89-yy",
    "gento":            "cn54vk-uz",
    "apreciat":         "8e3700-d9",
    "mag deal":         "covoareauto-ro",
    "ce pat ai":        "ce-pat-ai",
    "belasil":          "dvk4hu-dq",
    "rossi":            "rossinailsromania",
    "rossinails":       "rossinailsromania",
    "nocturna":         "1eee37-2d",
    "nocturna lux":     "de51c5-b8",
    "nocturna.bg":      "a98a4e-16",
    "casaofertelor":    "bonhaus",
    "bonhaus":          "bonhaus",
    "bonhaus.cz":       "vthuzq-7j",
    "bonghaus.cz":      "vthuzq-7j",
    "bonhaus.bg":       "ux1x6n-n2",
    "bonghaus.bg":      "ux1x6n-n2",
    "bonhaus.pl":       "ux1x6n-n2",
    "bonghaus.pl":      "ux1x6n-n2",
}

# ── UID-based lookup (more reliable — UIDs are exact) ──
STORE_UID_SLUG_MAP = {
    # These map store_uid values directly to Frisbo slugs
    # Will be populated from the DB if UIDs match patterns
}


async def migrate():
    """Update all stores with their Frisbo slugs."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Store))
        stores = result.scalars().all()
        
        updated = 0
        skipped = 0
        
        for store in stores:
            # Try name-based lookup (case-insensitive)
            name_lower = (store.name or "").strip().lower()
            slug = STORE_SLUG_MAP.get(name_lower)
            
            if not slug:
                # Try partial match — store names might have extra text
                for key, val in STORE_SLUG_MAP.items():
                    if key in name_lower or name_lower in key:
                        slug = val
                        break
            
            if slug:
                if store.frisbo_store_slug != slug:
                    store.frisbo_store_slug = slug
                    updated += 1
                    logger.info(f"  ✓ {store.name} (uid={store.uid}) → slug={slug}")
                else:
                    logger.info(f"  = {store.name} already has slug={slug}")
            else:
                skipped += 1
                logger.warning(f"  ✗ {store.name} (uid={store.uid}) — no slug mapping found")
        
        await db.commit()
        logger.info(f"\nDone: {updated} updated, {skipped} skipped (no mapping)")


if __name__ == "__main__":
    asyncio.run(migrate())
