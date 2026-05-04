# song_digger

Monorepo containing:

- [web/](web/) — Next.js 16 frontend with Prisma + Postgres
- [python-service/](python-service/) — FastAPI service with adapters for Bandcamp, Cosine.club, Discogs, Last.fm, trackid.net, Yandex Music, and YouTube Music

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
pnpm dev      # web (next dev :3000) + python-service (uvicorn :8000) in parallel
pnpm build    # next build
pnpm test     # default unit tests (pytest in python-service)
pnpm lint     # eslint in web
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
pnpm turbo run test --filter=@song-digger/python-service
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
- **Filtering** — `--filter=@song-digger/python-service` or `--affected` includes or excludes Python work based on what changed.
- **Parallelism** — `pnpm dev` runs Next.js and FastAPI concurrently.

`.venv/` is gitignored and **not** cached by Turborepo. It's a local dev artifact; `pnpm setup` recreates it from `requirements.txt`.

The two services have **no build-time dependency graph** between them — `web` talks to `python-service` over HTTP at runtime. If a future change introduces a shared artifact (e.g. generated TypeScript types from the FastAPI OpenAPI schema), add it as a workspace package and wire `dependsOn` in [turbo.json](turbo.json).

## Docker

Full stack (web + python-service + postgres):

```bash
docker compose up
```

Just the database:

```bash
docker compose up -d postgres
```

**Note:** [web/Dockerfile](web/Dockerfile) currently uses `npm install`. It should be updated to pnpm (via Corepack inside the image) before production use.

## Environment variables

Copy [.env.example](.env.example) to `.env` and fill in values. Key variables:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | web | Prisma connection string |
| `PYTHON_SERVICE_URL` | web | URL of the FastAPI service (default `http://localhost:8000`) |
| `COSINE_CLUB_API_KEY` | python-service | Third-party API key for the Cosine Club adapter |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | docker-compose | Postgres credentials |

## Project structure

```
song_digger/
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
pnpm --filter @song-digger/python-service run setup
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
