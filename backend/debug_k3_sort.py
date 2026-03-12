"""Debug k=3 sorting: analyze orders AFTER topSku block to see if secondary clustering works."""
import sys, os, asyncio
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(__file__))

async def main():
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select
    from app.models import Order
    from app.services.rules_engine import RulesEngine, _safe_dt

    store = "75801bb8-54c7-461a-9e82-665c58405876-1749063850-WIUC7717L6"

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Order).where(
                Order.is_printed == False,
                Order.store_uid == store,
                Order.item_count == 3
            )
        )
        orders_k3 = list(result.scalars().all())

    engine = RulesEngine(rules=[])

    # Compute group-level data
    sku_freq = defaultdict(int)
    order_skus = {}
    for order in orders_k3:
        skus = engine._extract_skus(order)
        order_skus[order.uid] = skus
        for s in skus:
            sku_freq[s] += 1

    top_sku = engine._determine_top_sku(orders_k3, order_skus, sku_freq)
    print(f"k=3: {len(orders_k3)} orders, topSku='{top_sku}' (freq={sku_freq[top_sku]})")
    print(f"Top 10 SKU freqs:")
    for sku, freq in sorted(sku_freq.items(), key=lambda x: -x[1])[:10]:
        print(f"  '{sku}': {freq}")

    # Sort and analyze the result
    sorted_orders = engine._sort_multi_item_group(orders_k3, order_skus, sku_freq)

    # Find where topSku block ends
    top_end = 0
    for i, o in enumerate(sorted_orders):
        skus = order_skus.get(o.uid, set())
        if top_sku not in skus:
            top_end = i
            break

    print(f"\nTopSku block ends at position {top_end}")
    print(f"Orders WITH topSku: {top_end}, WITHOUT: {len(sorted_orders) - top_end}")

    # Analyze the non-topSku section (positions top_end to top_end+50)
    print(f"\n=== Orders AFTER topSku block (positions {top_end} to {top_end+30}) ===")
    prev_dom = None
    cluster_breaks = 0
    seen_doms = set()

    for i in range(top_end, min(top_end + 50, len(sorted_orders))):
        o = sorted_orders[i]
        skus = order_skus.get(o.uid, set())
        dominant = ""
        if skus:
            dominant = min(skus, key=lambda s: (-sku_freq.get(s, 0), s.lower()))

        items = o.line_items or []
        sku_list = []
        for item in items:
            s = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
            sku_list.append(s)

        marker = ""
        if prev_dom is not None and dominant != prev_dom:
            if dominant in seen_doms:
                marker = " !!! BREAK !!!"
                cluster_breaks += 1
            else:
                marker = " -- new cluster"
        seen_doms.add(dominant)

        if i < top_end + 30:
            print(f"  [{i+1:4d}] #{o.order_number} | dom='{dominant}' (freq={sku_freq.get(dominant,0)}) | all SKUs: {set(sku_list)}{marker}")
        prev_dom = dominant

    # Now check specific orders from the screenshot
    print(f"\n=== Checking specific orders from screenshot ===")
    for order_num in ["EST104018", "EST104833", "EST105366", "EST106407"]:
        for o in sorted_orders:
            if o.order_number == order_num:
                pos = sorted_orders.index(o)
                skus = order_skus.get(o.uid, set())
                dominant = min(skus, key=lambda s: (-sku_freq.get(s, 0), s.lower())) if skus else "?"
                items = o.line_items or []
                sku_list = []
                for item in items:
                    s = item.get("sku") or (item.get("inventory_item") or {}).get("sku") or "?"
                    sku_list.append(s)
                print(f"  #{order_num} at pos {pos+1} | dom='{dominant}' (freq={sku_freq.get(dominant,0)}) | SKUs: {set(sku_list)}")
                break

    # Count cluster breaks in the entire non-topSku section
    print(f"\n=== Full non-topSku cluster analysis ===")
    prev_dom = None
    seen_doms = set()
    total_breaks = 0
    dom_sequence = []
    for i in range(top_end, len(sorted_orders)):
        o = sorted_orders[i]
        skus = order_skus.get(o.uid, set())
        dominant = min(skus, key=lambda s: (-sku_freq.get(s, 0), s.lower())) if skus else "?"
        dom_sequence.append(dominant)
        if prev_dom is not None and dominant != prev_dom:
            if dominant in seen_doms:
                total_breaks += 1
        seen_doms.add(dominant)
        prev_dom = dominant

    unique_doms = len(set(dom_sequence))
    print(f"  Non-topSku orders: {len(dom_sequence)}")
    print(f"  Unique dominant SKUs: {unique_doms}")
    print(f"  Cluster breaks: {total_breaks}")
    if total_breaks == 0:
        print("  PERFECT: all dominant SKUs are contiguous!")
    else:
        print(f"  {total_breaks} breaks - dominant SKUs are interleaving")

asyncio.run(main())
