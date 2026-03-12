"""
Test script to directly call Frisbo API and save response.
"""
import asyncio
import httpx
import json

FRISBO_URL = "https://ingest.apis.store-view.frisbo.dev"
FRISBO_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Njk1OTIxMDcsIm9yZ2FuaXphdGlvbl91aWQiOiIwNWZmMThkNi04ZWZkLTQzY2EtYjQwMy02ZWM2Y2ZkODdjMDMtMTc0OTA2Mzg0OS1PT0wxRUZPT1pLIn0.wQD37xVV78WPlsJZX9RLGw498QE7XMGLYUaDoChbAJM"

async def test_frisbo_api():
    headers = {
        "Authorization": f"Bearer {FRISBO_TOKEN}",
        "Content-Type": "application/json"
    }
    
    url = f"{FRISBO_URL}/orders/search"
    params = {"skip": 0, "limit": 10}
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(url, headers=headers, params=params)
        
        # Save full response for analysis
        with open("frisbo_response.json", "w", encoding="utf-8") as f:
            f.write(response.text)
        
        # Analyze structure
        data = response.json()
        
        analysis = {
            "status_code": response.status_code,
            "response_type": str(type(data)),
            "top_level_keys": list(data.keys()) if isinstance(data, dict) else "N/A (list)",
        }
        
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, list):
                    analysis[f"key_{key}_type"] = f"list[{len(value)}]"
                    if value and isinstance(value[0], dict):
                        analysis[f"key_{key}_first_item_keys"] = list(value[0].keys())
                elif isinstance(value, dict):
                    analysis[f"key_{key}_type"] = f"dict with keys: {list(value.keys())}"
                else:
                    analysis[f"key_{key}"] = value
        elif isinstance(data, list):
            analysis["list_length"] = len(data)
            if data and isinstance(data[0], dict):
                analysis["first_item_keys"] = list(data[0].keys())
        
        with open("frisbo_analysis.json", "w", encoding="utf-8") as f:
            json.dump(analysis, f, indent=2, default=str)
        
        print("DONE - check frisbo_response.json and frisbo_analysis.json")

if __name__ == "__main__":
    asyncio.run(test_frisbo_api())
