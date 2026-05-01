# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo layout

pnpm workspace + Turborepo. Two packages:

- `web/` — Next.js 16 app (React 19, Prisma 7, Tailwind v4, Jotai, Zod). User-facing UI + thin API routes.
- `python-service/` — FastAPI service. Owns all external-source scraping/aggregation and music-feature heuristics.

The Next app talks to the Python service over HTTP (`PYTHON_SERVICE_URL`, default `http://localhost:8000`) via [web/lib/python-client.ts](web/lib/python-client.ts). Postgres is shared infra owned by `web` through Prisma.

## Commands

Run from repo root; Turbo fans out to the right workspace. Single-package commands should be run inside the workspace directory.

```bash
pnpm install                    # install JS deps across workspaces
pnpm setup                      # creates python-service/.venv and installs requirements.txt
pnpm dev                        # runs web + python-service together (turbo, persistent)
pnpm build                      # next build (web only)
pnpm lint                       # eslint in web
pnpm test                       # pytest in python-service

# Python service, targeted
cd python-service
.venv/bin/pytest tests/test_similar.py           # one file
.venv/bin/pytest -k bandcamp                     # by keyword
.venv/bin/uvicorn app.main:app --reload          # run service standalone

# Web, targeted
cd web
pnpm dev                        # next dev on :3000
pnpm exec prisma migrate dev    # apply migrations against DATABASE_URL
pnpm exec prisma generate       # regenerate client into app/generated/prisma
```

Postgres runs via `docker-compose up postgres` (or the full stack with `docker-compose up`). Copy `.env.example` to `.env` first — the compose file reads `POSTGRES_*`, and the web/python services read `DATABASE_URL`, `PYTHON_SERVICE_URL`, `COSINE_CLUB_API_KEY`, `YANDEX_MUSIC_TOKEN`. There is a single shared `.env` at the repo root; `python-service/app/config.py` resolves it via an absolute path so it works regardless of cwd.

## Architecture

### Python service (`python-service/app`)

- `main.py` wires FastAPI + CORS (only allows `http://localhost:3000`) and mounts route modules from `api/routes/` (`similar`, `random`, `suggestions`, `discogs`, `ytm_playlist`).
- `adapters/` — one module per external source (`bandcamp`, `beatport`, `cosine_club`, `discogs`, `yandex_music`, `youtube_music`). All conform to `AbstractAdapter` in [python-service/app/adapters/base.py](python-service/app/adapters/base.py) (`find_similar`, `random_techno_track`). Add a new source by implementing this interface and registering it where routes aggregate adapters.
- `core/models.py` defines the shared `TrackMeta` Pydantic model returned to web.
- `config.py` uses `pydantic-settings` reading the repo-root `.env`; holds tokens for Cosine.club, Discogs, Yandex.Music. `extra="ignore"` so shared web/db env vars in the same file don't break validation.

### Web (`web/`)

- App Router under `app/`. API routes under `app/api/*/route.ts` are Next's thin layer — most heavy lifting lives in `lib/` and is proxied to the Python service.
- `lib/python-client.ts` is the single typed boundary to the Python service; keep request/response shapes in sync with `python-service/app/core/models.py` and the route handlers.
- `lib/aggregator.ts` — ranking/blending logic combining source track features with liked/disliked feedback (centroid blend with caps). This runs in Node, not Python.
- `prisma/schema.prisma` — Postgres schema (Track, SearchQuery/SearchResult, Favorite, DislikedTrack, Playlist). Prisma client outputs to `app/generated/prisma`, imported via `lib/prisma.ts`. Requires `DATABASE_URL`.
- Client state uses Jotai atoms in `lib/atoms/`.

### Data flow for a similarity search

1. User query hits `web/app/api/search/route.ts`.
2. Web may persist a `SearchQuery` via Prisma, then calls `fetchSimilarTracks` → `POST {PYTHON_SERVICE_URL}/similar`.
3. Python route fans out to enabled adapters, each returning `TrackMeta[]`.
4. Web re-ranks results with `lib/aggregator.ts` using favorites/dislikes pulled from Postgres, then returns to the client.

## Project-specific gotchas

- **Next.js 16 is not the Next you know.** Per [web/AGENTS.md](web/AGENTS.md): APIs, conventions, and file structure may differ from your training data. Before writing or modifying Next.js code, read the relevant guide in `web/node_modules/next/dist/docs/` and heed deprecation notices.
- **Prisma 7** (also newer than training data in many cases) — generated client lives at `web/app/generated/prisma`, not the default `node_modules/@prisma/client` location. Use `@prisma/adapter-pg` (Prisma + node-postgres driver adapter), not the default engine.
- Python tests use `asyncio_mode = auto` — don't manually decorate with `@pytest.mark.asyncio`.
- The service assumes the frontend origin is `http://localhost:3000` in two places: FastAPI CORS and YouTube embed URLs (`settings.frontend_origin`). Change both together if the port moves.
