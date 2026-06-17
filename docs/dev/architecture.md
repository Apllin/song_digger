# Architecture

## Python service (`python-service/app`)

- `main.py` wires FastAPI + CORS (only allows `http://localhost:3000`) and mounts route modules from `api/routes/` (`similar`, `suggestions`, `discogs`, `ytm_playlist`, `play_lookup`). Routes consumed by web set `operation_id="..."` and `response_model=...` so kubb generates a typed client name + Zod schema; without those, kubb falls back to a verbose auto-name and `any` for the response.
- `adapters/` — one module per external source (`bandcamp`, `cosine_club`, `discogs`, `lastfm`, `trackidnet`, `troi`, `yandex_music`, `youtube_music`). All conform to `AbstractAdapter` in [python-service/app/adapters/base.py](../../python-service/app/adapters/base.py) (single `find_similar(query: ParsedQuery, limit)` method — the `/similar` route parses the request into a `ParsedQuery` once and hands it to every adapter, rather than each adapter re-splitting a raw string). Add a new source by implementing this interface and registering it where routes aggregate adapters. Sources are not feature-flagged — an adapter that works contributes, one that doesn't soft-degrades to `[]`. Adapters do **not** cache: the single cache layer is the web-side `SearchQuery` result cache that wraps `/similar` (see the search data flow below). The Discogs adapter is scoped to the `/discography` and `/labels` page routes only — it does not feed `/similar` (see ADR-0019). The Troi adapter (`troi`) runs ListenBrainz's lb-radio patch in-process, returns MusicBrainz recording URLs, and degrades via a per-process circuit breaker (TRA-28); it also contributes a trained weight to the ranking model.
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
2. The route computes a versioned `cacheKey` and checks the **single cache layer** — the most recent `SearchQuery` with that `cacheKey`, `status:"done"`, created within the TTL (14 days). On a **hit** it returns that query's persisted `SearchResult` rows directly (no Python call, no re-fusion). On a **miss** it creates a new `SearchQuery` (`status:"running"`), runs the pipeline synchronously, marks it `"done"`, and returns the first page in the same response.
3. Python route (on a cache miss) fans out to all adapters, each returning `TrackMeta[]`.
4. Web fuses the source lists with `lib/aggregator.ts` (RRF + artist diversification), persists `Track` + `SearchResult` rows (carrying the diversified order as `rank`), and marks the query `"done"`. Dislike filtering and cover enrichment are NOT done here: dislikes are filtered client-side over the returned page (keeps the result user-agnostic and cacheable), and covers are resolved client-side via `/api/cover`.
5. Browser pages through results via `api.search[":id"].$get({ param: { id } })` → GET `/api/search/:id` (the first page comes back on the POST). Reads are a cheap `skip`/`take` over the persisted rows ordered by `rank`.

### Search cache versioning

**Bump `SEARCH_CACHE_VERSION`** (in [web/features/search/searchCache.ts](../../web/features/search/searchCache.ts)) whenever a result should change for a given `(artist, track)`. A cache hit serves the *persisted* rows in their *persisted* order, so the version (part of the key `${SEARCH_CACHE_VERSION}:${normalizedArtist}|${normalizedTrack}`, TTL 14 days) is the invalidation lever. Old keys are never read again — no SQL flush needed.

Triggers a bump: adding/removing an adapter from `/similar`, changing filtering/ordering in `similar.py`, modifying any adapter's `find_similar()` shape, changing `findSimilar` request shape, **or changing `lib/aggregator.ts`** (RRF formula, tiebreaker, diversification — i.e. the persisted order).

Does NOT trigger a bump: cover enrichment (client-side, not part of the cached result) or the client-side dislike filter.
