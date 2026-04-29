"""
Stock Sync Service — pulls real stock levels from the InventorySync database.

The InventorySync system is the source of truth for stock quantities. It syncs
with Shopify in real-time via webhooks and GraphQL. This service reads its data
and updates the AWB Print Manager's products.stock_available column.

Data flow (from InventorySync docs):
    product_variants (barcode IS NOT NULL, deleted products excluded)
        → inventory_levels (SUM(available) per variant across all locations)
        → Group by barcode, pick is_barcode_primary = TRUE variant's stock

Matching strategy:
    1. Primary: Match by barcode (AWBprint.products.barcode → InventorySync.product_variants.barcode)
    2. Fallback: Match by SKU (AWBprint.products.sku → InventorySync.product_variants.sku)
"""
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.inventory_sync_db import InventorySyncSession

logger = logging.getLogger(__name__)


@dataclass
class StockSyncResult:
    """Result of a stock sync run."""
    total_remote_barcodes: int = 0
    total_remote_skus: int = 0
    matched_by_barcode: int = 0
    matched_by_sku: int = 0
    updated: int = 0
    unmatched: int = 0
    duration_ms: int = 0
    errors: list = field(default_factory=list)


# SQL to pull stock grouped by barcode from InventorySync
# Follows the documented data flow exactly:
#   - Only variants with non-empty barcode
#   - Only non-deleted products
#   - Only primary variants (is_barcode_primary = TRUE)
#   - SUM(inventory_levels.available) across all locations
BARCODE_STOCK_QUERY = text("""
    SELECT pv.barcode,
           COALESCE(SUM(il.available), 0) AS stock
    FROM   product_variants pv
    JOIN   products p ON p.id = pv.product_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id
    WHERE  pv.barcode IS NOT NULL
      AND  pv.barcode != ''
      AND  p.deleted_at IS NULL
      AND  pv.is_barcode_primary = TRUE
    GROUP BY pv.barcode
""")

# Fallback: stock grouped by SKU (for products that can't match by barcode)
SKU_STOCK_QUERY = text("""
    SELECT LOWER(BTRIM(pv.sku)) AS sku_normalized,
           COALESCE(SUM(il.available), 0) AS stock
    FROM   product_variants pv
    JOIN   products p ON p.id = pv.product_id
    LEFT JOIN inventory_levels il ON il.variant_id = pv.id
    WHERE  pv.sku IS NOT NULL
      AND  BTRIM(pv.sku) != ''
      AND  p.deleted_at IS NULL
      AND  pv.is_barcode_primary = TRUE
    GROUP BY LOWER(BTRIM(pv.sku))
""")

# Update AWBprint products stock by barcode
UPDATE_BY_BARCODE = text("""
    UPDATE products
    SET    stock_available = :stock,
           synced_at = :now
    WHERE  barcode = :barcode
      AND  barcode IS NOT NULL
      AND  barcode != ''
      AND  state = 'active'
""")

# Update AWBprint products stock by SKU (fallback)
UPDATE_BY_SKU = text("""
    UPDATE products
    SET    stock_available = :stock,
           synced_at = :now
    WHERE  LOWER(BTRIM(sku)) = :sku_normalized
      AND  sku IS NOT NULL
      AND  BTRIM(sku) != ''
      AND  state = 'active'
      AND  (barcode IS NULL OR barcode = '')
""")


async def sync_stock_from_inventory() -> StockSyncResult:
    """
    Pull stock from InventorySync DB and update AWBprint products.

    Strategy:
        1. Read barcode→stock map from InventorySync
        2. Read sku→stock map from InventorySync (for fallback)
        3. Update AWBprint products by barcode match
        4. Update remaining (barcode-less) AWBprint products by SKU match
    """
    result = StockSyncResult()
    t0 = time.monotonic()
    now = datetime.utcnow()

    logger.info("📊 [STOCK SYNC] Starting stock sync from InventorySync database...")

    try:
        # ── Phase 1: Read stock from InventorySync ──
        barcode_stock: Dict[str, int] = {}
        sku_stock: Dict[str, int] = {}

        async with InventorySyncSession() as inv_db:
            # Barcode stock
            barcode_rows = await inv_db.execute(BARCODE_STOCK_QUERY)
            for row in barcode_rows:
                barcode = row[0]
                stock = row[1] or 0
                if barcode:
                    barcode_stock[barcode] = stock

            # SKU stock (fallback)
            sku_rows = await inv_db.execute(SKU_STOCK_QUERY)
            for row in sku_rows:
                sku_norm = row[0]
                stock = row[1] or 0
                if sku_norm:
                    sku_stock[sku_norm] = stock

        result.total_remote_barcodes = len(barcode_stock)
        result.total_remote_skus = len(sku_stock)

        logger.info(
            f"📊 [STOCK SYNC] Read {result.total_remote_barcodes} barcodes "
            f"and {result.total_remote_skus} SKUs from InventorySync"
        )

        # ── Phase 2: Update AWBprint products ──
        async with AsyncSessionLocal() as awb_db:
            # Barcode match
            for barcode, stock in barcode_stock.items():
                try:
                    update_result = await awb_db.execute(
                        UPDATE_BY_BARCODE,
                        {"barcode": barcode, "stock": stock, "now": now}
                    )
                    rows_affected = update_result.rowcount
                    if rows_affected > 0:
                        result.matched_by_barcode += rows_affected
                        result.updated += rows_affected
                except Exception as e:
                    result.errors.append(f"barcode={barcode}: {e}")

            await awb_db.commit()

            logger.info(
                f"📊 [STOCK SYNC] Barcode phase: {result.matched_by_barcode} products updated"
            )

            # SKU fallback (only products that have no barcode)
            for sku_norm, stock in sku_stock.items():
                try:
                    update_result = await awb_db.execute(
                        UPDATE_BY_SKU,
                        {"sku_normalized": sku_norm, "stock": stock, "now": now}
                    )
                    rows_affected = update_result.rowcount
                    if rows_affected > 0:
                        result.matched_by_sku += rows_affected
                        result.updated += rows_affected
                except Exception as e:
                    result.errors.append(f"sku={sku_norm}: {e}")

            await awb_db.commit()

            logger.info(
                f"📊 [STOCK SYNC] SKU fallback phase: {result.matched_by_sku} products updated"
            )

    except Exception as e:
        logger.error(f"📊 [STOCK SYNC] FAILED: {e}")
        import traceback
        traceback.print_exc()
        result.errors.append(str(e))

    result.duration_ms = int((time.monotonic() - t0) * 1000)

    logger.info(
        f"📊 [STOCK SYNC] COMPLETED in {result.duration_ms}ms — "
        f"barcode: {result.matched_by_barcode}, "
        f"sku: {result.matched_by_sku}, "
        f"total updated: {result.updated}, "
        f"errors: {len(result.errors)}"
    )

    return result
