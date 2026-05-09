# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code conventions (read first)

**Before writing or modifying any code, invoke the `code` skill.** It loads only the rule files relevant to the change — feature folders, file/folder naming, typed API clients (Hono RPC + kubb-generated python-service client), TypeScript conventions (Zod as source of truth, etc.), React conventions, CSS/Tailwind. See [.claude/skills/code/SKILL.md](.claude/skills/code/SKILL.md).

The skill is the source of truth for **how** we write code. This file (CLAUDE.md) is the source of truth for **what** exists in the codebase. They're complementary — read this for context, then defer to the skill for conventions.

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
pnpm test                       # pytest in python-service (default unit tests only)

# Python service, targeted
cd python-service
.venv/bin/pytest tests/test_similar.py           # one file
.venv/bin/pytest -k bandcamp                     # by keyword
.venv/bin/pytest -m smoke                        # live-network smoke (opt-in)
.venv/bin/pytest -m speed                        # latency tests (opt-in, sequential)
.venv/bin/uvicorn app.main:app --reload          # run service standalone

# Web, targeted
cd web
pnpm dev                        # next dev on :3000
pnpm test                       # vitest unit tests (default)
pnpm test:smoke                 # /api/search + dislike + aggregator smoke (needs dev servers)
pnpm test:speed                 # latency thresholds (needs dev servers + Postgres)
pnpm test:all                   # unit + smoke + speed in sequence
pnpm exec prisma migrate dev    # apply migrations against DATABASE_URL
pnpm exec prisma generate       # regenerate client into app/generated/prisma
```

Postgres runs via `docker-compose up postgres` (or the full stack with `docker-compose up`). Copy `.env.example` to `.env` first — the compose file reads `POSTGRES_*`, and the web/python services read `DATABASE_URL`, `PYTHON_SERVICE_URL`, `COSINE_CLUB_API_KEY`, `YANDEX_MUSIC_TOKEN`, `LASTFM_API_KEY`, plus the Stage I auth env: `AUTH_SECRET` (generate with `openssl rand -base64 32`), `AUTH_URL` (e.g. `http://localhost:3000`), `RESEND_API_KEY` (from resend.com), `EMAIL_FROM` (defaults to `onboarding@resend.dev` for sandbox; set to `auth@<your-verified-domain>` for full sending), plus the Stage J Turnstile env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (test keys `1x00...AA` work in dev; production keys from https://dash.cloudflare.com → Turnstile). There is a single shared `.env` at the repo root; `python-service/app/config.py` resolves it via an absolute path so it works regardless of cwd.

## Slash commands

Project-specific commands live in [.claude/commands/](.claude/commands/). Use them instead of ad-hoc git/gh invocations:

| Command | When to use |
| --- | --- |
| `/commit` | Commit staged/unstaged changes — analyzes the diff, generates a changeset, asks for approval before executing |
| `/pr` | Open a PR to `develop` — derives a branch name, generates a changeset if needed, commits any uncommitted work, and creates the PR |
| `/pr-update` | Update an existing PR description after new commits — also updates or creates a changeset for newly affected packages |
| `/release-docs` | Run from `staging` — generates `docs/releases/YYYY-MM-DD.md` from changes since the last release and opens a PR to `main` |

## Release cycle

Branches: `develop` (integration) → `staging` (RC) → `main` (stable) → `production` (Railway deploy target).

```
feature branch  →  PR to develop      (/pr)
   develop      →  merge to staging   →  RC version bump + git tag  (rc-release.yml, auto)
   staging      →  /release-docs      →  PR to main  →  stable tag + Railway deploy  (release.yml, auto)
```

Key facts for giving accurate guidance:
- Changesets drive all version bumps — there is no npm publish; packages are private.
- `rc-release.yml` puts both packages into pre-release mode (`X.Y.Z-rc.N`) on every `staging` push and syncs the bump back to `develop`.
- `release.yml` exits pre-release mode, creates a `vX.Y.Z` tag, and pushes `main → production` to trigger Railway.
- Always add a changeset when user-visible behavior changes. Use `/commit` or `/pr` — both handle this automatically.
- Full details: [README.md § Release process](README.md#release-process).

## Architecture

### Python service (`python-service/app`)

- `main.py` wires FastAPI + CORS (only allows `http://localhost:3000`) and mounts route modules from `api/routes/` (`similar`, `suggestions`, `discogs`, `ytm_playlist`).
- `adapters/` — one module per external source (`bandcamp`, `cosine_club`, `discogs`, `lastfm`, `trackidnet`, `yandex_music`, `youtube_music`). All conform to `AbstractAdapter` in [python-service/app/adapters/base.py](python-service/app/adapters/base.py) (single `find_similar(query, limit)` method). Add a new source by implementing this interface and registering it where routes aggregate adapters. The Discogs adapter is scoped to the `/discography` and `/labels` page routes only — it does not feed `/similar` (see ADR-0019).
- `core/models.py` defines the shared `TrackMeta` Pydantic model returned to web.
- `config.py` uses `pydantic-settings` reading the repo-root `.env`; holds tokens for Cosine.club, Discogs, Yandex.Music, Last.fm. `extra="ignore"` so shared web/db env vars in the same file don't break validation.

### Web (`web/`)

- App Router under `app/`. API routes under `app/api/*/route.ts` are Next's thin layer — most heavy lifting lives in `lib/` and is proxied to the Python service.
- `lib/python-client.ts` is the single typed boundary to the Python service; keep request/response shapes in sync with `python-service/app/core/models.py` and the route handlers.
- `lib/aggregator.ts` — RRF fusion across per-source ranks plus artist diversification (max 2 consecutive). No BPM/key filter, no genre filter, no embed bonus, no artist-level dislike penalty. Runs in Node, not Python.
- `prisma/schema.prisma` — Postgres schema (Track, SearchQuery/SearchResult, Favorite, DislikedTrack, LastfmArtistSimilars; plus the auth tables: User, Account, Session, VerificationCode, PasswordResetToken — see ADR-0020; plus the Stage J security tables: AnonymousRequest, LoginAttempt — see ADR-0021). Prisma client outputs to `app/generated/prisma`, imported via `lib/prisma.ts`. Requires `DATABASE_URL`.
- Client state uses Jotai atoms in `lib/atoms/`.

### Authentication (`web/lib/auth.ts`, ADR-0020)

- Auth.js v5 (`next-auth@beta`) with Credentials provider + JWT sessions, sliding 14-day expiry. Sliding renewal is automatic — every `auth()` call refreshes the cookie expiry; do not add custom rotation logic in callbacks.
- The five auth flows live in `web/app/actions/`: `register.ts`, `verify-email.ts`, `password-reset.ts`. They are Server Actions (not API routes) for native CSRF + simpler form wiring. Each follows a **send-first-then-DB** ordering — Resend's SDK returns `{ data, error }` rather than throwing, so `lib/email.ts` wraps it in a `send()` helper that throws; if the send fails, the action returns an error before any User / VerificationCode / PasswordResetToken row is written, so retry is clean.
- Verification codes are 6 digits, generated with `crypto.randomInt`, stored bcrypt-hashed, 15-minute expiry. Reset tokens are 32-byte hex (256 bits), stored plaintext, 1-hour expiry. Both flows have built-in 1-minute resend / re-request rate limits via `createdAt` checks.
- Email enumeration: `forgot-password` and the verification resend always succeed silently for nonexistent / verified users. `register` does leak existence ("Email already registered") — deliberate UX trade.
- Auth helpers: `requireUser()` / `getCurrentUser()` in [web/lib/auth-utils.ts](web/lib/auth-utils.ts). `requireUser` throws `Error("UNAUTHORIZED")`; the per-route 401 wrapping is the caller's responsibility.
- The admin pre-claim pattern: migration `20260504215611_add_authentication_schema` inserts a `User` row with id `admin_seed_account_id` and no passwordHash, and backfills existing favorites / dislikes to it. Registration with that email "claims" the row by setting passwordHash, so the existing data becomes the new user's data. Don't re-litigate this without rereading ADR-0020.
- Auth UI surface: `/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, plus `<NavAuthSection />` in the layout. Because the layout calls `auth()`, every route is server-rendered per request — there is no static prerender for the page body.

### Security (`web/lib/{anonymous-counter,brute-force,turnstile}.ts`, `next.config.ts`, ADR-0021)

- **Anonymous limit**: per-IP counter (`AnonymousRequest`) gates `/api/search`, `/api/discography/search`, `/api/discography/label/search`. 10 free requests pooled across them; 11th returns `429 ANONYMOUS_LIMIT_REACHED`. Authenticated users bypass. Client uses `fetchWithAnonGate` to detect 429 and toggle the shared `showRegisterPromptAtom`, which `<AnonymousLimitModalHost />` (mounted in the root layout) reads. Don't add the gate to follow-up calls (releases / tracklist / embed) — it's intended for the typed-search entry points only.
- **Cloudflare Turnstile**: `lib/turnstile.ts` calls `siteverify` and **fails closed** on missing secret, network errors, non-2xx, or empty token. Don't add fail-open paths — bypassing CAPTCHA on infra failure is the attack vector. The api.js script is loaded once at the layout level via `next/script`. Test keys are `1x00...AA` (always-pass) and `2x...AB` (always-fail) — publicly documented, safe to commit.
- **Brute-force layers** (in `authorize()` in `lib/auth.ts`, ordered cheapest-first):
  1. Per-IP rate limit — 10 failed attempts in 15 min throws `RateLimitError` (CredentialsSignin subclass with `code: "RATE_LIMIT"`).
  2. CAPTCHA gate — required after 3 failed attempts on the email; verified before the bcrypt compare.
  3. Per-email exponential backoff — 0/0/1s/4s/16s/64s. Sleeps inside `authorize()`. **Vercel free tier (10s function timeout) will time out** at the 64s tier — production deployments need 90s+.
  4. Email warning at 5+ failed attempts (only for accounts that exist).
  Successful login calls `clearFailedAttempts(email)`; the per-IP counter is unaffected.
- **Login form** asks the server (`loginPrecheckAction`) on email blur whether CAPTCHA is required; the server is the source of truth. Constants live in `BRUTE_FORCE_CONSTANTS` in `lib/brute-force.ts` — change them there, not inline.
- **CSP**: strict allowlists in `next.config.ts`. Adding a new iframe source means adding its host to `frame-src`. CSP violations show up in DevTools Console — check there before assuming a feature is broken. `'unsafe-inline'` / `'unsafe-eval'` on `script-src` are unavoidable due to Next.js inline hydration scripts.
- **Honeypot fields**: hidden `website` input on register and login. When non-empty, the action returns fake success without DB writes — bot sees no signal it was detected.
- **Input validation**: every API entry point that reads user input passes through Zod with length caps. When adding a new route, add a schema (don't trust strings).

### Data flow for a similarity search

1. User query hits `web/app/api/search/route.ts`. The route calls `auth()` to capture the current `userId` (or null for anonymous).
2. Web persists a `SearchQuery` via Prisma, then looks up the **search response cache** (`ExternalApiCache` row with `source="search_response"`, key versioned by `SEARCH_CACHE_VERSION`, TTL 14 days). On hit, the cached `SimilarResponse` is reused; on miss, web calls `fetchSimilarTracks` → `POST {PYTHON_SERVICE_URL}/similar` and writes the result to the cache.
3. Python route (on cache miss) fans out to enabled adapters, each returning `TrackMeta[]`.
4. Web filters out tracks whose `(artistKey, titleKey)` identity is in **the current user's** `DislikedTrack` rows (anonymous = empty set, no filter), fuses with `lib/aggregator.ts` (RRF + artist diversification), persists tracks + results, and updates `SearchQuery.status = "done"` (work runs as a fire-and-forget background task; the search-id was returned to the client up front). RRF, dislike filter, and cover enrichment always run fresh — they are not part of the cache.

## Project-specific gotchas

- **Next.js 16 is not the Next you know.** Per [web/AGENTS.md](web/AGENTS.md): APIs, conventions, and file structure may differ from your training data. Before writing or modifying Next.js code, read the relevant guide in `web/node_modules/next/dist/docs/` and heed deprecation notices.
- **Prisma 7** (also newer than training data in many cases) — generated client lives at `web/app/generated/prisma`, not the default `node_modules/@prisma/client` location. Use `@prisma/adapter-pg` (Prisma + node-postgres driver adapter), not the default engine.
- Python tests use `asyncio_mode = auto` — don't manually decorate with `@pytest.mark.asyncio`.
- The service assumes the frontend origin is `http://localhost:3000` in two places: FastAPI CORS and YouTube embed URLs (`settings.frontend_origin`). Change both together if the port moves.
- **Bump `SEARCH_CACHE_VERSION` whenever you change what `/similar` returns.** [web/app/api/search/route.ts](web/app/api/search/route.ts) caches the Python `/similar` response in `ExternalApiCache` for 14 days, keyed by `${SEARCH_CACHE_VERSION}:${normalizedArtist}|${normalizedTrack}`. If you don't bump the version, up to 14 days of users will silently see results from the previous logic. **Triggers a bump** (anything that changes what Python `/similar` returns): adding/removing an adapter from the `/similar` fan-out, changing filtering or ordering inside `python-service/app/api/routes/similar.py`, modifying any adapter's `find_similar()` shape or ordering, or changing `limit_per_source` / request shape in [web/lib/python-client.ts](web/lib/python-client.ts). **Does NOT trigger a bump** (these run fresh on every request, post-cache): `lib/aggregator.ts` (RRF formula, tiebreaker, artist diversification), the `DislikedTrack` filter, `enrichMissingCovers`, `saveTracks` logic. Bump = change the constant string in `route.ts` (`"v1"` → `"v2"`); old keys are never read again, no SQL flush needed.

## Testing

Three tiers, all opt-in beyond the default:

- **Default unit tests**: `pnpm test` (web) and `cd python-service && .venv/bin/pytest`. Fast, offline, no live network. The Python config excludes `smoke` and `speed` markers via `pytest.ini` `addopts`; the web config excludes `tests/smoke/` and `tests/speed/` from `vitest.config.ts`.
- **Smoke** (`-m smoke` / `pnpm test:smoke`): hits real upstream APIs and the local dev stack. Per-adapter live-result sanity, `/similar` and `/api/search` end-to-end, dislike CRUD + filter behavior, aggregator integration. Adapters skip when their API key is unset; integration tests skip if dev servers aren't running. Flaky upstream is the signal — don't retry to mask it.
- **Speed** (`-m speed` / `pnpm test:speed`): per-adapter, per-endpoint, and aggregator P95 over 5–100 sequential runs with hard thresholds. Includes 10-concurrent `/similar`. Must run sequentially (web side enforces `fileParallelism: false` + `maxWorkers: 1`). Threshold rationale lives next to each test; tighten if observed P95 stays well below the line, document if you loosen.

ADR-0018 documents this strategy. CI integration is deferred.
