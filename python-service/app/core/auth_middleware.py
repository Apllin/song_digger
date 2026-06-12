"""Shared-secret middleware for the python-service.

When PYTHON_SERVICE_SECRET is unset the middleware is a no-op (fail-open),
matching the repo's soft-degradation convention for optional credentials.
When set, every request except GET /health must carry
`x-internal-auth: <secret>` or receive a 401.
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
        secret = settings.python_service_secret
        if not secret:
            return await call_next(request)

        if request.url.path == "/health":
            return await call_next(request)

        provided = request.headers.get("x-internal-auth", "")
        if not hmac.compare_digest(provided, secret):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)

        return await call_next(request)
