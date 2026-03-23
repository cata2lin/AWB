"""Check what Frisbo actually returns for kit-3x-lavanda state."""
import asyncio, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.core.config import settings
from app.services.frisbo.client import FrisboClient


async def check():
    org_tokens = settings.get_org_tokens()
    for org in org_tokens:
        client = FrisboClient(token=org.get("token", ""), org_name=org.get("name", "default"))
        skip = 0
        found = False
        
        while not found:
            result = await client.search_products(skip=skip, limit=100)
            if not isinstance(result, dict):
                break
            data = result.get("data", {})
            items = data.get("inventory_items", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            
            if not items:
                break
            
            for item in items:
                codes = item.get("codes", []) or []
                sku = next((c.get("value") for c in codes if isinstance(c, dict) and c.get("key") == "sku"), None)
                
                if sku and "lavanda" in sku.lower():
                    found = True
                    title = item.get("title_1", "?")
                    state = item.get("state", "NOT_IN_RESPONSE")
                    uid = item.get("uid", "?")
                    
                    print(f"=== Found: {sku} ===")
                    print(f"  UID:   {uid}")
                    print(f"  Title: {title}")
                    print(f"  State: '{state}'")
                    
                    # Print ALL fields that might relate to status
                    for key in sorted(item.keys()):
                        val = item[key]
                        if key in ("state", "status", "published", "published_at", 
                                   "visibility", "active", "draft", "archived"):
                            print(f"  {key}: {val}")
                    print()
            
            skip += 100
            if len(items) < 100:
                break
        
        if not found:
            print(f"No lavanda products found in org '{org.get('name')}'")

asyncio.run(check())
