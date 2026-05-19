"""
Backfill primary_listing_uid for every product group where no member has it set.

For groups with no user choice, picks the best display primary
(Romanian title + image > Romanian > any+image > most-recently synced)
using the canonical `pick_best_primary` heuristic, then persists that choice
to ALL products in the group so the grouped views and PO picker show the
correct image and Romanian title by default.

Safe to re-run: groups where any member already has primary_listing_uid set
are skipped (user overrides are preserved).

Run: python migrate_primary_listing_backfill.py
"""

import asyncio
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.product import Product
from app.models.store import Store
from app.services.product_grouping import classify_stores, pick_best_primary


async def backfill(db: AsyncSession) -> None:
    # 1. Load stores → classify into Romanian / International UIDs.
    store_rows = (await db.execute(select(Store.uid, Store.name))).all()
    ro_uids, intl_uids = classify_stores([(s.uid, s.name) for s in store_rows])
    print(f"Romanian stores: {len(ro_uids)}    International stores: {len(intl_uids)}")

    # 2. Load all active products, ordered so the most-recent-synced is first
    #    (matches the assumption pick_best_primary makes about input ordering).
    res = await db.execute(
        select(Product)
        .where(Product.state == "active")
        .order_by(Product.synced_at.desc().nullslast()),
    )
    products = list(res.scalars().all())
    uid_to_product = {p.uid: p for p in products}
    print(f"Active products: {len(products)}")

    # 3. Group by barcode (with SKU fallback when no barcode).
    barcode_groups: dict[str, list[Product]] = {}
    sku_to_barcode: dict[str, str] = {}
    remaining: list[Product] = []
    for p in products:
        bc = (p.barcode or "").strip()
        sku = (p.sku or "").strip()
        if bc:
            barcode_groups.setdefault(bc, []).append(p)
            if sku:
                sku_to_barcode[sku] = bc
        else:
            remaining.append(p)

    sku_only_groups: dict[str, list[Product]] = {}
    for p in remaining:
        sku = (p.sku or "").strip()
        if sku and sku in sku_to_barcode:
            barcode_groups[sku_to_barcode[sku]].append(p)
        elif sku:
            sku_only_groups.setdefault(sku, []).append(p)

    all_groups: list[tuple[str, str, list[Product]]] = []
    for bc, g in barcode_groups.items():
        all_groups.append(("barcode", bc, g))
    for sk, g in sku_only_groups.items():
        all_groups.append(("sku", sk, g))

    # 4. For each group with no explicit primary anywhere, persist the auto-pick.
    backfilled = 0
    user_set = 0
    singletons = 0
    no_change = 0

    for _gtype, _gkey, group in all_groups:
        if len(group) < 2:
            singletons += 1
            continue
        if any(p.primary_listing_uid for p in group):
            user_set += 1
            continue

        best, _ = pick_best_primary(group, ro_uids, intl_uids, uid_to_product)
        if not best:
            no_change += 1
            continue

        group_uids = [p.uid for p in group]
        await db.execute(
            update(Product)
            .where(Product.uid.in_(group_uids))
            .values(primary_listing_uid=best.uid),
        )
        backfilled += 1
        if backfilled <= 25:
            store_names = []
            for uid in (best.store_uids or [])[:3]:
                for s in store_rows:
                    if s.uid == uid:
                        store_names.append((s.name or "")[:18])
                        break
            print(
                f"  set {best.uid[:12]:<12} ({(best.title_1 or '')[:35]:<35}) "
                f"stores={store_names} for {_gtype}={_gkey[:18]} ({len(group)} members)"
            )

    await db.commit()

    print()
    print("=" * 60)
    print(f"Backfilled (auto-picked):      {backfilled}")
    print(f"Already user-set (preserved):  {user_set}")
    print(f"Singletons skipped:            {singletons}")
    print(f"No-change groups:              {no_change}")
    print("=" * 60)


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await backfill(db)


if __name__ == "__main__":
    asyncio.run(main())
