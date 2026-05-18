---
description: Kill the running uvicorn backend and restart it on port 8000
---

Restart the backend server.

1. Kill any running python.exe / uvicorn processes:
   ```
   taskkill /F /IM python.exe /T
   ```
   (it's fine if this exits non-zero — means nothing was running)

2. Start the backend in the background from the project's `backend/` directory:
   ```
   ./venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   Use `run_in_background: true` so it doesn't block.

3. Wait 5 seconds, then verify with `curl.exe -s http://127.0.0.1:8000/api/health`.
   Expected response: `{"status":"healthy","version":"1.0.0"}`.

4. If the health check fails, read the background process output to surface the error.

Report the final state — running PID or the startup error.
