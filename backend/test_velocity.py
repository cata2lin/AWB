import urllib.request, json

# Login first
login_data = json.dumps({"username": "admin", "password": "admin"}).encode()
login_req = urllib.request.Request(
    "http://localhost:8000/api/auth/login",
    data=login_data,
    headers={"Content-Type": "application/json"}
)
try:
    with urllib.request.urlopen(login_req, timeout=10) as resp:
        token = json.loads(resp.read())["access_token"]
except Exception as e:
    # Try form data
    import urllib.parse
    data = urllib.parse.urlencode({"username": "admin", "password": "admin"}).encode()
    login_req = urllib.request.Request("http://localhost:8000/api/auth/token", data=data)
    with urllib.request.urlopen(login_req, timeout=10) as resp:
        token = json.loads(resp.read())["access_token"]

print(f"Token: {token[:20]}...")

# Test velocity
url = "http://localhost:8000/api/analytics/sales-velocity?days=10&min_units=500"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
with urllib.request.urlopen(req, timeout=120) as resp:
    d = json.loads(resp.read())
    count = len(d["products"])
    print(f"Products: {count}")
    for p in d["products"][:8]:
        sku = p["sku"]
        sc = p["stores_count"]
        net = p["units_sold"]
        bs = len(p.get("by_store", []))
        sn = p["store_name"][:60]
        print(f"  {sku:30s} stores={sc} net={net:>5} by_store={bs} names={sn}")
