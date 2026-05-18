"""
Deep investigation of HA-0002 stock in InventorySync.
Check all variants, their primary status, and per-location stock.
"""
import asyncio
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, r"c:\Users\Admin\Desktop\AWB Print\awb-print-manager\backend")

from sqlalchemy import text
from app.core.inventory_sync_db import InventorySyncSession


BARCODE = "3069941526768"
SKU = "HA-0002"


async def main():
    print(f"{'='*70}")
    print(f"Deep stock investigation for BARCODE={BARCODE}  SKU={SKU}")
    print(f"{'='*70}\n")

    async with InventorySyncSession() as inv_db:
        # 1. All variants for this barcode
        print("1. ALL variants with this barcode:")
        r1 = await inv_db.execute(text("""
            SELECT pv.id, pv.barcode, pv.sku, pv.is_barcode_primary,
                   p.title, p.deleted_at
            FROM   product_variants pv
            JOIN   products p ON p.id = pv.product_id
            WHERE  pv.barcode = :barcode
            ORDER BY pv.is_barcode_primary DESC, pv.id
        """), {"barcode": BARCODE})
        variants = r1.fetchall()
        for v in variants:
            status = "DELETED" if v[5] else "active"
            print(f"  variant_id={v[0]}  barcode={v[1]}  sku={v[2]}  is_primary={v[3]}  product='{v[4]}'  status={status}")

        # 2. Per-location stock for each variant
        print(f"\n2. Per-location inventory levels:")
        for v in variants:
            r2 = await inv_db.execute(text("""
                SELECT il.variant_id, il.available, il.location_id
                FROM   inventory_levels il
                WHERE  il.variant_id = :vid
            """), {"vid": v[0]})
            levels = r2.fetchall()
            total = sum(l[1] or 0 for l in levels)
            print(f"  variant_id={v[0]} (sku={v[2]}, primary={v[3]}):")
            for l in levels:
                print(f"    location_id={l[2]}  available={l[1]}")
            print(f"    TOTAL = {total}")

        # 3. What the stock sync query WOULD return (with is_barcode_primary=TRUE)
        print(f"\n3. Stock sync query result (is_barcode_primary=TRUE):")
        r3 = await inv_db.execute(text("""
            SELECT pv.barcode,
                   COALESCE(SUM(il.available), 0) AS stock
            FROM   product_variants pv
            JOIN   products p ON p.id = pv.product_id
            LEFT JOIN inventory_levels il ON il.variant_id = pv.id
            WHERE  pv.barcode = :barcode
              AND  p.deleted_at IS NULL
              AND  pv.is_barcode_primary = TRUE
            GROUP BY pv.barcode
        """), {"barcode": BARCODE})
        sync_rows = r3.fetchall()
        if not sync_rows:
            print("  >>> NO RESULTS - this barcode is SKIPPED by stock sync!")
            print("  >>> None of the variants have is_barcode_primary=TRUE")
        for row in sync_rows:
            print(f"  barcode={row[0]}  stock={row[1]}")

        # 4. What about without the primary filter?
        print(f"\n4. Stock WITHOUT primary filter (all active variants):")
        r4 = await inv_db.execute(text("""
            SELECT pv.barcode,
                   COALESCE(SUM(il.available), 0) AS stock
            FROM   product_variants pv
            JOIN   products p ON p.id = pv.product_id
            LEFT JOIN inventory_levels il ON il.variant_id = pv.id
            WHERE  pv.barcode = :barcode
              AND  p.deleted_at IS NULL
            GROUP BY pv.barcode
        """), {"barcode": BARCODE})
        for row in r4.fetchall():
            print(f"  barcode={row[0]}  stock={row[1]}")

        # 5. Count how many barcodes have NO primary variant
        print(f"\n5. How many barcodes have NO primary variant?")
        r5 = await inv_db.execute(text("""
            SELECT COUNT(DISTINCT bc_all.barcode) AS total_barcodes,
                   COUNT(DISTINCT bc_primary.barcode) AS with_primary
            FROM (
                SELECT DISTINCT pv.barcode
                FROM product_variants pv
                JOIN products p ON p.id = pv.product_id
                WHERE pv.barcode IS NOT NULL AND pv.barcode != ''
                  AND p.deleted_at IS NULL
            ) bc_all
            LEFT JOIN (
                SELECT DISTINCT pv.barcode
                FROM product_variants pv
                JOIN products p ON p.id = pv.product_id
                WHERE pv.barcode IS NOT NULL AND pv.barcode != ''
                  AND p.deleted_at IS NULL
                  AND pv.is_barcode_primary = TRUE
            ) bc_primary ON bc_all.barcode = bc_primary.barcode
        """))
        row = r5.fetchone()
        total = row[0]
        with_primary = row[1]
        missing = total - with_primary
        print(f"  Total barcodes: {total}")
        print(f"  With primary:   {with_primary}")
        print(f"  MISSING primary: {missing}  ({round(missing/total*100, 1)}%)")

    print(f"\n{'='*70}")


asyncio.run(main())
