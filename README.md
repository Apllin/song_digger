# track_digger

Monorepo containing:

- [web/](web/) — Next.js 16 frontend with Prisma + Postgres
- [python-service/](python-service/) — FastAPI service with adapters for Bandcamp, Cosine.club, Last.fm, trackid.net, Yandex Music, and YouTube Music. Six sources fan out behind `/similar`. The Discogs adapter is also present but scoped to the `/discography` and `/labels` page routes only — it does not contribute to similarity search.

Orchestrated by [Turborepo](https://turborepo.com) using [pnpm](https://pnpm.io) workspaces. The Python service is wrapped in a thin `package.json` shim so Turborepo can cache and parallelize its tasks alongside the JS side.

## Prerequisites

- **Node.js 22+** (this repo is tested on 25)
- **Python 3.12+**
- **Docker** (optional — for Postgres and the containerized stack)
- **Corepack** — Node 22+ ships without it, so install it separately:
  ```bash
  npm install -g corepack
  corepack enable
  ```

pnpm is pinned via the `packageManager` field in the root [package.json](package.json) and fetched automatically by Corepack on first use. Do not install pnpm globally.

## First-time setup

```bash
# 1. Install JS dependencies (Corepack fetches the pinned pnpm version)
pnpm install

# 2. Create python-service/.venv and install Python requirements
pnpm setup

# 3. Copy env template and fill in secrets
cp .env.example .env

# 4. Start Postgres (or bring up the whole stack — see Docker section)
docker compose up -d postgres

# 5. Apply Prisma migrations and generate the client
pnpm --filter web exec prisma migrate dev
```

## Daily commands

Run from the repo root — all scripts delegate to `turbo run`:

```bash
pnpm dev       # web (next dev :3000) + python-service (uvicorn :8000) in parallel
pnpm build     # next build
pnpm test      # default unit tests (pytest in python-service)
pnpm lint      # eslint in web
pnpm sort-pkg  # sort package.json field order across workspace packages
pnpm codegen   # export openapi.json from FastAPI + run kubb to regenerate web/lib/python-api/generated
pnpm stack:up  # full prod-parity stack via docker-compose (uses Railway dockerfiles)
```

`codegen` runs automatically before `dev` and `build` via Turbo. The chain is `python-service codegen` (writes `python-service/openapi.json`) → `web codegen` (kubb generates types + zod schemas + a typed axios client into `web/lib/python-api/generated/`).

**Both artifacts are checked into git.** The Railway Dockerfile builds with `web/` as its context and can't reach the Python source, so it relies on the committed clients rather than running codegen during the image build. After editing FastAPI route signatures or Pydantic response models, regenerate locally and commit the result before pushing — otherwise the deploy will ship stale clients:

```bash
pnpm codegen   # rewrites python-service/openapi.json + web/lib/python-api/generated/
```

Three test tiers — unit by default, smoke + speed opt-in. See [ADR-0018](web/docs/decisions/0018-test-coverage-strategy.md) for the strategy.

```bash
# default — fast, offline
pnpm test                                       # python unit tests
pnpm --filter web test                          # web vitest unit tests

# smoke — hits live upstreams + dev servers (start with `pnpm dev`)
cd python-service && .venv/bin/pytest -m smoke
pnpm --filter web test:smoke

# speed — latency thresholds; sequential (don't parallelize)
cd python-service && .venv/bin/pytest -m speed
pnpm --filter web test:speed
```

Target a single package:

```bash
pnpm turbo run dev --filter=web
pnpm turbo run test --filter=@track-digger/python-service
```

Only run tasks for packages affected by changes since the default branch:

```bash
pnpm turbo run test --affected
```

Bypass the cache for a single run:

```bash
pnpm turbo run build --force
```

## How the Python ↔ Turborepo bridge works

[python-service/package.json](python-service/package.json) is a shim — it has no JS dependencies but defines `scripts` that invoke the venv binaries (`.venv/bin/uvicorn`, `.venv/bin/pytest`). Turborepo treats it like any other workspace package:

- **Caching** — `turbo run test` hashes every tracked file in the package (`*.py`, `requirements.txt`, `pytest.ini`). Unchanged inputs → cache hit → execution is skipped and stdout is replayed from cache.
- **Filtering** — `--filter=@track-digger/python-service` or `--affected` includes or excludes Python work based on what changed.
- **Parallelism** — `pnpm dev` runs Next.js and FastAPI concurrently.

`.venv/` is gitignored and **not** cached by Turborepo. It's a local dev artifact; `pnpm setup` recreates it from `requirements.txt`.

The two services share **one build-time artifact**: the FastAPI OpenAPI schema. `python-service codegen` exports `python-service/openapi.json` from `app.openapi()`; `web codegen` runs `kubb` against it to produce `web/lib/python-api/generated/{types,zod,clients}/`. The dependency is wired in [turbo.json](turbo.json) so `web build` and `web dev` can't start with stale generated code.

## Docker

The full stack (web + python-service) builds from the **production** Railway dockerfiles, so a `docker compose up` matches what's actually deployed. The database is Neon — compose has no local postgres service; web reads `DATABASE_URL` from `.env` and connects to Neon directly.

```bash
pnpm stack:up      # runs codegen, then docker compose up --build
pnpm stack:down    # docker compose down
```

**Why a wrapper script.** `web/Dockerfile.railway` and `python-service/Dockerfile.railway` each `COPY` only their own service directory. They have no access to each other's files at build time, so `web codegen` (which kubb-generates from `python-service/openapi.json`) has to run on the host first. `pnpm stack:up` does that, then hands off to compose. Same constraint applies to your real Railway deploys — generated files would need to be present in the build context one way or another.

**Build args wired through compose** (see [docker-compose.yml](docker-compose.yml)): `DATABASE_URL` (placeholder for `next build` static analysis — passed through from `.env`), `NEXT_PUBLIC_HOST_URL` (defaults to `http://localhost:3000`), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (defaults to the always-pass test key). Real Turnstile keys, Resend, Discogs token, etc. come in via `env_file: ./.env` at runtime.

**Migrations on boot.** Web's CMD runs `prisma migrate deploy` immediately on container start — applies pending migrations to whatever Neon DB `DATABASE_URL` points at. It's idempotent; running it repeatedly is safe.

## Environment variables

Copy [.env.example](.env.example) to `.env` and fill in values. Key variables:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | web | Prisma connection string |
| `PYTHON_SERVICE_URL` | web | URL of the FastAPI service (default `http://localhost:8000`) |
| `COSINE_CLUB_API_KEY` | python-service | Third-party API key for the Cosine Club adapter |
| `AUTH_SECRET` | web | JWT signing secret. Generate with `openssl rand -base64 32`. Required by Auth.js v5. |
| `AUTH_URL` | web | Public URL of the web app (e.g. `http://localhost:3000`). Used in password-reset emails and Auth.js callbacks. |
| `RESEND_API_KEY` | web | API key from [resend.com](https://resend.com). Used to send verification codes and password-reset links. |
| `EMAIL_FROM` | web | Sender address. Defaults to `onboarding@resend.dev` (Resend sandbox — only delivers to your account email). Set to `auth@<your-verified-domain>` once you've verified a domain in Resend. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | web | Cloudflare Turnstile public site key. Test key `1x00000000000000000000AA` always passes; real keys from [dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile. |
| `TURNSTILE_SECRET_KEY` | web | Cloudflare Turnstile secret. Test key `1x0000000000000000000000000000000AA` always passes. Production deployment requires real keys. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | docker-compose | Postgres credentials |

## Authentication

Email/password authentication via [Auth.js v5](https://authjs.dev) with 6-digit code verification and 14-day sliding JWT sessions. See [ADR-0020](web/docs/decisions/0020-authentication-stage-i.md).

Routes:

| Path | Purpose |
| --- | --- |
| `/register` | Email + password signup → emails a 6-digit code |
| `/verify-email?email=...` | Enter the 6-digit code; "Resend" button (1/min limit) |
| `/login` | Sign in (also lands here as `/login?verified=true` after verify or password reset) |
| `/forgot-password` | Request a password-reset email |
| `/reset-password?token=...` | Set a new password from the email link (1h validity) |

Server logic lives in [web/app/actions/](web/app/actions/) (`register.ts`, `verify-email.ts`, `password-reset.ts`). API endpoints are auth-aware: `/api/favorites` and `/api/dislikes` require a session; `/api/search` works for anonymous users (no dislike filter) and authenticated users (filter scoped to their dislikes).

## Security (Stage J)

Stage J ([ADR-0021](web/docs/decisions/0021-anonymous-limits-and-security.md)) hardens the surface before public launch:

- **Anonymous request limit** — 10 free requests per IP across `/api/search`, `/api/discography/search`, `/api/discography/label/search`. After that a register prompt blocks further use; signing up clears the gate.
- **Cloudflare Turnstile CAPTCHA** — required on registration, and on login after 3 failed attempts on the same email.
- **Brute-force protection** — per-IP rate limit (10 failures / 15 min), per-email exponential backoff (1s/4s/16s/64s), and a security email at 5+ failed attempts on an existing account.
- **Strict CSP + security headers** — HSTS (production), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and a Content-Security-Policy with explicit allowlists for embeds (YouTube, Bandcamp, Turnstile).
- **Honeypot fields** on register and login; bots that auto-fill every input get a fake-success and never reach the DB.
- **Zod-validated inputs** on every API entry point.

## Project structure

```
track_digger/
├── package.json              root — pins pnpm, delegates to turbo
├── pnpm-workspace.yaml       workspace list
├── turbo.json                task pipeline
├── docker-compose.yml
├── .env.example
├── web/                      Next.js 16 app
│   ├── app/
│   ├── prisma/
│   └── package.json
└── python-service/           FastAPI service
    ├── app/
    │   ├── adapters/         Bandcamp, Cosine Club, Discogs, Last.fm, trackid.net, Yandex Music, YouTube Music
    │   ├── api/routes/
    │   └── core/
    ├── tests/
    ├── requirements.txt
    └── package.json          thin shim wrapping venv commands
```

## Adding a new dependency

**JS (in `web/`):**

```bash
pnpm --filter web add <package>
pnpm --filter web add -D <package>    # dev dep
```

**Python (in `python-service/`):**

Edit [python-service/requirements.txt](python-service/requirements.txt), then:

```bash
pnpm --filter @track-digger/python-service run setup
```

## Approving package build scripts

pnpm 10 blocks postinstall scripts by default. Approved packages are listed in `pnpm.onlyBuiltDependencies` in the root [package.json](package.json). To add a new one:

```bash
pnpm approve-builds
```

Currently approved: `prisma`, `@prisma/engines`, `@prisma/client`. Packages like `sharp` and `unrs-resolver` remain unapproved — Next.js falls back to slower implementations. Approve them if you need the native-binary performance.

## Troubleshooting

- **`pnpm: command not found`** — Corepack shims aren't active. Run `corepack enable`.
- **`PrismaClient` not found at runtime** — run `pnpm --filter web exec prisma generate`.
- **`uvicorn: command not found` when running `pnpm dev`** — you skipped `pnpm setup`. Re-run it to create `python-service/.venv/`.
- **Stale cache** — `pnpm turbo run <task> --force` bypasses the cache for one run. `pnpm turbo run <task> --summarize` writes a JSON summary of hash inputs to [.turbo/runs/](.turbo/runs/) for debugging.
