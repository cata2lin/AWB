"""Quick connectivity test."""
import urllib.request
import time

for host in ["127.0.0.1", "localhost", "0.0.0.0"]:
    url = f"http://{host}:8000/api/health"
    print(f"Testing {url}...", end=" ", flush=True)
    try:
        start = time.time()
        r = urllib.request.urlopen(url, timeout=10)
        elapsed = time.time() - start
        print(f"OK ({r.status}) in {elapsed:.1f}s - {r.read().decode()[:100]}")
    except Exception as e:
        elapsed = time.time() - start
        print(f"FAIL in {elapsed:.1f}s - {type(e).__name__}: {e}")
