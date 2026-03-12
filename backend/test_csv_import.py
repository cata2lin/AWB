"""
Test the CSV import endpoint with a large file.
Verifies: upload returns immediately, background processing works, progress tracking works.
"""
import asyncio
import time
import httpx

BASE = "http://localhost:8001/api"

async def test_csv_import():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Upload the 100k-row CSV
        print("=== Uploading 100k-row CSV ===")
        start = time.time()
        
        with open("test_100k.csv", "rb") as f:
            response = await client.post(
                f"{BASE}/courier-csv/import",
                files={"file": ("test_100k.csv", f, "text/csv")},
                data={"courier_name": "DPD"},
            )
        
        upload_time = time.time() - start
        print(f"Upload response time: {upload_time:.2f}s")
        print(f"Status code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"ERROR: {response.text}")
            return
        
        result = response.json()
        print(f"Response: {result}")
        import_id = result.get("import_id")
        
        if not import_id:
            print("ERROR: No import_id in response")
            return
        
        # 2. Poll for progress
        print(f"\n=== Polling import #{import_id} progress ===")
        while True:
            await asyncio.sleep(2)
            status_resp = await client.get(f"{BASE}/courier-csv/import/{import_id}/status")
            status = status_resp.json()
            print(f"  Status: {status['status']}, Rows: {status['total_rows']}, Matched: {status['matched_rows']}")
            
            if status["status"] in ("completed", "failed"):
                break
        
        total_time = time.time() - start
        print(f"\n=== DONE in {total_time:.2f}s ===")
        print(f"Final: {status}")


if __name__ == "__main__":
    asyncio.run(test_csv_import())
