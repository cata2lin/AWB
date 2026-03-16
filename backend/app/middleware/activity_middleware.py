"""
Activity tracking middleware.
Logs every API request per authenticated user for activity analytics.
"""
import time
import logging
from datetime import datetime
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.auth import decode_access_token
from app.core.database import AsyncSessionLocal

logger = logging.getLogger("app.middleware.activity")

# Endpoints that don't require auth and shouldn't be tracked heavily
SKIP_PATHS = {"/api/health", "/api/auth/login", "/favicon.ico"}
SKIP_PREFIXES = ("/static", "/assets", "/_next")


class ActivityMiddleware(BaseHTTPMiddleware):
    """Middleware that:
    1. Logs each request per user to user_activity table
    2. Enforces authentication on protected endpoints
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        # Skip static/health
        if path in SKIP_PATHS or any(path.startswith(p) for p in SKIP_PREFIXES):
            return await call_next(request)

        # Extract user from JWT (if present)
        username = "anonymous"
        user_id = None
        token = None

        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            payload = decode_access_token(token)
            if payload:
                username = payload.get("sub", "anonymous")

        # Enforce auth on protected endpoints (everything except login, health)
        is_protected = not (path.startswith("/api/auth/login") or path in SKIP_PATHS)
        if is_protected and username == "anonymous":
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"}
            )

        # Process request
        start = time.time()
        response = await call_next(request)
        duration = time.time() - start

        # Log to DB (fire-and-forget, don't block the response)
        try:
            async with AsyncSessionLocal() as db:
                from app.models.user_activity import UserActivity
                activity = UserActivity(
                    username=username,
                    endpoint=path[:500],
                    method=method,
                    status_code=response.status_code,
                    ip_address=request.client.host if request.client else None,
                    timestamp=datetime.utcnow(),
                )
                db.add(activity)
                await db.commit()
        except Exception as e:
            logger.warning(f"Failed to log activity: {e}")

        return response
