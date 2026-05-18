"""
One-time fix: set primary_listing_uid for product groups where the current
auto-picked primary has no image or an international (non-Romanian) title,
and a better Romanian listing with image exists in the same group.
"""
import asyncio
import json
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, r"c:\Users\Admin\Desktop\AWB Print\awb-print-manager\backend")

from sqlalchemy import text
from app.core.database import AsyncSessionLocal

# International store name patterns
INTL_PATTERNS = ['.cz', '.pl', '.bg', '.hu']
RO_PATTERNS = ['.ro']


async def main():
    async with AsyncSessionLocal() as db:
        # 1. Load stores
        r = await db.execute(text("SELECT uid, name FROM stores"))
        stores = {s[0]: s[1] for s in r.fetchall()}
        ro_uids = {uid for uid, name in stores.items() if any(p in (name or '').lower() for p in RO_PATTERNS)}
        intl_uids = {uid for uid, name in stores.items() if any(p in (name or '').lower() for p in INTL_PATTERNS)}

        print(f"RO stores: {len(ro_uids)}")
        print(f"INTL stores: {len(intl_uids)}")

        # 2. Load all active products
        r2 = await db.execute(text("""
            SELECT uid, sku, barcode, title_1, images, store_uids::text,
                   primary_listing_uid, synced_at
            FROM products WHERE state = 'active'
            ORDER BY synced_at DESC NULLS LAST
        """))
        all_products = r2.fetchall()

        # 3. Group by barcode (same logic as _build_groups)
        barcode_groups = {}
        sku_to_barcode = {}
        remaining = []

        for p in all_products:
            bc = (p[2] or '').strip()
            sku = (p[1] or '').strip()
            if bc:
                barcode_groups.setdefault(bc, []).append(p)
                if sku:
                    sku_to_barcode[sku] = bc
            else:
                remaining.append(p)

        sku_only_groups = {}
        for p in remaining:
            sku = (p[1] or '').strip()
            if sku and sku in sku_to_barcode:
                bc = sku_to_barcode[sku]
                barcode_groups[bc].append(p)
            elif sku:
                sku_only_groups.setdefault(sku, []).append(p)

        all_groups = []
        for bc, group in barcode_groups.items():
            all_groups.append(('barcode', bc, group))
        for sku, group in sku_only_groups.items():
            all_groups.append(('sku', sku, group))

        def has_image(p):
            imgs = p[4]
            if not imgs:
                return False
            if isinstance(imgs, str):
                try: imgs = json.loads(imgs)
                except: return False
            if isinstance(imgs, list) and len(imgs) > 0:
                first = imgs[0]
                if isinstance(first, dict):
                    return bool(first.get('src', '').strip())
                return bool(str(first).strip())
            return False

        def get_store_uids(p):
            uids = p[5]
            if not uids:
                return []
            if isinstance(uids, str):
                try: return json.loads(uids)
                except: return []
            return uids if isinstance(uids, list) else []

        def is_ro(p):
            return any(uid in ro_uids for uid in get_store_uids(p))

        def is_intl(p):
            return any(uid in intl_uids for uid in get_store_uids(p))

        # 4. Find groups that need fixing and fix them
        fixed = 0
        skipped = 0

        for gtype, gkey, group in all_groups:
            if len(group) < 2:
                continue

            # Current primary selection
            # Check for user-set primary
            current_primary = group[0]  # first by synced_at DESC
            has_explicit_primary = False
            for p in group:
                if p[6]:  # primary_listing_uid
                    has_explicit_primary = True
                    # Find the actual primary
                    for q in group:
                        if q[0] == p[6]:
                            current_primary = q
                    break

            cp_has_img = has_image(current_primary)
            cp_is_ro = is_ro(current_primary)
            cp_is_intl = is_intl(current_primary)

            needs_fix = False
            if not cp_has_img:
                needs_fix = True
            if cp_is_intl and not cp_is_ro:
                needs_fix = True

            if not needs_fix:
                continue

            # Find best Romanian alternative with image
            ro_with_image = [p for p in group if is_ro(p) and has_image(p)]
            if not ro_with_image:
                # Try RO without image
                ro_any = [p for p in group if is_ro(p)]
                if ro_any and cp_is_intl:
                    # At least fix the international title issue
                    best = ro_any[0]
                else:
                    skipped += 1
                    continue
            else:
                best = ro_with_image[0]

            new_primary_uid = best[0]

            # Update all products in this group
            all_uids = [p[0] for p in group]
            await db.execute(text("""
                UPDATE products
                SET primary_listing_uid = :primary_uid
                WHERE uid = ANY(:uids)
            """), {"primary_uid": new_primary_uid, "uids": all_uids})

            old_title = (current_primary[3] or '')[:40]
            new_title = (best[3] or '')[:40]
            old_stores = [stores.get(uid, uid)[:15] for uid in get_store_uids(current_primary)]
            new_stores = [stores.get(uid, uid)[:15] for uid in get_store_uids(best)]
            print(f"  FIXED {gkey[:20]:20} | '{old_title}' ({old_stores}) -> '{new_title}' ({new_stores})")
            fixed += 1

        await db.commit()

        print(f"\n{'='*60}")
        print(f"RESULTS:")
        print(f"  Fixed:   {fixed} groups")
        print(f"  Skipped: {skipped} groups (no better alternative)")
        print(f"{'='*60}")


asyncio.run(main())
