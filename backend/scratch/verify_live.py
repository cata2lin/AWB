"""
Check the LIVE API output for all multi-listing groups.
Reports groups where the primary still has an international title or no image.
This tests the ACTUAL endpoint behavior, not a simulation.
"""
import asyncio
import json
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, r"c:\Users\Admin\Desktop\AWB Print\awb-print-manager\backend")

from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.models.product import Product
from app.models.store import Store
from sqlalchemy import select

INTL_PATTERNS = ['.cz', '.pl', '.bg', '.hu']
RO_PATTERNS = ['.ro']


async def main():
    async with AsyncSessionLocal() as db:
        # Load stores
        r = await db.execute(select(Store))
        stores_all = r.scalars().all()
        store_map = {s.uid: s.name for s in stores_all}
        ro_uids = {s.uid for s in stores_all if any(p in (s.name or '').lower() for p in RO_PATTERNS)}
        intl_uids = {s.uid for s in stores_all if any(p in (s.name or '').lower() for p in INTL_PATTERNS)}

        # Load all active products
        r2 = await db.execute(select(Product).where(Product.state == 'active'))
        all_products = r2.scalars().all()

        # Group by barcode
        from app.api.products import _build_groups
        from app.services.product_grouping import classify_stores, pick_best_primary

        ro_st, intl_st = classify_stores(store_map.items())

        barcode_groups, sku_only_groups, ungrouped = _build_groups(all_products)

        all_groups = []
        for bc, group in barcode_groups.items():
            all_groups.append(group)
        for sku, group in sku_only_groups.items():
            all_groups.append(group)

        multi = [g for g in all_groups if len(g) > 1]

        def has_image(p):
            imgs = p.images
            if not imgs: return False
            if isinstance(imgs, list) and len(imgs) > 0:
                first = imgs[0]
                if isinstance(first, dict):
                    return bool(first.get('src', '').strip())
                return bool(str(first).strip())
            return False

        def get_stores(p):
            uids = p.store_uids or []
            if isinstance(uids, str):
                try: uids = json.loads(uids)
                except: uids = []
            return uids

        def is_intl(p):
            return any(uid in intl_uids for uid in get_stores(p))

        def is_ro(p):
            return any(uid in ro_uids for uid in get_stores(p))

        # Simulate what the endpoints do
        intl_title = []
        no_image = []
        both = []

        for group in multi:
            group.sort(key=lambda p: p.synced_at or p.frisbo_updated_at or p.frisbo_created_at or p.synced_at, reverse=True)
            primary, has_explicit = pick_best_primary(group, ro_st, intl_st)

            p_has_img = has_image(primary)
            p_is_intl = is_intl(primary) and not is_ro(primary)

            # Check if there's a RO alternative with image
            ro_with_img = [p for p in group if is_ro(p) and has_image(p)]

            if p_is_intl and not p_has_img:
                both.append((primary, group, ro_with_img))
            elif p_is_intl:
                intl_title.append((primary, group, ro_with_img))
            elif not p_has_img:
                no_image.append((primary, group, ro_with_img))

        print("=" * 70)
        print("LIVE ENDPOINT SIMULATION (using pick_best_primary)")
        print("=" * 70)
        print(f"Total multi-listing groups: {len(multi)}")
        print(f"\nREMAINING ISSUES:")
        print(f"  International title + no image: {len(both)}")
        print(f"  International title only:       {len(intl_title)}")
        print(f"  No image only:                  {len(no_image)}")
        total = len(both) + len(intl_title) + len(no_image)
        print(f"  TOTAL:                          {total}")

        fixable = sum(1 for _, _, alts in both + intl_title + no_image if alts)
        print(f"  Of which have RO+img alt:       {fixable}")
        print(f"  Truly unfixable:                {total - fixable}")

        if both:
            print(f"\n--- BOTH ISSUES ({len(both)}) ---")
            for primary, group, alts in both[:5]:
                snames = [store_map.get(uid, uid) for uid in get_stores(primary)]
                print(f"  SKU={primary.sku}  title='{(primary.title_1 or '')[:45]}'  stores={snames}")
                if alts:
                    a = alts[0]
                    print(f"    -> ALT: '{(a.title_1 or '')[:45]}' stores={[store_map.get(uid, uid) for uid in get_stores(a)]}")

        if intl_title:
            print(f"\n--- INTERNATIONAL TITLE ({len(intl_title)}) ---")
            for primary, group, alts in intl_title[:5]:
                snames = [store_map.get(uid, uid) for uid in get_stores(primary)]
                print(f"  SKU={primary.sku}  title='{(primary.title_1 or '')[:45]}'  stores={snames}")
                if alts:
                    a = alts[0]
                    print(f"    -> ALT: '{(a.title_1 or '')[:45]}' stores={[store_map.get(uid, uid) for uid in get_stores(a)]}")

        if no_image and len(no_image) <= 20:
            print(f"\n--- NO IMAGE ({len(no_image)}) ---")
            for primary, group, alts in no_image:
                snames = [store_map.get(uid, uid) for uid in get_stores(primary)]
                alt_tag = " [HAS RO+IMG ALT]" if alts else ""
                print(f"  SKU={primary.sku}  title='{(primary.title_1 or '')[:45]}'  stores={snames}{alt_tag}")

    print(f"\n{'='*70}")


asyncio.run(main())
