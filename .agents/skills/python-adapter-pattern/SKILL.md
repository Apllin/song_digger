---
name: python-adapter-pattern
description: Use this skill when adding a new external data source adapter to python-service/app/adapters/ — examples include adding Last.fm, trackid.net, or any source that exposes find_similar / random_techno_track. Also use when modifying existing adapters or writing tests for them. Encodes the project's adapter conventions: AbstractAdapter conformance with the `find_similar(query, limit)` signature, async httpx patterns, soft-degradation when API keys are missing, exception swallowing with structured logs, and TrackMeta field mapping.
---

# Python adapter pattern

Adapters in `python-service/app/adapters/` follow a strict pattern. New adapters MUST follow it; modifications MUST preserve it. The pattern exists because the `/similar` and `/random` routes fan out to all adapters via `asyncio.gather(..., return_exceptions=True)` and expect uniform behavior.

## When to use this skill

- Adding a new adapter (`lastfm.py`, `trackidnet.py`, etc.)
- Modifying an existing adapter
- Writing tests for an adapter
- Debugging why an adapter behaves unexpectedly in `/similar` fan-out

## Required structure

Every adapter is a class in `python-service/app/adapters/<name>.py` that:

1. Inherits from `AbstractAdapter` (in `app/adapters/base.py`)
2. Sets `name: str = "<source-name>"` matching the source identifier used in `SourceList(source=...)`
3. Implements `async def find_similar(self, query: str, limit: int = N) -> list[TrackMeta]` — `query` is `"Artist - Track"` (or just `"Artist"` for artist-only mode); the adapter parses it locally via a private `_split_query` helper (mirror the one in [lastfm.py](../../python-service/app/adapters/lastfm.py))
4. Implements `async def random_techno_track(self) -> TrackMeta | None` (return `None` if the source has no random capability — Last.fm, trackid all return None here)

```python
import httpx
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta
from app.config import settings

API_BASE = "https://example.com/api/"
LIMIT = 50


class ExampleAdapter(AbstractAdapter):
    name = "example"

    async def find_similar(
        self,
        query: str,
        limit: int = LIMIT,
    ) -> list[TrackMeta]:
        # 1. Soft-degrade when credentials are missing
        api_key = settings.example_api_key
        if not api_key:
            return []

        # 2. Soft-degrade when the API can't handle the request shape.
        #    Parse "Artist - Track" locally; if the source needs both,
        #    short-circuit on artist-only queries.
        artist, track = _split_query(query)
        if not track:
            return []  # this source requires a track

        # 3. Make the request inside try/except — swallow ALL exceptions,
        #    log with the [Adapter] prefix, return [] on failure
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(API_BASE, params={...})
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            print(f"[Example] find_similar error: {e}")
            return []

        # 4. Map response to TrackMeta, dropping anything malformed
        results: list[TrackMeta] = []
        for item in data.get("tracks", []):
            title = item.get("name", "").strip()
            artist_name = item.get("artist", "").strip()
            url = item.get("url", "").strip()
            if not title or not artist_name or not url:
                continue
            results.append(TrackMeta(
                title=title,
                artist=artist_name,
                source=self.name,
                sourceUrl=url,
                # populate what the source provides; leave the rest None
                coverUrl=None, embedUrl=None, score=None,
            ))

        return results

    async def random_techno_track(self) -> TrackMeta | None:
        return None  # explicit, not omitted


def _split_query(query: str) -> tuple[str, str | None]:
    """Parse "Artist - Track" → (artist, track). Returns (query, None)
    when there is no separator. Adapters needing a track must
    short-circuit on the (artist, None) shape — see lastfm.py:_split_query."""
    if " - " not in query:
        return query.strip(), None
    artist, _, track = query.partition(" - ")
    return artist.strip(), (track.strip() or None)
```

## Critical conventions

### Soft degradation, not exceptions

The fan-out in `/similar` uses `asyncio.gather(..., return_exceptions=True)` and treats raised exceptions as caller errors, not adapter no-results. **Every adapter must catch its own exceptions** and return `[]`. The route logs `[Adapter] error:` to stdout — do not raise, do not propagate, do not log differently.

This includes:
- Missing API key → `return []` (no warning, this is normal in local dev)
- Network timeout → `return []` with `print(f"[Adapter] timeout: {e}")`
- Malformed response → `return []` with `print(f"[Adapter] parse error: {e}")`
- API returned 4xx/5xx → `return []` with `print(f"[Adapter] HTTP {status}: ...")`

### Timeout discipline

Use `httpx.AsyncClient(timeout=N.0)` with N chosen per source:
- Fast JSON APIs (Last.fm, official endpoints): 8 seconds
- HTML scraping (Bandcamp, trackid): 4 seconds for the per-request timeout (the route layer wraps with a slightly longer hard cap — see `BANDCAMP_TIMEOUT` / `TRACKIDNET_TIMEOUT` in `similar.py`). Raising past 4s blocks the whole `/similar` fan-out for the slowest source.
- Auth flows (Yandex token refresh): 10 seconds, but only the first call

Never write `timeout=None` or omit the timeout argument. The default is `5s` which is too tight for some APIs and unbounded for others depending on httpx version.

### TrackMeta field discipline

Field names come from `python-service/app/core/models.py`. Don't guess — check the model. Common mistakes:

- `sourceUrl` not `source_url` — the model uses camelCase to match the TS `TrackMeta` on the web side
- `coverUrl`, `embedUrl` — same
- `score` is optional; set it only when the source has a meaningful similarity score (Cosine sets this; YTM/Bandcamp do not). The aggregator ignores it for RRF.
- `bpm` / `key` / `energy` / `genre` / `label` were dropped from `TrackMeta` and the `Track` schema in Stage H (ADR-0019, ADR-0016). Don't add them back when introducing a new adapter; the data model is `title / artist / source / sourceUrl / coverUrl / embedUrl / score`.

### Result deduplication

Don't dedupe inside the adapter. The `/similar` route applies `_dedup_within_source` and `_filter_artist` for you. Returning duplicates from the adapter is fine; returning the seed's own artist is fine — they get filtered upstream.

### What never to do

- **Don't make multiple requests to dedupe results.** If the API returns 50 with some duplicates, return all 50. The downstream filter handles it.
- **Don't cache inside the adapter** unless the source semantics specifically require it. For most adapters, caching is a separate concern at higher layers (Postgres for cross-search reuse via the web side). Adapter remains a pure async function from `query` to `list[TrackMeta]`. The `LastfmArtistSimilars` cache table (read/written by the Last.fm artist-fallback path) is the active example; the `TrackidCooccurrence` cache mentioned in older docs was removed in ADR-0019.
- **Don't enrich.** If the API returns a similarity score, populate `score`. Don't call other adapters to fill gaps — the post-Stage-F philosophy is "trust the adapters" and there is no inline-enrichment pass anymore.
- **Don't hardcode URLs in production code.** Constants at module top (`API_BASE`, `LIMIT`, `MIN_MATCH`) are fine. Per-call URLs use these constants.

## Wiring into the route

After creating the adapter, wire it into `python-service/app/api/routes/similar.py`:

1. Import: `from app.adapters.<name> import <Name>Adapter`
2. Instantiate at module level: `_<name> = <Name>Adapter()`
3. Add to the Phase 1 `asyncio.gather(...)` block in `_find_by_artist_and_track`. Order matters because of tuple unpacking — match the order in the unpacking line.
4. Add to the `source_lists = [SourceList(...), ...]` construction at the same level as existing sources. Use `_filter_artist(_dedup_within_source(<name>_tracks), source_artist)` — DO NOT skip these wrappers, they are the route's responsibility but are required for every source.

Example:

```python
# Imports
from app.adapters.lastfm import LastfmAdapter

# Module-level instances
_lastfm = LastfmAdapter()

# In _find_by_artist_and_track:
cosine_tracks, ytm_tracks, ..., lastfm_tracks, ytm_search_track = (
    await asyncio.gather(
        _cosine.find_similar(artist, track),
        _ytm.find_similar(artist, track),
        ...,
        _lastfm.find_similar(artist, track),
        _ytm.search_song(artist, track),
        return_exceptions=True,
    )
)

# Source list construction:
source_lists = [
    SourceList(source="cosine_club", tracks=...),
    SourceList(source="youtube_music", tracks=...),
    SourceList(source="bandcamp", tracks=...),
    SourceList(source="yandex_music", tracks=...),
    SourceList(source="lastfm",
               tracks=_filter_artist(_dedup_within_source(lastfm_tracks), source_artist)),
]
```

`source_lists` order does not affect ranking (RRF is order-agnostic). Conventionally append new sources at the end for visual diff clarity in eval JSON output.

### `/random` wiring

Most new adapters do NOT support `/random` (Last.fm, trackid, Cosine.club all return None). For these, do NOT add them to `python-service/app/api/routes/random.py`. The hedged fan-out in random.py only includes adapters that meaningfully implement `random_techno_track`. Adding a None-returning adapter just slows the hedge.

Cosine.club is in this category — its adapter is in `/similar` but NOT in `/random` (no public random endpoint).

## Testing pattern

Tests live in `python-service/tests/test_<name>.py`. Cover:

1. **Happy path**: mock a realistic API response with 3 tracks, assert correct `TrackMeta` mapping
2. **Missing API key**: `settings.<name>_api_key = ""` → returns `[]` without making a network call
3. **Required-field-missing query**: e.g. `track=None` for Last.fm → returns `[]`
4. **API error response (4xx/5xx)**: returns `[]` and logs to stderr (use `capsys` to assert log)
5. **Network exception**: httpx raises during request → returns `[]`, no propagation
6. **Source-specific filters**: e.g. Last.fm's `MIN_MATCH = 0.05` floor — assert tracks below threshold are dropped

Use `respx` if it's already in `python-service/requirements.txt`. Otherwise use `httpx.MockTransport` patched via monkeypatch. Mirror the pattern used in `tests/test_bandcamp.py` or `tests/test_discogs.py` — don't introduce a new mocking library.

## Common pitfalls in this project

- **Forgetting `extra="ignore"` in config.py.** The repo has a single `.env` shared between web and python-service. The Python `Settings` class needs `model_config = SettingsConfigDict(extra="ignore", ...)` or it will fail validation when web-only env vars are present.
- **Snake_case vs camelCase confusion.** `Settings` fields are snake_case (`lastfm_api_key`). `TrackMeta` fields are camelCase (`sourceUrl`). Don't mix.
- **Forgetting the `score` parameter in TrackMeta when source has no score.** It's optional — omit or pass `None`. Don't pass `0.0` (which would be a valid match score meaning "perfect mismatch").
- **Hardcoding the test API key.** Tests should use `monkeypatch.setattr(settings, "<name>_api_key", "test-key")` not real credentials, even ones that work.
