# Discogs collaborative source — operations runbook

The Discogs collaborative source (`/similar`) surfaces, for a seed track, releases
owned by Discogs collectors who Have/Want that seed, filtered to candidates that
share one of the seed's Discogs styles (direct 1-1 match — no style-family or
cross-genre broadening). Owner enumeration is the only step that needs a Cloudflare
bypass, so the build runs **offline** into a warm cache (`ExternalApiCache`, source
`discogs_similar`), and the `/similar` hot path only **reads** that cache. A cold
(un-warmed) seed contributes nothing — it never blocks the request.

Two operational pieces are required in production:

1. A **FlareSolverr** service (solves Cloudflare on the Discogs stats page).
2. A **warming job** that populates the cache for popular seeds (run manually).

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

## Part B — Warming the cache (manual)

The `discogs_similar` cache is filled by a single-seed script. The `/similar` hot path
only **reads** the cache — it never builds, so a seed only returns results once it has
been warmed.

```bash
# from python-service/
python -m scripts.warm_discogs_similar "Joe Milli - Retreat" [limit]
```

The script runs the full build (seed → Have/Want collectors → on-style collection
releases) and writes the result to the cache. It needs `DISCOGS_TOKEN`, `DATABASE_URL`,
and `DISCOGS_STATS_UNBLOCKER_URL` set.

### How it works

1. A user searches. The `/similar` hot path reads the `discogs_similar` cache
   (`DiscogsAdapter.find_similar`) — read-only, never blocks. A cache miss returns
   nothing.
2. To populate a seed, run the script. It calls `build_collaborative`, which resolves
   the seed, scrapes its Have/Want collectors via FlareSolverr, samples their on-style
   collection releases, and writes the `discogs_similar` cache entry (30-day TTL).
3. Pass one query per invocation (or loop over a seed list in a shell). Keep the cadence
   well under the Discogs 60 req/min limit.

### Throughput

- Per seed ≈ ~9 Discogs API calls + 1 FlareSolverr stats scrape; the **scrape is the
  bottleneck** (~10–40 s). Run seeds sequentially so a batch can never threaten the
  Discogs rate limit.

### Why this is safe

- Warming is fully off the `/similar` critical path (the hot path is a read-only cache
  lookup; the build only runs from the script).
- No FlareSolverr configured → `build_collaborative` soft-degrades to no owners → the
  source stays silent. No errors, no manual intervention.
