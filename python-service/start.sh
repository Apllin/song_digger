#!/bin/sh
# Production start command for the FastAPI service.
# Single source of truth: invoked by both package.json `start` and Dockerfile CMD.
#
# WEB_CONCURRENCY: process-level workers (default 2 for Railway starter ~1 vCPU;
#   raise on bigger tiers via env, no rebuild needed).
# --proxy-headers + --forwarded-allow-ips='*': Railway terminates TLS upstream
#   and forwards X-Forwarded-*; without these, request.url.scheme is wrong.
# --no-access-log: Railway already logs requests at the edge.
# exec: replace shell so uvicorn becomes PID 1 and receives SIGTERM directly.

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --proxy-headers \
  --forwarded-allow-ips='*' \
  --no-access-log
