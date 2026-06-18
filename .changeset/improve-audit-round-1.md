---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Security and reliability improvements from codebase audit round 1:

- Rate-limit email-verification code and password-reset token guessing (per-IP cap shared with login; verification codes burn after 5 failed attempts). Failed verification now returns a 4xx error
- Shared-secret auth between web and python-service (`PYTHON_SERVICE_SECRET`), fail-closed: the python-service refuses to start without it and rejects unauthenticated requests; `/health` stays public. The web side configures the base URL + auth header once at startup via a central python-api client, so call sites no longer pass them per request
- Pooled httpx clients in SoundCloud/trackid.net adapters and graceful client shutdown via FastAPI lifespan
- Generic error details instead of raw exception text in python-service route handlers
- CI now runs `pnpm typecheck`; cross-language parity test guards the TS/Python genre map; dropped unused aiohttp; replaced deprecated `datetime.utcnow()`
