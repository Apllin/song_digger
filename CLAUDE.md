# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branding

The product name is **TrackDigger**. Always refer to it as "TrackDigger".

## Code conventions (read first)

**Before writing or modifying any code, invoke the `code` skill.** It loads only the rule files relevant to the change — feature folders, file/folder naming, typed API clients (Hono RPC + kubb-generated python-service client), TypeScript conventions (Zod as source of truth, etc.), React conventions, CSS/Tailwind. See [.claude/skills/code/SKILL.md](.claude/skills/code/SKILL.md).

The skill is the source of truth for **how** we write code. This file (CLAUDE.md) is the source of truth for **what** exists in the codebase.

## Monorepo layout

pnpm workspace + Turborepo. Two packages:

- `web/` — Next.js 16 app (React 19, Prisma 7, Tailwind v4, Jotai, Zod). User-facing UI + thin API routes.
- `python-service/` — FastAPI service. Owns all external-source scraping/aggregation and music-feature heuristics.

The Next app talks to the Python service over HTTP (`PYTHON_SERVICE_URL`, default `http://localhost:8000`) via the kubb-generated client at [web/lib/python-api/generated/clients/](web/lib/python-api/generated/clients/), regenerated from `python-service/openapi.json` by `pnpm codegen`. Postgres is shared infra owned by `web` through Prisma.

For deeper detail see [docs/dev/architecture.md](docs/dev/architecture.md).

## Commands

Run from repo root; Turbo fans out to the right workspace.

```bash
pnpm install                    # install JS deps across workspaces
pnpm setup                      # creates python-service/.venv and installs requirements.txt
pnpm dev                        # runs web + python-service together (turbo, persistent)
pnpm codegen                    # regen python openapi.json + kubb client (after editing FastAPI routes / Pydantic models)
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

## Slash commands

| Command         | When to use                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/commit`       | Commit staged/unstaged changes — analyzes the diff, generates a changeset, asks for approval before executing                     |
| `/pr`           | Open a PR to `develop` — derives a branch name, generates a changeset if needed, commits any uncommitted work, and creates the PR |
| `/pr-update`    | Update an existing PR description after new commits — also updates or creates a changeset for newly affected packages             |
| `/release-docs` | Run from `staging` — generates `docs/releases/YYYY-MM-DD.md` from changes since the last release and opens a PR to `main`         |

## Release cycle

`feature branch → PR to develop → merge to staging → RC tag (auto) → /release-docs → PR to main → stable tag + Railway deploy (auto)`

- Changesets drive all version bumps — there is no npm publish; packages are private.
- Always add a changeset when user-visible behavior changes. Use `/commit` or `/pr` — both handle this automatically.
- Full details: [README.md § Release process](README.md#release-process).

## Project-specific gotchas

- **Next.js 16 is not the Next you know.** APIs, conventions, and file structure may differ from training data. Before writing or modifying Next.js code, read the relevant guide in `web/node_modules/next/dist/docs/` and heed deprecation notices.
- **Prisma 7** — generated client lives at `web/app/generated/prisma`, not the default `node_modules/@prisma/client` location. Use `@prisma/adapter-pg`, not the default engine.
- **Python tests** use `asyncio_mode = auto` — don't manually decorate with `@pytest.mark.asyncio`.
- **Search cache** — bump `SEARCH_CACHE_VERSION` in [web/features/search/searchCache.ts](web/features/search/searchCache.ts) whenever you change what `/similar` returns. See [docs/dev/architecture.md](docs/dev/architecture.md#search-cache-versioning) for what triggers a bump.

## Documentation

If you're stuck — unexpected behavior, unclear conventions, surprising constraints — check `docs/dev/` before guessing. The docs capture decisions and gotchas that aren't obvious from the code.

- [docs/dev/architecture.md](docs/dev/architecture.md) — Python service internals, web internals, search data flow, cache versioning
- [docs/dev/auth.md](docs/dev/auth.md) — Auth.js setup, auth flows, email enumeration, brute-force protection
- [docs/dev/security.md](docs/dev/security.md) — Anonymous limit, Turnstile, brute-force layers, CSP, honeypot, input validation
