---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Security and reliability improvements from codebase audit round 1:

- Rate-limit email-verification code and password-reset token guessing (per-IP cap shared with login; verification codes burn after 5 failed attempts)
- Shared-secret auth between web and python-service (`PYTHON_SERVICE_SECRET`, fail-open when unset; `/health` stays public)
- Pooled httpx clients in SoundCloud/trackid.net adapters and graceful client shutdown via FastAPI lifespan
- Generic error details instead of raw exception text in python-service route handlers
- CI now runs `pnpm typecheck`; cross-language parity test guards the TS/Python genre map; dropped unused aiohttp; replaced deprecated `datetime.utcnow()`
