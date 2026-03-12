"""Verify: marketing cu_tva == fara_tva (no TVA), per-store gross_sales present."""
import httpx

r = httpx.get('http://localhost:8000/api/analytics/profitability',
    params={'date_from': '2026-01-01', 'date_to': '2026-01-31',
            'store_uids': '75801bb8-54c7-461a-9e82-665c58405876-1749063850-WIUC7717L6'},
    timeout=120)
d = r.json()
pnl = d['pnl']
mkt = pnl['marketing']

print("=== MARKETING TVA CHECK (should be cu_tva == fara_tva) ===")
for k in ['facebook', 'tiktok', 'google', 'total']:
    v = mkt[k]
    ok = "✅" if v['cu_tva'] == v['fara_tva'] else "❌"
    print(f"  {ok} {k}: cu_tva={v['cu_tva']}  fara_tva={v['fara_tva']}")

print()
print("=== PER-STORE GROSS SALES ===")
for s in d.get('pnl_by_store', [])[:2]:
    inc = s['income']
    print(f"Store: {s['store_name']}")
    print(f"  gross_sales: {inc.get('gross_sales')}")
    print(f"  returns_cancelled: {inc.get('returns_cancelled')}")
    print(f"  returns_count: {inc.get('returns_cancelled_count')}")
    print(f"  delivered: {inc['sales_delivered']}")
    print()

print("=== BUSINESS COSTS BY SECTION ===")
bcs = pnl.get('business_costs_by_section', {})
for section, items in bcs.items():
    print(f"  {section}: {len(items)} items")
