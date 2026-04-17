"""
Migration script: Add frisbo_store_slug column and populate Shopify slugs.

Creates the column if missing, then updates all stores with their slugs.
Can be run directly — connects to the live database.

    python migrate_store_slugs.py
"""
import asyncio
import logging
from sqlalchemy import text
from app.core.database import AsyncSessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Mapping: store name (lowercase) → shopify admin slug ──
STORE_SLUG_MAP = {
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


async def migrate():
    async with AsyncSessionLocal() as db:
        # ── Step 1: Add column if it doesn't exist ──
        logger.info("Step 1: Ensuring frisbo_store_slug column exists...")
        await db.execute(text("""
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'stores' AND column_name = 'frisbo_store_slug'
                ) THEN
                    ALTER TABLE stores ADD COLUMN frisbo_store_slug VARCHAR(255);
                    RAISE NOTICE 'Column frisbo_store_slug added';
                ELSE
                    RAISE NOTICE 'Column frisbo_store_slug already exists';
                END IF;
            END $$;
        """))
        await db.commit()
        logger.info("  ✓ Column ready")

        # ── Step 2: Fetch all stores ──
        logger.info("Step 2: Fetching stores...")
        result = await db.execute(text("SELECT id, uid, name, frisbo_store_slug FROM stores"))
        stores = result.fetchall()
        logger.info(f"  Found {len(stores)} stores")

        # ── Step 3: Update each store ──
        logger.info("Step 3: Updating slugs...")
        updated = 0
        skipped = 0

        for store_id, store_uid, store_name, current_slug in stores:
            name_lower = (store_name or "").strip().lower()
            slug = STORE_SLUG_MAP.get(name_lower)

            # Try partial match if exact not found
            if not slug:
                for key, val in STORE_SLUG_MAP.items():
                    if key in name_lower or name_lower in key:
                        slug = val
                        break

            if slug:
                if current_slug != slug:
                    await db.execute(
                        text("UPDATE stores SET frisbo_store_slug = :slug WHERE id = :id"),
                        {"slug": slug, "id": store_id}
                    )
                    updated += 1
                    logger.info(f"  ✓ {store_name} (uid={store_uid}) → slug={slug}")
                else:
                    logger.info(f"  = {store_name} already has slug={slug}")
            else:
                skipped += 1
                logger.warning(f"  ✗ {store_name} (uid={store_uid}) — no slug mapping found")

        await db.commit()
        logger.info(f"\nDone: {updated} updated, {skipped} skipped")


if __name__ == "__main__":
    asyncio.run(migrate())
