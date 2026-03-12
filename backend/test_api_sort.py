"""Verify item_count-based grouping with batch limit."""
import httpx

# Test with limit=200
r = httpx.post(
    'http://localhost:8000/api/print/preview',
    json={'store_uids': None, 'order_uids': None, 'limit': 200},
    timeout=60.0
)
d = r.json()
print(f"Status: {r.status_code}")
print(f"Groups: {d['total_groups']}, Orders: {d['total_orders']}")
total = 0
for g in d['groups']:
    total += g['order_count']
    # Show first 5 orders of each group
    print(f"\n  {g['group_name']} ({g['order_count']} orders, {g['group_color']})")
    for i, o in enumerate(g['orders'][:8]):
        first_sku = '?'
        if o.get('line_items'):
            item = o['line_items'][0]
            first_sku = item.get('sku') or (item.get('inventory_item') or {}).get('sku') or '?'
        print(f"    [{i+1}] #{o['order_number']} | {o['item_count']} items | SKU: {first_sku}")
    if g['order_count'] > 8:
        print(f"    ... and {g['order_count'] - 8} more")

print(f"\nTotal orders in response: {total}")

# Also test without limit to see full distribution
r2 = httpx.post(
    'http://localhost:8000/api/print/preview',
    json={'store_uids': None, 'order_uids': None},
    timeout=60.0
)
d2 = r2.json()
print(f"\nFull distribution ({d2['total_orders']} orders, {d2['total_groups']} groups):")
for g in d2['groups']:
    print(f"  {g['group_name']}: {g['order_count']} orders")
