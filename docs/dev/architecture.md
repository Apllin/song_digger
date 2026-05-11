# Architecture

## Python service (`python-service/app`)

- `main.py` wires FastAPI + CORS (only allows `http://localhost:3000`) and mounts route modules from `api/routes/` (`similar`, `suggestions`, `discogs`, `ytm_playlist`, `play_lookup`). Routes consumed by web set `operation_id="..."` and `response_model=...` so kubb generates a typed client name + Zod schema; without those, kubb falls back to a verbose auto-name and `any` for the response.
- `adapters/` — one module per external source (`bandcamp`, `cosine_club`, `discogs`, `lastfm`, `trackidnet`, `yandex_music`, `youtube_music`). All conform to `AbstractAdapter` in [python-service/app/adapters/base.py](../../python-service/app/adapters/base.py) (single `find_similar(query, limit)` method). Add a new source by implementing this interface and registering it where routes aggregate adapters. The Discogs adapter is scoped to the `/discography` and `/labels` page routes only — it does not feed `/similar` (see ADR-0019).
- `core/models.py` defines the shared `TrackMeta` Pydantic model returned to web.
- `config.py` uses `pydantic-settings` reading the repo-root `.env`; holds tokens for Cosine.club, Discogs, Yandex.Music, Last.fm. `extra="ignore"` so shared web/db env vars in the same file don't break validation.

## Web (`web/`)

- App Router under `app/`. **All `/api/*` routes flow through one Hono app** at [web/lib/hono/app.ts](../../web/lib/hono/app.ts), wired into Next via the catch-all [web/app/api/[[...route]]/route.ts](../../web/app/api/%5B%5B...route%5D%5D/route.ts). The only non-Hono route is `app/api/auth/[...nextauth]/route.ts` (NextAuth owns its own segment). To add an endpoint: write a Hono router at `features/<name>/server/<name>Api.ts`, then chain `.route("/", <name>Api)` on the root app — the typed RPC client picks it up automatically.
- The browser calls `/api/*` through the typed RPC client at [web/lib/hono/client.ts](../../web/lib/hono/client.ts) (`api.<...>.$get/$post/$delete(...)` + `parseResponse` from `hono/client`). Server-to-server calls into Python go through the kubb-generated client at `lib/python-api/generated/clients/`. **Don't add raw `fetch` to either surface** (see [.claude/skills/code/architecture/typed-clients.md](../../.claude/skills/code/architecture/typed-clients.md)).
- `lib/aggregator.ts` — RRF fusion across per-source ranks plus artist diversification (max 2 consecutive). No BPM/key filter, no genre filter, no embed bonus, no artist-level dislike penalty. Runs in Node, not Python.
- `prisma/schema.prisma` — Postgres schema (Track, SearchQuery/SearchResult, Favorite, DislikedTrack, LastfmArtistSimilars; plus the auth tables: User, Account, Session, VerificationCode, PasswordResetToken — see ADR-0020; plus the Stage J security tables: AnonymousRequest, LoginAttempt — see ADR-0021). Prisma client outputs to `app/generated/prisma`, imported via `lib/prisma.ts`. Requires `DATABASE_URL`.
- Client state uses Jotai atoms in `lib/atoms/`.

## Search data flow

1. Browser calls `api.search.$post({ json: { input } })` → POST `/api/search`, handled by the Hono route in [web/features/search/server/searchApi.ts](../../web/features/search/server/searchApi.ts). The route runs the `anonGate` middleware first, then calls `auth()` to capture the current `userId` (or null for anonymous).
2. Web persists a `SearchQuery` via Prisma and returns `{ id, status: "running" }` immediately. The actual work runs as a fire-and-forget background task that looks up the **search response cache** (`ExternalApiCache` row with `source="search_response"`, key versioned by `SEARCH_CACHE_VERSION`, TTL 14 days). On hit, the cached `SimilarResponse` is reused; on miss, web calls the kubb-generated `findSimilar(...)` → `POST {PYTHON_SERVICE_URL}/similar` and writes the result to the cache.
3. Python route (on cache miss) fans out to enabled adapters, each returning `TrackMeta[]`.
4. Web filters out tracks whose `(artistKey, titleKey)` identity is in **the current user's** `DislikedTrack` rows (anonymous = empty set, no filter), fuses with `lib/aggregator.ts` (RRF + artist diversification), persists tracks + results, and updates `SearchQuery.status = "done"`. RRF, dislike filter, and cover enrichment always run fresh — they are not part of the cache.
5. Browser polls `api.search[":id"].$get({ param: { id } })` → GET `/api/search/:id` until `status === "done"`, then renders the result list.

### Search cache versioning

**Bump `SEARCH_CACHE_VERSION`** (in [web/features/search/searchCache.ts](../../web/features/search/searchCache.ts)) whenever you change what `/similar` returns. The cache key is `${SEARCH_CACHE_VERSION}:${normalizedArtist}|${normalizedTrack}`, TTL 14 days. Old keys are never read again — no SQL flush needed.

Triggers a bump: adding/removing an adapter from `/similar`, changing filtering/ordering in `similar.py`, modifying any adapter's `find_similar()` shape, changing `findSimilar` request shape.

Does NOT trigger a bump: `lib/aggregator.ts` changes, dislike filter, `enrichMissingCovers`, `saveTracks` — these run fresh on every request, post-cache.
