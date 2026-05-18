---
description: Kill the running Vite dev server and restart it
---

Restart the frontend dev server.

1. Kill any running node.exe processes (vite runs under node):
   ```
   taskkill /F /IM node.exe /T
   ```
   (non-zero exit is fine — means nothing was running)

2. Start vite in the background from the `frontend/` directory:
   ```
   npm run dev
   ```
   Use `run_in_background: true`.

3. Wait 3 seconds, then verify with `curl.exe -s -o NUL -w "%{http_code}\n" http://localhost:5173/` — expect HTTP 200.

4. If the page doesn't respond, read the background process output to surface the error.

Report the URL and status.
