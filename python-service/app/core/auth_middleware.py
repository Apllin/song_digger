"""Shared-secret middleware for the python-service.

Fail-closed: every request except GET /health must carry
`x-internal-auth: <secret>` or receive a 401. A missing secret is a
misconfiguration (the app refuses to start without it — see app.main), so
a request that reaches the middleware with no secret configured is a loud
500 rather than a silent pass-through.
"""

from __future__ import annotations

import hmac
from typing import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path == "/health":
            return await call_next(request)

        secret = settings.python_service_secret
        if not secret:
            return JSONResponse({"detail": "server auth misconfigured"}, status_code=500)

        provided = request.headers.get("x-internal-auth", "")
        if not hmac.compare_digest(provided, secret):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)

        return await call_next(request)
