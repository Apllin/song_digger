# 0007 — Beatport enrichment: in-process fire-and-forget background

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
Beatport enrichment fetches BPM/key for tracks that don't have these fields.
Currently capped at 4 tracks per request (synchronous, in the response path).
Two questions:

1. How do we expand beyond the 4-track cap without slowing the response?
2. Where do we cache enriched values to skip re-fetches on subsequent searches?

The cache answer is straightforward: existing `Track` table in Postgres is
already the cache — `bpm`, `key`, `genre`, `label` columns. Reading from
Postgres before calling Beatport solves repeated-query cost.

The remaining question is how to enrich the long tail (tracks beyond the
inline budget) without adding a job-queue infrastructure dependency.

**Decision:**
- Inline budget for top-K (e.g. 6 tracks) — shown immediately in response.
- Remaining tracks: dispatch a fire-and-forget async task on the same
  process (`asyncio.create_task`) AFTER the response is sent. Persist
  enriched values to Postgres `Track` table when each completes.
- No external job queue (Postgres-backed task table, Redis, RabbitMQ, etc).

**Consequences:**
- Positive: zero new infrastructure; ships today.
- Positive: cold-start search latency unaffected (top-K inline budget unchanged).
- Positive: warm-cache search latency improves significantly — most tracks
  show up already-enriched.
- Negative: fire-and-forget tasks are **lost on Node restart**. A track in
  flight at restart never gets its row updated; it'll be re-fetched on the
  next search containing it. Acceptable for non-critical background fill.
- Negative: no observability into "how many enrichments are pending right
  now" without adding logging.

**Alternatives considered:**
- Postgres-backed `EnrichmentJob` table with separate worker process —
  rejected for current scale. Re-evaluate if we observe persistent gaps
  (e.g. < 60% of frequently-searched tracks have enrichment after 1 week of
  use).
- Redis queue (BullMQ etc.) — rejected, infrastructure overhead not justified.
- Bigger inline budget (15-20 tracks) — rejected, response latency regresses
  too much; even Beatport's per-track fetch is ~400-800ms.

**Revisit when:**
- Logs show persistent missing enrichments (track searched repeatedly, never
  enriched)
- Process restart frequency is high enough that fire-and-forget loss is
  noticeable
- We add other background work (label graph rebuild, 1001TL cache refresh) —
  at that point, having one shared queue starts paying off
