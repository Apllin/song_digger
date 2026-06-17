# Discogs collaborative source — operations runbook

The Discogs collaborative source (`/similar`) surfaces, for a seed track, releases
owned by Discogs collectors who Have/Want that seed, filtered to the seed's style
families. Owner enumeration is the only step that needs a Cloudflare bypass, so the
build runs **offline** into a warm cache (`ExternalApiCache`, source `discogs_similar`),
and the `/similar` hot path only **reads** that cache. A cold (un-warmed) seed
contributes nothing — it never blocks the request.

Two operational pieces are required in production:

1. A **FlareSolverr** service (solves Cloudflare on the Discogs stats page).
2. A **warming job** that populates the cache for popular seeds.

Everything here soft-degrades: with no FlareSolverr configured, the source is simply
silent — nothing breaks.

---

## Part A — Railway setup (FlareSolverr)

### When to do it

Release flow: `develop → staging → main → Railway (auto-deploy on stable tag)`.

- Do this **after the feature code reaches the target environment** (there's nothing to
  wire before the code is deployed).
- Recommended: configure **staging first**, run the full loop once, then **prod**.
- Order of the steps within an environment doesn't risk breakage (soft-degrade), but
  Discogs only starts returning results once all three are true: FlareSolverr up +
  env var set + cache warmed.

### Step 0 — Prerequisites (verify they already exist on `python-service`)

| Variable        | Why                                                              |
| --------------- | ---------------------------------------------------------------- |
| `DISCOGS_TOKEN` | Discogs API auth (already used by discography/labels).           |
| `DATABASE_URL`  | Shared Neon Postgres — the warm job writes the cache here.       |

### Step 1 — Add the FlareSolverr service

Railway → project → **New → Deploy from Docker Image**:

```
ghcr.io/flaresolverr/flaresolverr:latest
```

Name the service **`flaresolverr`** (the internal URL references this name).

Optional service variables:

| Variable    | Value     |
| ----------- | --------- |
| `LOG_LEVEL` | `info`    |
| `HOST`      | `0.0.0.0` |
| `PORT`      | `8191`    |

### Step 2 — Private networking (no public domain)

- `flaresolverr` → Settings → Networking: **do not** enable a public domain.
  It will fetch any URL it is handed (SSRF risk) — keep it internal-only.
- Private networking is on by default → reachable at `flaresolverr.railway.internal`.

### Step 3 — Point `python-service` at it

`python-service` → Variables → add:

| Variable                      | Value                                            |
| ----------------------------- | ------------------------------------------------ |
| `DISCOGS_STATS_UNBLOCKER_URL` | `http://flaresolverr.railway.internal:8191/v1`   |

This triggers a redeploy of `python-service`.

### Step 4 — Verify connectivity

From the `python-service` shell (`railway run` or the Railway shell):

```bash
curl -sS -X POST http://flaresolverr.railway.internal:8191/v1 \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"request.get","url":"https://www.discogs.com/release/stats/37505337","maxTimeout":60000}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('cf:',d['solution']['status'])"
```

Expect `cf: 200` (the first request can take 10–40 s while it solves the challenge).

### Notes / gotchas

- **Resources:** FlareSolverr runs headless Chromium — give the container **0.5–1 GB RAM**
  or it will OOM.
- **IPv6:** Railway private networking is IPv6. If `*.railway.internal` won't connect,
  confirm FlareSolverr binds all interfaces (`HOST=0.0.0.0`).
- **Security:** never expose FlareSolverr on a public domain.

---

## Part B — Warming the cache (automatic)

**There is nothing to run.** Warming is automatic and follows real search traffic —
no cron, no script, no seed lists. `python-service` runs a background worker
(`app/services/discogs_warm.py`, started in the app lifespan) that fills the
`discogs_similar` cache on its own. Once Part A is done, it just works.

### How it works

1. A user searches. The `/similar` hot path reads the `discogs_similar` cache
   (`DiscogsAdapter.find_similar`) — read-only, never blocks.
2. On a **cache miss** (cold seed) or an **expired** entry, `find_similar` enqueues the
   seed via `request_warm()` (track queries only). A cached *empty* result is a real
   "no matches" and does NOT re-trigger.
3. A single background worker drains the queue: it re-checks freshness (skips if another
   search/instance already warmed it within ~25 days), else calls `build_collaborative`
   and writes the cache. Builds are **throttled** (≥12 s apart) to stay well under the
   Discogs 60 req/min limit, and seeds are **deduped** (an in-flight seed isn't queued
   twice). Queue is capped (500) so it can't grow unbounded.

Net effect: **popularity is implicit** — frequently-searched seeds get warmed first and
stay warm; rarely-searched ones may never warm (and don't need to). Entries refresh
automatically: once a 30-day cache entry expires, the next search re-enqueues it.

### Throughput

- Per seed ≈ ~9 Discogs API calls + 1 FlareSolverr stats scrape; the **scrape is the
  bottleneck** (~10–40 s), and the worker is sequential + throttled → **~2–4 seeds/min**.
- This is intentionally conservative (one shared worker) so warming can never threaten
  the Discogs rate limit regardless of search volume.

### Optional manual backfill

The single-seed script remains for one-off warming (e.g. to pre-warm a known seed
without waiting for someone to search it):

```bash
# from python-service/
python -m scripts.warm_discogs_similar "Joe Milli - Retreat"
```

Not required for normal operation.

### Why this is safe

- Warming is fully off the `/similar` critical path (read-only cache + fire-and-forget
  enqueue).
- If the worker fails on a seed, it's caught per-job and the loop continues; if the whole
  task dies, warming simply stops (existing cache lives until TTL) — nothing breaks.
- No FlareSolverr configured → `build_collaborative` soft-degrades to no owners → the
  source stays silent. No errors, no manual intervention.
