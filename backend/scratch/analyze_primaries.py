"""
Analyze primary listing selection across all product groups.
Find groups where the primary listing has:
  - No image
  - Non-Romanian title (from international stores like .cz, .pl)
  - Both issues
"""
import asyncio
import json
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, r"c:\Users\Admin\Desktop\AWB Print\awb-print-manager\backend")

from sqlalchemy import text
from app.core.database import AsyncSessionLocal


# International store name patterns (non-Romanian)
INTERNATIONAL_PATTERNS = ['.cz', '.pl', '.bg', '.hu', 'czech', 'polish', 'bulgar']

# Romanian store patterns
RO_PATTERNS = ['.ro', 'roman']


async def main():
    async with AsyncSessionLocal() as db:
        # 1. Get all stores to understand the mapping
        r = await db.execute(text("SELECT uid, name FROM stores ORDER BY name"))
        stores = r.fetchall()
        print("=" * 70)
        print("ALL STORES:")
        print("=" * 70)
        ro_uids = set()
        intl_uids = set()
        for s in stores:
            is_ro = any(p in (s[1] or '').lower() for p in RO_PATTERNS)
            is_intl = any(p in (s[1] or '').lower() for p in INTERNATIONAL_PATTERNS)
            label = "RO" if is_ro else ("INTL" if is_intl else "???")
            if is_ro: ro_uids.add(s[0])
            if is_intl: intl_uids.add(s[0])
            print(f"  [{label}] {s[1]}  (uid={s[0][:30]}...)")

        # 2. Get all active products with their data
        r2 = await db.execute(text("""
            SELECT uid, sku, barcode, title_1, title_2, images, store_uids::text,
                   primary_listing_uid, state, stock_available
            FROM products
            WHERE state = 'active'
            ORDER BY barcode, sku
        """))
        all_products = r2.fetchall()
        print(f"\nTotal active products: {len(all_products)}")

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
        ungrouped = []
        for p in remaining:
            sku = (p[1] or '').strip()
            if sku and sku in sku_to_barcode:
                bc = sku_to_barcode[sku]
                barcode_groups[bc].append(p)
            elif sku:
                sku_only_groups.setdefault(sku, []).append(p)
            else:
                ungrouped.append(p)

        all_groups = list(barcode_groups.values()) + list(sku_only_groups.values())
        multi_listing_groups = [g for g in all_groups if len(g) > 1]

        print(f"Total groups: {len(all_groups)}")
        print(f"Groups with 2+ listings: {len(multi_listing_groups)}")

        # 4. Analyze each multi-listing group
        def has_image(p):
            imgs = p[5]
            if not imgs:
                return False
            if isinstance(imgs, str):
                try:
                    imgs = json.loads(imgs)
                except:
                    return False
            if isinstance(imgs, list) and len(imgs) > 0:
                first = imgs[0]
                if isinstance(first, dict):
                    return bool(first.get('src', '').strip())
                return bool(str(first).strip())
            return False

        def get_store_uids(p):
            uids = p[6]
            if not uids:
                return []
            if isinstance(uids, str):
                try:
                    return json.loads(uids)
                except:
                    return []
            return uids if isinstance(uids, list) else []

        def is_ro_product(p):
            """Check if product belongs to a Romanian store."""
            suids = get_store_uids(p)
            return any(uid in ro_uids for uid in suids)

        def is_intl_product(p):
            suids = get_store_uids(p)
            return any(uid in intl_uids for uid in suids)

        def pick_primary(group):
            """Current logic: first product sorted by synced_at DESC, or user-set primary."""
            # Check for user-set primary
            for p in group:
                if p[7]:  # primary_listing_uid
                    for q in group:
                        if q[0] == p[7]:
                            return q
                    break
            # Default: first in group (already sorted by synced_at DESC in DB)
            return group[0]

        no_image_primary = []
        intl_title_primary = []
        both_issues = []
        has_ro_alternative = []

        for group in multi_listing_groups:
            primary = pick_primary(group)
            primary_has_img = has_image(primary)
            primary_is_ro = is_ro_product(primary)
            primary_is_intl = is_intl_product(primary)

            # Check if there's a better Romanian alternative with image
            ro_with_image = [p for p in group if is_ro_product(p) and has_image(p)]

            issue_no_img = not primary_has_img
            issue_intl = primary_is_intl and not primary_is_ro

            if issue_no_img and issue_intl:
                both_issues.append((group, primary, ro_with_image))
            elif issue_no_img:
                no_image_primary.append((group, primary, ro_with_image))
            elif issue_intl:
                intl_title_primary.append((group, primary, ro_with_image))

            if (issue_no_img or issue_intl) and ro_with_image:
                has_ro_alternative.append((group, primary, ro_with_image))

        print(f"\n{'='*70}")
        print(f"ISSUES FOUND IN MULTI-LISTING GROUPS:")
        print(f"{'='*70}")
        print(f"  Primary has NO IMAGE:           {len(no_image_primary)}")
        print(f"  Primary is INTERNATIONAL title:  {len(intl_title_primary)}")
        print(f"  Primary has BOTH issues:         {len(both_issues)}")
        print(f"  ---")
        total_issues = len(no_image_primary) + len(intl_title_primary) + len(both_issues)
        print(f"  TOTAL groups with issues:        {total_issues}")
        print(f"  Of which have RO alternative:    {len(has_ro_alternative)}")

        # Show examples
        def show_group(label, items, max_show=5):
            if not items:
                return
            print(f"\n--- {label} (showing {min(len(items), max_show)}/{len(items)}) ---")
            for group, primary, ro_alts in items[:max_show]:
                sku = primary[1] or '?'
                title = (primary[3] or '')[:50]
                suids = get_store_uids(primary)
                store_names = []
                for s in stores:
                    if s[0] in suids:
                        store_names.append(s[1])
                img_status = "HAS_IMG" if has_image(primary) else "NO_IMG"
                print(f"  SKU={sku}  title='{title}'  stores={store_names}  {img_status}")
                if ro_alts:
                    alt = ro_alts[0]
                    alt_stores = []
                    for s in stores:
                        if s[0] in get_store_uids(alt):
                            alt_stores.append(s[1])
                    print(f"    -> Better RO alt: title='{(alt[3] or '')[:50]}'  stores={alt_stores}  HAS_IMG")

        show_group("BOTH ISSUES (intl + no image)", both_issues)
        show_group("INTERNATIONAL TITLE ONLY", intl_title_primary)
        show_group("NO IMAGE ONLY", no_image_primary)

        # Summary: how many can be auto-fixed
        print(f"\n{'='*70}")
        print(f"AUTO-FIX POTENTIAL:")
        print(f"{'='*70}")
        print(f"  {len(has_ro_alternative)} groups can be auto-fixed (have a RO listing with image)")
        print(f"  {total_issues - len(has_ro_alternative)} groups need manual review (no RO alternative with image)")

    print(f"\n{'='*70}")


asyncio.run(main())
