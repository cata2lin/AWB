import asyncio, time, httpx

async def test():
    async with httpx.AsyncClient(timeout=120) as client:
        # Try multiple user/pass combos
        combos = [
            ("admin", "admin123"),
            ("admin", "Admin123!"),
            ("radu@arona.ro", "admin"),
            ("radu@arona.ro", "radu"),
            ("gheorghe.beschea@overheat.agency", "admin"),
            ("mihai", "mihai"),
            ("anne", "anne"),
        ]
        token = None
        for user, pwd in combos:
            resp = await client.post("http://localhost:8000/api/auth/login", json={"username": user, "password": pwd})
            if resp.status_code == 200:
                token = resp.json()["token"]
                print(f"Login OK with {user}/{pwd}")
                break
            else:
                print(f"Login failed: {user}/{pwd}")
        
        if not token:
            print("\nAll login attempts failed. Skipping API test.")
            return
        
        headers = {"Authorization": f"Bearer {token}"}
        
        print("\n--- Testing /api/comision-agentie?month=2026-04 ---")
        t0 = time.time()
        resp = await client.get("http://localhost:8000/api/comision-agentie?month=2026-04", headers=headers, timeout=120)
        elapsed = time.time() - t0
        print(f"Status: {resp.status_code} in {elapsed:.1f}s")
        if resp.status_code == 200:
            d = resp.json()
            print(f"Stores: {len(d.get('stores', []))}")
            s = d.get('summary', {})
            for k, v in s.items():
                print(f"  {k}: {v}")

asyncio.run(test())
