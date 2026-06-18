# LLM-based title normalization — design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) — pending implementation plan
**Branch:** `feat/llm-title-normalization`

## Problem

TrackDigger cleans and matches track titles with hand-written regex spread across
both services. It does two distinct jobs through separate mechanical paths:

1. **Display cleanup** — `app/core/title_norm.py::clean_title`, `adapters/soundcloud.py::_clean_title`:
   strip promo banners, `[HD]`, vinyl positions, label tails so the user sees a clean
   "Artist – Title".
2. **Matching / dedup / cache keys** — `title_norm.py::strip_recording_suffixes`,
   `adapters/_seed_match.py::query_match_score`, and the mirrored
   `web/lib/aggregator.ts::normalizeTitle / normalizeArtist / identityKey`: produce
   deterministic keys used for seed validation, RRF fusion, the 14-day search cache,
   and persisted dislike matching.

The regex approach is brittle: it misses cases, must be kept byte-identical across
Python and TypeScript, and grows a new pattern every time a source invents new junk.

## Goal

Replace **all** mechanical title cleaning and sanitization with a single LLM
normalizer (Claude Haiku 4.5 via the Anthropic Python SDK). Delete every regex /
NFKD / strip-pattern path. The LLM becomes the single source of canonical titles.

## Key decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Scope | **Full replacement** — both display cleanup and matching/key generation |
| Determinism | **Persistent `raw → canonical` cache** — LLM runs once per unique raw title; keys stay stable via cache reuse |
| Model | **`claude-haiku-4-5`** — fastest/cheapest; cleaning is a simple extraction task; fits the project's latency-first priority |
| Batching | **Batch uncached titles aggressively** — one call for the seed, one per adapter for its seed candidates, one post-aggregation pass; near-zero once the cache is warm |
| Failure mode | **Fail loud, persist nothing** — never write an uncleaned value into a keyed store |
| Existing dislikes | **Accept loss, start fresh** — no re-key migration; old `DislikedTrack` keys orphan, users re-dislike over time |
| SDK surface | Anthropic Python SDK, single `messages.create` with structured output (`output_config.format`). Not Managed Agents. |

## Architecture

### The LLM produces both outputs, cached together

One Haiku call per raw title returns a structured object carrying both the display
fields and the deterministic key:

```json
{ "artist": "Foo", "title": "Bar", "match_key": "foo||bar" }
```

- `artist` / `title` → clean display (replaces `clean_title`, SoundCloud `_clean_title`)
- `match_key` → dedup / fusion / cache / seed-match key (replaces `normalizeTitle`,
  `normalizeArtist`, `identityKey`, `strip_recording_suffixes`, `query_match_score`)

Because `match_key` is produced by the LLM and cached, the same raw input always
yields the same key on later requests (cache hit) — the determinism RRF fusion, the
search cache, and dislike matching depend on.

### New module: `python-service/app/core/title_llm.py`

- `async def normalize(raw_items: list[RawTitle]) -> list[CanonicalTitle]`
  1. Look up each item in the persistent cache.
  2. Send **only uncached items, in one batched Claude call**, with a structured-output
     schema (array of `{artist, title, match_key}`).
  3. Persist results to the cache.
  4. On **any** LLM error (network, rate limit, missing key, malformed output) →
     **raise**; persist nothing.
- Persistent cache: a Postgres table (or reuse `ExternalApiCache`) keyed on the raw
  title string (+ source hint). Effectively permanent — raw titles don't change.
- `RawTitle` carries the raw string and a `source` hint so the model knows about
  source-specific junk (e.g. SoundCloud promo prefixes).

### Deletions

- `python-service/app/core/title_norm.py` (whole module) + `tests/test_title_norm.py`,
  `tests/test_title_clean.py`.
- `python-service/app/adapters/_seed_match.py` scoring/signature logic.
- `python-service/app/adapters/soundcloud.py::_clean_title` and its regex layers
  (+ its `test_title_clean_*` cases).
- `web/lib/aggregator.ts::normalizeTitle / normalizeArtist` (and any other regex
  normalizers); `identityKey` rewired to read the LLM `match_key`.
- Ad-hoc `_normalize_*` helpers in routes/adapters that exist only for title cleaning
  (audit each; some normalize queries for cache keys and route through `title_llm` instead).

### Data flow for one `/similar` search

1. Normalize the **seed query** once (1 cached call) → canonical seed + `match_key`.
2. Adapters fetch candidates; **seed selection** compares each upstream candidate's
   `match_key` to the seed's (one batched call per adapter on cold titles; instant once
   cached). This replaces `query_match_score`'s MATCH_EXACT / MATCH_ARTIST tiers with
   structured `artist`/`title` equality.
3. After aggregation, every result already carries `artist` / `title` / `match_key`.
4. `TrackMeta` gains `artist` / `title` / `match_key`.

### Web side

- `pnpm codegen` regenerates the kubb client from the updated `openapi.json`.
- `identityKey(t)` = `t.matchKey` verbatim; RRF fuses on it.
- `searchCacheKey` uses the canonical seed `match_key` (from the seed normalization
  python returns/exposes).
- `dislikeIdentityKey` uses the disliked track's already-present `match_key`.
- Bump `SEARCH_CACHE_VERSION` in `web/features/search/searchCache.ts` — return shape and
  titles change, so old cache entries are ignored automatically.

### Config

- Add `ANTHROPIC_API_KEY` to `python-service/app/config.py` and `.env.example`
  (value supplied by the user). Missing key → the same loud failure as any LLM error.

## Failure behavior

The normalizer is a hard gate: it either returns canonical values and persists them,
or raises. Callers do **not** fall back to raw titles for keyed stores — storing an
uncleaned value would poison the search cache (14 days) and corrupt dislike matching.
A failed `/similar` request surfaces the error rather than silently degrading.

## Testing

- Unit-test `title_llm.normalize` with a mocked Anthropic client: cache hit path
  (no LLM call), cache miss path (batched call + persist), and error path (raises,
  persists nothing).
- Seed-selection test: candidates with matching/non-matching `match_key`.
- Web: `identityKey` / `searchCacheKey` / `dislikeIdentityKey` derive from `match_key`.
- Regression: adapter outputs carry the new fields; aggregation fuses on `match_key`.
- Live-network behavior stays behind the existing opt-in `smoke` marker.

## Out of scope

- Re-keying existing `DislikedTrack` rows (explicitly dropped — start fresh).
- Any non-title heuristics (BPM/key/genre) — untouched.
- Caching/prompt-cache tuning beyond the persistent `raw → canonical` store.

## Consequences

- Title cleaning quality improves and becomes maintainable (prompt, not regex zoo).
- `/similar` gains a hard dependency on Claude availability for **previously unseen**
  titles; warm cache makes steady-state latency near-zero.
- Existing user dislikes are lost on cutover (accepted).
- One model (Python) owns canonical titles; the web side stops duplicating normalization.
