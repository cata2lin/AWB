"""Debug k>1 sort: verify the engine's actual sort keys and check if 'breaks' are real."""
import sys, os, asyncio
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(__file__))

async def main():
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select
    from app.models import Order, Rule
    from app.services.rules_engine import RulesEngine, _safe_dt

    store = "75801bb8-54c7-461a-9e82-665c58405876-1749063850-WIUC7717L6"

    async with AsyncSessionLocal() as db:
        # Test k=2 group
        result = await db.execute(
            select(Order).where(
                Order.is_printed == False,
                Order.store_uid == store,
                Order.item_count == 2
            )
        )
        orders_k2 = list(result.scalars().all())
        print(f"=== k=2 orders: {len(orders_k2)} ===")

        engine = RulesEngine(rules=[])

        # Compute sort data the same way the engine does
        sku_freq = defaultdict(int)
        order_skus = {}
        for order in orders_k2:
            skus = engine._extract_skus(order)
            order_skus[order.uid] = skus
            for sku in skus:
                sku_freq[sku] += 1

        # Show SKU frequencies
        print("SKU frequencies:")
        for sku, freq in sorted(sku_freq.items(), key=lambda x: -x[1]):
            print(f"  '{sku}': {freq}")

        # Determine topSku
        top_sku = engine._determine_top_sku(orders_k2, order_skus, sku_freq)
        print(f"\ntopSku: '{top_sku}' (freq={sku_freq.get(top_sku, 0)})")

        # Sort using the engine
        sorted_orders = engine._sort_multi_item_group(orders_k2, order_skus, sku_freq)

        # Show sorted results with their actual sort key components
        print(f"\nSorted order ({len(sorted_orders)} orders):")
        for i, o in enumerate(sorted_orders):
            skus = order_skus.get(o.uid, set())
            has_top = 1 if top_sku and top_sku in skus else 0
            top_count = 0
            if top_sku:
                for item in (o.line_items or []):
                    s = item.get("sku") or (item.get("inventory_item") or {}).get("sku")
                    if s == top_sku:
                        top_count += 1
            dominant = ""
            if skus:
                dominant = min(skus, key=lambda s: (-sku_freq.get(s, 0), s.lower()))

            items = o.line_items or []
            sku_list = []
            for item in items:
                s = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
                sku_list.append(s)

            print(f"  [{i+1:2d}] #{o.order_number} | hasTop={has_top} topCnt={top_count} | dom='{dominant}' | SKUs: {set(sku_list)}")

        # Now check k=3 too (just first 30 for brevity)
        result = await db.execute(
            select(Order).where(
                Order.is_printed == False,
                Order.store_uid == store,
                Order.item_count == 3
            )
        )
        orders_k3 = list(result.scalars().all())
        print(f"\n=== k=3 orders: {len(orders_k3)} ===")

        sku_freq3 = defaultdict(int)
        order_skus3 = {}
        for order in orders_k3:
            skus = engine._extract_skus(order)
            order_skus3[order.uid] = skus
            for s in skus:
                sku_freq3[s] += 1

        top_sku3 = engine._determine_top_sku(orders_k3, order_skus3, sku_freq3)
        print(f"topSku: '{top_sku3}' (freq={sku_freq3.get(top_sku3, 0)})")
        print(f"Top 5 SKU freqs: {sorted(sku_freq3.items(), key=lambda x: -x[1])[:5]}")

        sorted_k3 = engine._sort_multi_item_group(orders_k3, order_skus3, sku_freq3)

        print(f"\nFirst 30 sorted k=3 orders:")
        for i, o in enumerate(sorted_k3[:30]):
            skus = order_skus3.get(o.uid, set())
            has_top = 1 if top_sku3 and top_sku3 in skus else 0
            top_count = 0
            if top_sku3:
                for item in (o.line_items or []):
                    s = item.get("sku") or (item.get("inventory_item") or {}).get("sku")
                    if s == top_sku3:
                        top_count += 1
            dominant = ""
            if skus:
                dominant = min(skus, key=lambda s: (-sku_freq3.get(s, 0), s.lower()))

            items = o.line_items or []
            sku_list = []
            for item in items:
                s = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
                sku_list.append(s)

            print(f"  [{i+1:2d}] #{o.order_number} | hasTop={has_top} topCnt={top_count} | dom='{dominant}' | SKUs: {set(sku_list)}")

asyncio.run(main())
