"""Per-request cost telemetry for the FastAPI service.

Adds `X-Process-Time-Ms` and `X-Process-Cpu-Ms` headers to every response so
the web tier can attribute Python cost per call, and emits one structured log
line per request so cost ranking is greppable without a log aggregator.

`time.process_time()` measures CPU time the calling process has spent on the
CPU since program start; the diff between request start and end gives the
request's CPU. With multiple concurrent requests on a single worker this
will over-count (CPU spent on other requests during this one's `await`
points lands in the diff), but for the low-concurrency single-uvicorn-worker
dev setup it's a useful upper-bound signal.
"""

from __future__ import annotations

import time
from typing import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        start_wall = time.perf_counter()
        start_cpu = time.process_time()

        response = await call_next(request)

        duration_ms = (time.perf_counter() - start_wall) * 1000.0
        cpu_ms = (time.process_time() - start_cpu) * 1000.0

        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.1f}"
        response.headers["X-Process-Cpu-Ms"] = f"{cpu_ms:.1f}"

        print(
            f"[metrics] {request.method} {request.url.path} "
            f"status={response.status_code} "
            f"duration_ms={duration_ms:.1f} cpu_ms={cpu_ms:.1f}",
            flush=True,
        )

        return response
