"""
Deep analysis: preview store 75801bb8 with limit=1000.
Check every order is in the correct group and SKUs are properly clustered.
"""
import sys, os, asyncio, json
from collections import defaultdict, Counter
sys.path.insert(0, os.path.dirname(__file__))

async def main():
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select, func
    from app.models import Order, Rule
    from app.services.rules_engine import RulesEngine

    async with AsyncSessionLocal() as db:
        # Find the store
        result = await db.execute(
            select(Order.store_uid, func.count()).where(
                Order.is_printed == False
            ).group_by(Order.store_uid)
        )
        stores = result.all()
        print("=== Available stores ===")
        target_store = None
        for store_uid, count in stores:
            marker = ""
            if "75801bb8" in (store_uid or ""):
                target_store = store_uid
                marker = " <== TARGET"
            print(f"  {store_uid}: {count} unprinted orders{marker}")

        if not target_store:
            print("\nERROR: Store with '75801bb8' not found!")
            return

        print(f"\n=== Analyzing store: {target_store} ===")

        # Fetch orders for this store
        result = await db.execute(
            select(Order).where(
                Order.is_printed == False,
                Order.store_uid == target_store
            )
        )
        all_orders = list(result.scalars().all())
        print(f"Total unprinted orders: {len(all_orders)}")

        # Get rules
        rules_result = await db.execute(
            select(Rule).where(Rule.is_active == True).order_by(Rule.priority)
        )
        rules = list(rules_result.scalars().all())
        print(f"Active rules: {len(rules)}")

        # Run engine with limit simulation
        engine = RulesEngine(rules)
        groups = engine.group_orders(all_orders)

        # Apply limit=1000
        LIMIT = 1000
        remaining = LIMIT
        limited_groups = []
        for g in groups:
            if remaining <= 0:
                break
            if len(g["orders"]) <= remaining:
                limited_groups.append(g)
                remaining -= len(g["orders"])
            else:
                g["orders"] = g["orders"][:remaining]
                limited_groups.append(g)
                remaining = 0

        print(f"\n=== Groups (limit={LIMIT}) ===")
        total_shown = 0
        errors = []

        for gi, group in enumerate(limited_groups):
            orders = group["orders"]
            total_shown += len(orders)
            print(f"\n--- Group {gi+1}: {group['name']} ({len(orders)} orders) ---")

            # Check: all orders in this group should have the same item_count
            item_counts = Counter()
            for o in orders:
                item_counts[o.item_count] += 1

            if len(item_counts) > 1:
                errors.append(f"Group '{group['name']}' has MIXED item_counts: {dict(item_counts)}")
                print(f"  !!! MIXED item_counts: {dict(item_counts)}")
            else:
                k = list(item_counts.keys())[0]
                print(f"  All orders have item_count={k} - OK")

            # Check SKU clustering: within group, orders of the same SKU should be consecutive
            prev_primary_sku = None
            seen_skus = set()
            cluster_breaks = 0
            sku_sequence = []

            for o in orders:
                items = o.line_items or []
                skus = set()
                for item in items:
                    sku = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
                    skus.add(sku)

                # For k=1, primary SKU is the only SKU
                primary = sorted(skus)[0] if skus else "?"
                sku_sequence.append(primary)

                if prev_primary_sku is not None and primary != prev_primary_sku:
                    if primary in seen_skus:
                        cluster_breaks += 1
                seen_skus.add(primary)
                prev_primary_sku = primary

            # Show SKU distribution
            sku_dist = Counter(sku_sequence)
            top_skus = sku_dist.most_common(5)
            print(f"  Top SKUs: {top_skus}")

            if cluster_breaks > 0:
                errors.append(f"Group '{group['name']}': {cluster_breaks} SKU cluster breaks (SKU appeared, went away, came back)")
                print(f"  !!! {cluster_breaks} SKU cluster breaks")
                # Show where breaks happen
                prev = None
                seen = set()
                for i, s in enumerate(sku_sequence[:50]):
                    if prev is not None and s != prev and s in seen:
                        print(f"    Break at position {i}: came back to SKU '{s}' after leaving it")
                    seen.add(s)
                    prev = s
            else:
                print(f"  SKU clustering: OK (no breaks)")

            # Show first 10 orders
            print(f"  First 10 orders:")
            for i, o in enumerate(orders[:10]):
                items = o.line_items or []
                sku_list = []
                for item in items:
                    sku = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
                    qty = item.get("quantity", 1)
                    sku_list.append(f"{sku}x{int(qty)}")
                print(f"    [{i+1}] #{o.order_number} | item_count={o.item_count} | unique_sku_count={o.unique_sku_count} | SKUs: {', '.join(sku_list)}")

        # Check group ordering: item_count should be ascending across groups
        print(f"\n=== Group Order Check ===")
        prev_k = 0
        for group in limited_groups:
            if not group["orders"]:
                continue
            k = group["orders"][0].item_count
            if k < prev_k:
                errors.append(f"Groups not in ascending item_count order: {k} after {prev_k}")
                print(f"  !!! Group item_count={k} comes AFTER {prev_k} - WRONG ORDER")
            else:
                print(f"  item_count={k}: OK (ascending)")
            prev_k = k

        print(f"\n=== SUMMARY ===")
        print(f"Total orders shown: {total_shown}")
        print(f"Total groups: {len(limited_groups)}")
        if errors:
            print(f"\n!!! {len(errors)} ERRORS FOUND:")
            for e in errors:
                print(f"  - {e}")
        else:
            print("ALL CHECKS PASSED - grouping and sorting is correct!")

asyncio.run(main())
