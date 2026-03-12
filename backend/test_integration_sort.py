"""Quick integration test: call print preview API and show groups."""
import sys, os, json, asyncio
sys.path.insert(0, os.path.dirname(__file__))

async def main():
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select, func
    from app.models import Order, Rule
    from app.services.rules_engine import RulesEngine

    async with AsyncSessionLocal() as db:
        # Count unprinted orders
        count_q = await db.execute(select(func.count()).where(Order.is_printed == False))
        total = count_q.scalar()
        print(f"Total unprinted orders: {total}")

        # Get orders
        result = await db.execute(
            select(Order).where(Order.is_printed == False).limit(200)
        )
        orders = result.scalars().all()

        # Get rules
        rules_result = await db.execute(select(Rule).where(Rule.is_active == True).order_by(Rule.priority))
        rules = rules_result.scalars().all()
        print(f"Active rules: {len(rules)}")

        # Run engine
        engine = RulesEngine(rules)
        groups = engine.group_orders(list(orders))

        print(f"\nSmart Sort Result: {len(groups)} groups")
        print("=" * 70)
        for g in groups:
            print(f"\n  Group: {g['name']}  (color: {g['color']})")
            print(f"  Orders: {len(g['orders'])}")
            # Show first 5 orders
            for i, o in enumerate(g['orders'][:5]):
                skus = []
                for item in (o.line_items or []):
                    sku = item.get('sku') or (item.get('inventory_item') or {}).get('sku') or '?'
                    qty = item.get('quantity', 1)
                    skus.append(f"{sku} x{qty}")
                print(f"    [{i+1}] {o.uid[:12]}.. | {o.order_number} | SKUs: {', '.join(skus)} | unique_sku_count={o.unique_sku_count}")
            if len(g['orders']) > 5:
                print(f"    ... and {len(g['orders']) - 5} more")

asyncio.run(main())
