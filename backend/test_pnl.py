"""Quick test: hit profitability endpoint and check response."""
import urllib.request
import json

try:
    req = urllib.request.Request("http://localhost:8000/api/analytics/profitability?days=30")
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
        pnl = data.get("pnl", {})
        print("=== P&L Response OK ===")
        print(f"Status: {resp.status}")
        
        # Check key fields
        inc = pnl.get("income", {})
        print(f"Gross Sales cu_tva: {inc.get('gross_sales', {}).get('cu_tva', 'MISSING')}")
        print(f"Delivered count: {inc.get('delivered_count', 'MISSING')}")
        print(f"Status breakdown: {pnl.get('status_breakdown', 'MISSING')}")
        
        # Check per-store
        stores = data.get("pnl_by_store", [])
        print(f"\nPer-store P&Ls: {len(stores)}")
        for s in stores:
            print(f"  {s.get('store_name')}: gross={s['income'].get('gross_sales',{}).get('cu_tva',0):.2f}, status_bd={list(s.get('status_breakdown',{}).keys())}")
        
        print("\n=== SUCCESS ===")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
