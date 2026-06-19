"""LLM title normalization. Replaces all regex title cleaning: one Claude
Haiku 4.5 call turns raw (artist, title) pairs into canonical display fields
plus deterministic match keys, cached raw->canonical so keys stay stable."""

import json

from anthropic import AsyncAnthropic
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.core.db import fetch_external_cache_many, upsert_external_cache_many

_CACHE_SOURCE = "title_norm"
_MODEL = "claude-haiku-4-5"

_client: AsyncAnthropic | None = None


class TitleNormError(RuntimeError):
    """Raised on any normalization failure. Callers must not persist on this."""


class CanonicalTitle(BaseModel):
    artist: str            # clean display artist
    title: str             # clean display title
    artist_key: str        # canonical artist match key (lowercase, space-joined)
    title_key: str         # canonical title match key (junk + version-equiv removed)
    artist_entities: list[str]  # canonical per-collaborator keys, for seed matching


_ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "index": {"type": "integer"},
        "artist": {"type": "string"},
        "title": {"type": "string"},
        "artist_key": {"type": "string"},
        "title_key": {"type": "string"},
        "artist_entities": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["index", "artist", "title", "artist_key", "title_key", "artist_entities"],
}

_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"results": {"type": "array", "items": _ITEM_SCHEMA}},
    "required": ["results"],
}

_TOOL = {
    "name": "emit_normalized",
    "description": "Return the normalized title metadata, one result per input.",
    "input_schema": _OUTPUT_SCHEMA,
}

_SYSTEM = (
    "You normalize music track metadata. For each input {artist, title} return "
    "an object with: `artist` and `title` = clean human display strings with all "
    "non-title junk removed (promo banners like PREMIERE/FREE DL, vinyl positions "
    "like A1/[B2], label tails after | or //, quality markers like [HD], catalogue "
    "tags like [SOMOV010], and same-recording suffixes like 'Original Mix', "
    "'Extended', 'Radio Edit', 'Remastered', 'feat. X', 'prod. X'); KEEP version "
    "markers that identify a distinct recording (Remix, Dub, Live, VIP, Edit, "
    "Instrumental, Bootleg, '... Version'). `title_key` = the cleaned title "
    "lowercased, accent-folded, punctuation-collapsed to single spaces, version "
    "markers KEPT. `artist_key` = the cleaned artist lowercased, accent-folded, "
    "collaborators joined by ' & ', punctuation-collapsed to single spaces. "
    "`artist_entities` = a list of each collaborator's canonical key (split the "
    "artist on &, comma, feat, vs, x, with). Echo back each input's `index` "
    "unchanged; return exactly one output per input. Output only via the "
    "structured format."
)


def _get_client() -> AsyncAnthropic:
    global _client
    if not settings.anthropic_api_key:
        raise TitleNormError("ANTHROPIC_API_KEY is not set")
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def cache_key(raw_artist: str, raw_title: str) -> str:
    return f"{(raw_artist or '').strip()}␟{(raw_title or '').strip()}"


async def normalize(items: list[tuple[str, str]]) -> list[CanonicalTitle]:
    """Canonicalize (raw_artist, raw_title) pairs. Cache hits skip the LLM;
    misses go in one Claude call and are persisted. Raises TitleNormError on
    any failure without persisting."""
    if not items:
        return []

    keys = [cache_key(a, t) for a, t in items]
    cached_raw = await fetch_external_cache_many(source=_CACHE_SOURCE, cache_keys=keys)

    cache: dict[str, CanonicalTitle] = {}
    for k, payload in cached_raw.items():
        try:
            cache[k] = CanonicalTitle(**payload)
        except (ValidationError, TypeError):
            continue  # corrupt row -> treat as miss

    miss_idx = [i for i, k in enumerate(keys) if k not in cache]
    if miss_idx:
        miss_items = [items[i] for i in miss_idx]
        fresh = await _call_llm(miss_items)
        to_persist: list[tuple[str, dict]] = []
        for i, canon in zip(miss_idx, fresh):
            cache[keys[i]] = canon
            to_persist.append((keys[i], canon.model_dump()))
        await upsert_external_cache_many(source=_CACHE_SOURCE, items=to_persist)

    return [cache[k] for k in keys]


async def _call_llm(items: list[tuple[str, str]]) -> list[CanonicalTitle]:
    client = _get_client()
    payload = [{"index": i, "artist": a, "title": t} for i, (a, t) in enumerate(items)]
    user = json.dumps(payload, ensure_ascii=False)
    try:
        resp = await client.messages.create(
            model=_MODEL,
            max_tokens=4096,
            system=_SYSTEM,
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "emit_normalized"},
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next(b for b in resp.content if b.type == "tool_use")
        raw = tool_use.input["results"]
        # Reconcile by echoed index, not position — a reordered batch must not
        # mis-assign canonical keys to the wrong track.
        by_index = {r["index"]: CanonicalTitle.model_validate(r) for r in raw}
        results = [by_index[i] for i in range(len(items))]
    except Exception as e:
        raise TitleNormError(f"title normalization failed: {e}") from e
    if len(results) != len(items):
        raise TitleNormError(
            f"normalizer returned {len(results)} results for {len(items)} items"
        )
    return results
