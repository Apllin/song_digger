# LLM Title Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every regex/mechanical title cleaning, sanitization, and key-generation path in both services with a single Claude Haiku 4.5 normalizer whose `raw → canonical` output is cached in Postgres.

**Architecture:** A new `app/core/title_llm.py` calls Claude Haiku 4.5 with structured output to turn `(raw_artist, raw_title)` pairs into `{artist, title, artist_key, title_key, artist_entities}`, batching uncached items into one call per search and persisting them in the existing `ExternalApiCache` table (never-expiring). Seed matching (`seed_match.py`, replacing `_seed_match.py`) and output dedup/display now consume those canonical keys instead of regex. `TrackMeta` carries `artistKey`/`titleKey`; the web side reads them verbatim for RRF fusion, the search cache, and dislike matching. On any LLM failure the normalizer raises and persists nothing.

**Tech Stack:** FastAPI + httpx + asyncpg (python-service), Anthropic Python SDK (`anthropic`), Next.js + Zod + kubb-generated client (web), pytest (`asyncio_mode = auto`), vitest.

## Global Constraints

- **Model:** `claude-haiku-4-5` — exact string, no date suffix. Do not use any other model.
- **SDK:** Anthropic Python SDK (`anthropic`), `AsyncAnthropic`. Structured output via `output_config={"format": {"type": "json_schema", "schema": ...}}` on `client.messages.create`. No thinking/effort params (Haiku rejects `effort`). `max_tokens=4096`.
- **Fail loud:** any normalization failure (network, rate limit, missing key, malformed/short output) raises; **never persist a fallback/raw value** into a keyed store.
- **Batch every DB round-trip:** Postgres is remote (~30–80 ms RTT). Cache reads and writes for a title batch must be single queries, never per-item loops.
- **Persistent cache:** `ExternalApiCache` with `source="title_norm"`, `ttl_seconds=None` (never expires).
- **pytest:** `asyncio_mode = auto` — do **not** decorate async tests with `@pytest.mark.asyncio`.
- **Comments:** at most one short line; no multi-line explanatory blocks.
- **Copy/strings:** English only.
- **After editing FastAPI routes / Pydantic models:** run `pnpm codegen` from repo root.
- **Zero regex remaining:** at the end, no title-cleaning regex exists in either service.

---

### Task 1: Dependency + config + env

**Files:**
- Modify: `python-service/requirements.txt`
- Modify: `python-service/app/config.py:11` (add field near other keys)
- Modify: `.env.example`

**Interfaces:**
- Produces: `settings.anthropic_api_key: str` (empty default).

- [ ] **Step 1: Add the SDK dependency**

Add to `python-service/requirements.txt` (after `httpx==0.28.1`):

```
anthropic==0.69.0
```

- [ ] **Step 2: Add the config field**

In `python-service/app/config.py`, inside `class Settings`, next to the other key fields:

```python
    # Anthropic API key for LLM title normalization. Empty in tests; the
    # normalizer raises loudly at call time when unset rather than degrading.
    anthropic_api_key: str = ""
```

- [ ] **Step 3: Document the env var**

Add to `.env.example`:

```
# Claude API key — required for LLM title normalization (python-service)
ANTHROPIC_API_KEY=
```

- [ ] **Step 4: Install + verify import**

Run: `pnpm setup` (or `cd python-service && .venv/bin/pip install -r requirements.txt`)
Then: `cd python-service && .venv/bin/python -c "import anthropic; from app.config import settings; print(settings.anthropic_api_key == '')"`
Expected: prints `True`.

- [ ] **Step 5: Commit**

```bash
git add python-service/requirements.txt python-service/app/config.py .env.example
git commit -m "feat(python-service): add anthropic SDK dep + ANTHROPIC_API_KEY config"
```

---

### Task 2: Batched ExternalApiCache helpers

**Files:**
- Modify: `python-service/app/core/db.py` (append after `upsert_external_cache`)
- Test: `python-service/tests/test_external_api_cache.py` (add cases — follow the existing fake-pool pattern in that file)

**Interfaces:**
- Produces:
  - `async def fetch_external_cache_many(*, source: str, cache_keys: list[str]) -> dict[str, Any]`
    — returns `{cache_key: payload}` for the keys present (decoded); missing keys absent; `{}` on DB-unavailable/empty input. No TTL (title norms never expire).
  - `async def upsert_external_cache_many(*, source: str, items: list[tuple[str, Any]]) -> None`
    — one multi-row upsert of `(cache_key, payload)` pairs; no-op on DB-unavailable/empty input.

- [ ] **Step 1: Write the failing tests**

Add to `python-service/tests/test_external_api_cache.py` (reuse this file's existing fake `conn`/`pool` fixtures; if it monkeypatches `db._get_pool`, do the same here):

```python
async def test_fetch_many_returns_present_keys(monkeypatch):
    rows = [
        {"cacheKey": "a", "payload": '{"x": 1}'},
        {"cacheKey": "b", "payload": {"y": 2}},
    ]
    monkeypatch.setattr(db, "_get_pool", _fake_pool_returning(rows))
    out = await db.fetch_external_cache_many(source="title_norm", cache_keys=["a", "b", "c"])
    assert out == {"a": {"x": 1}, "b": {"y": 2}}


async def test_fetch_many_empty_input_no_query():
    assert await db.fetch_external_cache_many(source="title_norm", cache_keys=[]) == {}


async def test_upsert_many_empty_input_noop():
    await db.upsert_external_cache_many(source="title_norm", items=[])  # must not raise
```

Add a small helper near the other fakes in the file:

```python
def _fake_pool_returning(rows):
    class _Conn:
        async def fetch(self, *a, **k): return rows
        async def execute(self, *a, **k): return None
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
    class _Pool:
        def acquire(self): return _Conn()
    async def _get(): return _Pool()
    return _get
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python-service && .venv/bin/pytest tests/test_external_api_cache.py -k "many" -v`
Expected: FAIL with `AttributeError: module 'app.core.db' has no attribute 'fetch_external_cache_many'`.

- [ ] **Step 3: Implement the helpers**

Append to `python-service/app/core/db.py`:

```python
async def fetch_external_cache_many(
    *, source: str, cache_keys: list[str]
) -> dict[str, Any]:
    """Batched read of cached payloads for `cache_keys` (no TTL). Returns a
    {cache_key: payload} map of the rows present; missing keys are absent."""
    if not source or not cache_keys:
        return {}
    pool = await _get_pool()
    if pool is None:
        return {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT "cacheKey", "payload"
                FROM "ExternalApiCache"
                WHERE "source" = $1 AND "cacheKey" = ANY($2::text[])
                """,
                source, cache_keys,
            )
    except Exception as e:
        print(f"[cache] batch lookup failed source={source}: {e}")
        return {}
    out: dict[str, Any] = {}
    for row in rows:
        raw = row["payload"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        out[row["cacheKey"]] = raw
    _log_cache_event("HIT", source, f"<batch {len(out)}/{len(cache_keys)}>", {})
    return out


async def upsert_external_cache_many(
    *, source: str, items: list[tuple[str, Any]]
) -> None:
    """Batched upsert of (cache_key, payload) pairs into ExternalApiCache."""
    if not source or not items:
        return
    pool = await _get_pool()
    if pool is None:
        return
    keys = [k for k, _ in items]
    payloads = [json.dumps(v) for _, v in items]
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "ExternalApiCache"
                  (id, "source", "cacheKey", "payload", "createdAt", "updatedAt")
                SELECT gen_random_uuid()::text, $1, k, p::jsonb, now(), now()
                FROM unnest($2::text[], $3::text[]) AS t(k, p)
                ON CONFLICT ("source", "cacheKey") DO UPDATE
                SET "payload" = EXCLUDED."payload", "updatedAt" = now()
                """,
                source, keys, payloads,
            )
    except Exception as e:
        print(f"[cache] batch upsert failed source={source}: {e}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python-service && .venv/bin/pytest tests/test_external_api_cache.py -k "many" -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add python-service/app/core/db.py python-service/tests/test_external_api_cache.py
git commit -m "feat(python-service): batched ExternalApiCache read/write helpers"
```

---

### Task 3: `title_llm.py` — the LLM normalizer

**Files:**
- Create: `python-service/app/core/title_llm.py`
- Test: `python-service/tests/test_title_llm.py`

**Interfaces:**
- Produces:
  - `class CanonicalTitle(BaseModel)` with fields `artist: str`, `title: str`, `artist_key: str`, `title_key: str`, `artist_entities: list[str]`.
  - `async def normalize(items: list[tuple[str, str]]) -> list[CanonicalTitle]`
    — one `CanonicalTitle` per input `(raw_artist, raw_title)`, same order. Cache hits skip the LLM; only misses are sent in one Claude call; results are persisted. Raises `TitleNormError` on any LLM/parse failure (nothing persisted). `[]` input → `[]` (no call).
  - `class TitleNormError(RuntimeError)`.
  - `def cache_key(raw_artist: str, raw_title: str) -> str` — stable per-pair key.

- [ ] **Step 1: Write the failing tests**

Create `python-service/tests/test_title_llm.py`:

```python
import json
import pytest

from app.core import title_llm
from app.core.title_llm import CanonicalTitle, TitleNormError


def _canon(artist, title, ak, tk, ents):
    return {"artist": artist, "title": title, "artist_key": ak,
            "title_key": tk, "artist_entities": ents}


class _FakeMessages:
    def __init__(self, payload, raise_exc=None):
        self._payload = payload
        self._raise = raise_exc
    async def create(self, **kwargs):
        if self._raise:
            raise self._raise
        class _Block: text = json.dumps(self._payload)
        class _Resp: content = [_Block()]
        return _Resp()


class _FakeClient:
    def __init__(self, payload, raise_exc=None):
        self.messages = _FakeMessages(payload, raise_exc)


async def test_empty_input_no_call(monkeypatch):
    monkeypatch.setattr(title_llm, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("called")))
    assert await title_llm.normalize([]) == []


async def test_all_cached_skips_llm(monkeypatch):
    key = title_llm.cache_key("Foo", "Bar (Original Mix)")
    cached = {key: _canon("Foo", "Bar", "foo", "bar", ["foo"])}
    async def _fetch(**k): return cached
    async def _upsert(**k): raise AssertionError("should not write")
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("LLM called")))
    out = await title_llm.normalize([("Foo", "Bar (Original Mix)")])
    assert out == [CanonicalTitle(**cached[key])]


async def test_miss_calls_llm_and_persists(monkeypatch):
    async def _fetch(**k): return {}
    written = {}
    async def _upsert(*, source, items): written.update(dict(items))
    payload = {"results": [_canon("Foo", "Bar", "foo", "bar", ["foo"])]}
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", lambda: _FakeClient(payload))
    out = await title_llm.normalize([("Foo", "PREMIERE | Bar")])
    assert out[0].title_key == "bar"
    assert written  # persisted


async def test_llm_error_raises_and_no_persist(monkeypatch):
    async def _fetch(**k): return {}
    async def _upsert(**k): raise AssertionError("must not persist on error")
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", lambda: _FakeClient(None, raise_exc=RuntimeError("boom")))
    with pytest.raises(TitleNormError):
        await title_llm.normalize([("Foo", "Bar")])


async def test_count_mismatch_raises(monkeypatch):
    async def _fetch(**k): return {}
    async def _upsert(**k): pass
    payload = {"results": []}  # asked for 1, got 0
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", lambda: _FakeClient(payload))
    with pytest.raises(TitleNormError):
        await title_llm.normalize([("Foo", "Bar")])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python-service && .venv/bin/pytest tests/test_title_llm.py -v`
Expected: FAIL (module `app.core.title_llm` not found).

- [ ] **Step 3: Implement the module**

Create `python-service/app/core/title_llm.py`:

```python
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
        "artist": {"type": "string"},
        "title": {"type": "string"},
        "artist_key": {"type": "string"},
        "title_key": {"type": "string"},
        "artist_entities": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["artist", "title", "artist_key", "title_key", "artist_entities"],
}

_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"results": {"type": "array", "items": _ITEM_SCHEMA}},
    "required": ["results"],
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
    "artist on &, comma, feat, vs, x, with). Preserve input order; one output per "
    "input. Output only via the structured format."
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
    user = json.dumps([{"artist": a, "title": t} for a, t in items], ensure_ascii=False)
    try:
        resp = await client.messages.create(
            model=_MODEL,
            max_tokens=4096,
            system=_SYSTEM,
            output_config={"format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}},
            messages=[{"role": "user", "content": user}],
        )
        data = json.loads(resp.content[0].text)
        results = [CanonicalTitle(**r) for r in data["results"]]
    except Exception as e:
        raise TitleNormError(f"title normalization failed: {e}") from e
    if len(results) != len(items):
        raise TitleNormError(
            f"normalizer returned {len(results)} results for {len(items)} items"
        )
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python-service && .venv/bin/pytest tests/test_title_llm.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add python-service/app/core/title_llm.py python-service/tests/test_title_llm.py
git commit -m "feat(python-service): LLM title normalizer with persistent cache"
```

---

### Task 4: `seed_match.py` — canonical seed matching

**Files:**
- Create: `python-service/app/core/seed_match.py`
- Test: `python-service/tests/test_seed_match.py`
- (Deletion of `app/adapters/_seed_match.py` happens in Task 12 after all adapters migrate.)

**Interfaces:**
- Consumes: `title_llm.normalize`.
- Produces:
  - Constants `MATCH_NONE=0`, `MATCH_ARTIST=1`, `MATCH_ARTIST_EXACT=2`, `MATCH_EXACT=3`, `SEED_CANDIDATES=5`.
  - `async def score_candidates(query: str, candidates: list[tuple[str, str]]) -> list[int]`
    — scores each `(artist, title)` candidate against `query` (parallel list, same order). One batched `title_llm.normalize` call for query + all candidates.
  - `async def pick_best_candidate(query: str, candidates: list[tuple[str, str]]) -> int | None`
    — index of the highest-scoring candidate (>0), or None.

- [ ] **Step 1: Write the failing tests**

Create `python-service/tests/test_seed_match.py`:

```python
from app.core import seed_match
from app.core.seed_match import MATCH_EXACT, MATCH_ARTIST, MATCH_ARTIST_EXACT, MATCH_NONE
from app.core.title_llm import CanonicalTitle


def _fake_normalize(mapping):
    async def _norm(items):
        return [mapping[(a, t)] for a, t in items]
    return _norm


async def test_artist_title_exact(monkeypatch):
    mapping = {
        ("Ignez", "Aventurine"): CanonicalTitle(artist="Ignez", title="Aventurine", artist_key="ignez", title_key="aventurine", artist_entities=["ignez"]),
        ("Ignez", "Aventurine (Original Mix)"): CanonicalTitle(artist="Ignez", title="Aventurine", artist_key="ignez", title_key="aventurine", artist_entities=["ignez"]),
        ("Other", "Wrong Song"): CanonicalTitle(artist="Other", title="Wrong Song", artist_key="other", title_key="wrong song", artist_entities=["other"]),
    }
    monkeypatch.setattr(seed_match, "normalize", _fake_normalize(mapping))
    scores = await seed_match.score_candidates(
        "Ignez - Aventurine",
        [("Ignez", "Aventurine (Original Mix)"), ("Other", "Wrong Song")],
    )
    assert scores == [MATCH_EXACT, MATCH_NONE]


async def test_bare_artist_entity_exact_beats_subset(monkeypatch):
    mapping = {
        ("Rill", ""): CanonicalTitle(artist="Rill", title="", artist_key="rill", title_key="", artist_entities=["rill"]),
        ("Rill & X", "Track A"): CanonicalTitle(artist="Rill & X", title="Track A", artist_key="rill & x", title_key="track a", artist_entities=["rill", "x"]),
        ("Rill Saionji", "Track B"): CanonicalTitle(artist="Rill Saionji", title="Track B", artist_key="rill saionji", title_key="track b", artist_entities=["rill saionji"]),
    }
    monkeypatch.setattr(seed_match, "normalize", _fake_normalize(mapping))
    scores = await seed_match.score_candidates("Rill", [("Rill & X", "Track A"), ("Rill Saionji", "Track B")])
    assert scores == [MATCH_ARTIST_EXACT, MATCH_ARTIST]


async def test_pick_best_returns_none_when_no_match(monkeypatch):
    mapping = {
        ("A", "B"): CanonicalTitle(artist="A", title="B", artist_key="a", title_key="b", artist_entities=["a"]),
        ("C", "D"): CanonicalTitle(artist="C", title="D", artist_key="c", title_key="d", artist_entities=["c"]),
    }
    monkeypatch.setattr(seed_match, "normalize", _fake_normalize(mapping))
    assert await seed_match.pick_best_candidate("A - B", [("C", "D")]) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python-service && .venv/bin/pytest tests/test_seed_match.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

Create `python-service/app/core/seed_match.py`:

```python
"""Seed-match validation on LLM-canonical keys. Several adapters resolve a
free-form query to an upstream seed; an off-genre fuzzy hit poisons every
recommendation, so candidates are scored against the query's canonical keys."""

from app.core.title_llm import CanonicalTitle, normalize

SEED_CANDIDATES = 5

MATCH_NONE = 0
MATCH_ARTIST = 1          # bare-artist: query is a subset of candidate artist tokens
MATCH_ARTIST_EXACT = 2    # bare-artist: query equals one collab-split entity
MATCH_EXACT = 3           # "Artist - Title": title keys equal, artists overlap


def _subset(a: set[str], b: set[str]) -> bool:
    if not a or not b:
        return False
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    return shorter.issubset(longer)


def _score(q: CanonicalTitle, q_is_artist_title: bool, cand: CanonicalTitle) -> int:
    q_tokens = set(q.artist_key.split())
    cand_tokens = set(cand.artist_key.split())
    if not q_is_artist_title:
        if not _subset(q_tokens, cand_tokens):
            return MATCH_NONE
        if any(q_tokens == set(e.split()) for e in cand.artist_entities):
            return MATCH_ARTIST_EXACT
        return MATCH_ARTIST
    if not _subset(q_tokens, cand_tokens):
        return MATCH_NONE
    if not q.title_key or not cand.title_key:
        return MATCH_NONE
    return MATCH_EXACT if q.title_key == cand.title_key else MATCH_NONE


async def score_candidates(query: str, candidates: list[tuple[str, str]]) -> list[int]:
    is_artist_title = " - " in query
    if is_artist_title:
        q_artist, q_title = (p.strip() for p in query.split(" - ", 1))
    else:
        q_artist, q_title = query.strip(), ""
    canon = await normalize([(q_artist, q_title), *candidates])
    q_canon, cand_canon = canon[0], canon[1:]
    return [_score(q_canon, is_artist_title, c) for c in cand_canon]


async def pick_best_candidate(query: str, candidates: list[tuple[str, str]]) -> int | None:
    scores = await score_candidates(query, candidates)
    best_i, best_s = -1, MATCH_NONE
    for i, s in enumerate(scores):
        if s > best_s:
            best_s, best_i = s, i
    return best_i if best_i >= 0 else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python-service && .venv/bin/pytest tests/test_seed_match.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add python-service/app/core/seed_match.py python-service/tests/test_seed_match.py
git commit -m "feat(python-service): LLM-canonical seed matching"
```

---

### Task 5: `TrackMeta` gains canonical key fields

**Files:**
- Modify: `python-service/app/core/models.py:4-17` (TrackMeta)
- Test: `python-service/tests/test_regression.py` (add a field-presence assertion)

**Interfaces:**
- Produces: `TrackMeta.artistKey: str = ""`, `TrackMeta.titleKey: str = ""` (defaults keep adapters that build TrackMeta directly valid until the route fills them).

- [ ] **Step 1: Add the fields**

In `python-service/app/core/models.py`, add to `class TrackMeta` after `artist`:

```python
    artistKey: str = ""   # canonical artist match key (filled by the title-norm pass)
    titleKey: str = ""    # canonical title match key (filled by the title-norm pass)
```

- [ ] **Step 2: Assert presence**

Add to `python-service/tests/test_regression.py`:

```python
def test_trackmeta_has_canonical_keys():
    from app.core.models import TrackMeta
    t = TrackMeta(title="t", artist="a", source="s", sourceUrl="u")
    assert t.artistKey == "" and t.titleKey == ""
```

- [ ] **Step 3: Run + commit**

Run: `cd python-service && .venv/bin/pytest tests/test_regression.py::test_trackmeta_has_canonical_keys -v` → PASS

```bash
git add python-service/app/core/models.py python-service/tests/test_regression.py
git commit -m "feat(python-service): add artistKey/titleKey to TrackMeta"
```

---

### Task 6: Migrate cosine_club adapter to canonical seed matching

**Files:**
- Modify: `python-service/app/adapters/cosine_club.py:3` (import) and `:106-140` (`_search_seed_id`)
- Test: `python-service/tests/test_cosine_club.py` (update seed-resolution test to stub `seed_match.pick_best_candidate`)

**Interfaces:**
- Consumes: `seed_match.SEED_CANDIDATES`, `seed_match.pick_best_candidate`.

- [ ] **Step 1: Update the import**

Replace line 3:

```python
from app.core.seed_match import SEED_CANDIDATES, pick_best_candidate
```

- [ ] **Step 2: Rewrite `_search_seed_id` to use the batched matcher**

Replace the candidate-scoring loop body (the `best_idx`/`best_score` loop, lines ~125-140) with:

```python
        candidates = [
            (c.get("artist") or "", c.get("track") or c.get("name") or "")
            for c in data
        ]
        idx = await pick_best_candidate(query, candidates)
        if idx is None:
            return None
        cand = data[idx]
        cand_artist, cand_title = candidates[idx]
        print(f"[CosineClub] seed for {query!r} -> {cand_artist} - {cand_title} (id={cand.get('id')})")
        return cand.get("id")
```

(Delete the now-unused `best_idx`/`best_score`/`query_match_score` lines and any trailing remnant of the old return.)

- [ ] **Step 3: Update the test**

In `tests/test_cosine_club.py`, where the seed test previously relied on `query_match_score`, stub the new entrypoint:

```python
async def test_search_seed_id_picks_match(monkeypatch):
    async def _pick(query, candidates): return 0
    monkeypatch.setattr("app.adapters.cosine_club.pick_best_candidate", _pick)
    # ... existing httpx mock returning data[0] with an id ...
    # assert the resolved seed id == data[0]["id"]
```

- [ ] **Step 4: Run + commit**

Run: `cd python-service && .venv/bin/pytest tests/test_cosine_club.py -v` → PASS

```bash
git add python-service/app/adapters/cosine_club.py python-service/tests/test_cosine_club.py
git commit -m "feat(cosine_club): canonical seed matching via title_llm"
```

---

### Task 7: Migrate yandex_music adapter

**Files:**
- Modify: `python-service/app/adapters/yandex_music.py:3` and `:77-108` (`_pick_seed`)
- Test: `python-service/tests/test_youtube_music.py`/`test_*` for yandex if present, else add to `tests/test_regression.py`

**Interfaces:**
- Consumes: `seed_match.SEED_CANDIDATES`, `seed_match.pick_best_candidate`.

- [ ] **Step 1: Update import (line 3)**

```python
from app.core.seed_match import SEED_CANDIDATES, pick_best_candidate
```

- [ ] **Step 2: Make `_pick_seed` async + batched**

Replace the `@staticmethod def _pick_seed(query, candidates)` with:

```python
    @staticmethod
    async def _pick_seed(query: str, candidates: list[Any]) -> Any | None:
        """Return the best query-matching candidate, or None (off-genre fuzzy
        hits are rejected via canonical seed matching)."""
        pairs = [
            (
                ", ".join(a.name for a in (getattr(c, "artists", None) or []) if getattr(a, "name", None)),
                getattr(c, "title", "") or "",
            )
            for c in candidates
        ]
        idx = await pick_best_candidate(query, pairs)
        if idx is None:
            print(f"[YandexMusic] no seed matched query {query!r}")
            return None
        return candidates[idx]
```

- [ ] **Step 3: Await the call site**

Find the caller of `self._pick_seed(...)` / `YandexMusicAdapter._pick_seed(...)` in this file and add `await`. Run: `grep -n "_pick_seed" python-service/app/adapters/yandex_music.py` and update each call to `await ..._pick_seed(...)` (the enclosing method is already `async`).

- [ ] **Step 4: Run + commit**

Run: `cd python-service && .venv/bin/pytest -k yandex -v` → PASS (or full suite if no yandex-specific file)

```bash
git add python-service/app/adapters/yandex_music.py
git commit -m "feat(yandex_music): canonical seed matching via title_llm"
```

---

### Task 8: Migrate youtube_music adapter

**Files:**
- Modify: `python-service/app/adapters/youtube_music.py:6` and `:27-63` (`_pick_seed_video_id`); the videos-fallback `_pick_seed_video_id_from_videos` (token-bag, lines ~83-110) keeps its own logic but must drop the `_normalize` import.
- Test: `python-service/tests/test_youtube_music.py`

**Interfaces:**
- Consumes: `seed_match.SEED_CANDIDATES`, `seed_match.pick_best_candidate`.

- [ ] **Step 1: Update import (line 6)**

The videos-fallback used `_normalize` from `_seed_match`. Replace the import with:

```python
from app.core.seed_match import SEED_CANDIDATES, pick_best_candidate
```

and add a tiny local for the videos-fallback bag (matching infra, not title cleaning — keep it):

```python
def _bag(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", s.lower()) if t}
```

Update `_pick_seed_video_id_from_videos` to use `_bag(...)` where it called `_normalize(...)`.

- [ ] **Step 2: Make `_pick_seed_video_id` async + batched**

Replace its scoring loop:

```python
async def _pick_seed_video_id(query: str, results: list[dict]) -> str | None:
    """Return the videoId of the best query-matching hit, or None."""
    pairs = [
        (
            ", ".join(a.get("name", "") for a in (c.get("artists") or []) if a.get("name")),
            c.get("title") or "",
        )
        for c in results
    ]
    idx = await pick_best_candidate(query, pairs)
    if idx is None:
        print(f"[YouTubeMusic] no seed matched query {query!r}")
        return None
    return results[idx].get("videoId")
```

- [ ] **Step 3: Await the call site**

`grep -n "_pick_seed_video_id(" python-service/app/adapters/youtube_music.py` and add `await` (enclosing resolver is async).

- [ ] **Step 4: Run + commit**

Run: `cd python-service && .venv/bin/pytest tests/test_youtube_music.py -v` → PASS

```bash
git add python-service/app/adapters/youtube_music.py python-service/tests/test_youtube_music.py
git commit -m "feat(youtube_music): canonical seed matching via title_llm"
```

---

### Task 9: Migrate beatport adapter

**Files:**
- Modify: `python-service/app/adapters/beatport.py:8` and `:167-184` (`_fetch_bpm_key`)
- Test: `python-service/tests/test_regression.py` or existing beatport coverage

**Interfaces:**
- Consumes: `seed_match.score_candidates`, `seed_match.MATCH_EXACT`.

- [ ] **Step 1: Update import (line 8)**

```python
from app.core.seed_match import score_candidates, MATCH_EXACT
```

- [ ] **Step 2: Rewrite the match loop in `_fetch_bpm_key`**

Replace the `for t in results:` block:

```python
        match_query = f"{artist} - {title}"
        scores = await score_candidates(match_query, [(t.artist, t.title) for t in results])
        for t, score in zip(results, scores):
            if t.bpm is None or t.key is None:
                continue
            if score >= MATCH_EXACT:
                return t.bpm, t.key, t.genre
        return None
```

- [ ] **Step 3: Run + commit**

Run: `cd python-service && .venv/bin/pytest -k beatport -v` → PASS

```bash
git add python-service/app/adapters/beatport.py
git commit -m "feat(beatport): canonical seed matching via title_llm"
```

---

### Task 10: Migrate soundcloud adapter (seed match + delete `_clean_title`)

**Files:**
- Modify: `python-service/app/adapters/soundcloud.py` — imports (lines 21, 24), `_clean_title` (125-133, delete), `_seed_match_score`/`_pick_seed` (177-200, rewrite async), `_parse_tracks` title build (226, use raw title), and the regex constants `_TITLE_PREFIX_RE`/`_PROMO_SUFFIX_RE`/`_CATALOG_SUFFIX_RE`/`_LABEL_SUFFIX_RE` (delete — find with grep).
- Test: `python-service/tests/test_soundcloud.py` — delete the `test_title_clean_*` cases (cleaning now lives in the LLM/route); keep/adjust seed-pick tests by stubbing `score_candidates`.

**Interfaces:**
- Consumes: `seed_match.score_candidates`, `seed_match.MATCH_NONE`.

- [ ] **Step 1: Replace imports (lines 21, 24)**

Remove `from app.core.title_norm import strip_recording_suffixes` and the `_seed_match` import. Add:

```python
from app.core.seed_match import score_candidates, MATCH_NONE
```

- [ ] **Step 2: Delete `_clean_title` and its regex constants**

Delete the `_clean_title` function (125-133) and the `_TITLE_PREFIX_RE`, `_PROMO_SUFFIX_RE`, `_CATALOG_SUFFIX_RE`, `_LABEL_SUFFIX_RE` definitions (`grep -n "_TITLE_PREFIX_RE\|_PROMO_SUFFIX_RE\|_CATALOG_SUFFIX_RE\|_LABEL_SUFFIX_RE" python-service/app/adapters/soundcloud.py`).

- [ ] **Step 3: Use the raw title in `_parse_tracks` (line 226)**

```python
        title = a.get_text(strip=True) or _slug_to_name(track_slug)
```

(Display cleaning now happens centrally in the route's LLM pass.)

- [ ] **Step 4: Rewrite `_pick_seed` async + batched, preserving the embedded "Artist - Title" attempt**

Replace `_seed_match_score` and `_pick_seed` (177-200):

```python
async def _pick_seed(query: str, html: str) -> str | None:
    """Return the best query-matching track URL from a search page, or None.
    Each track is scored both as (uploader, title) and, when the title embeds
    'Artist - Title', as that embedded pair; the better score wins."""
    tracks = _parse_tracks(html, _SEED_SCAN_LIMIT)
    pairs: list[tuple[str, str]] = []
    owner: list[int] = []  # pairs[i] belongs to tracks[owner[i]]
    for ti, cand in enumerate(tracks):
        pairs.append((cand.artist, cand.title))
        owner.append(ti)
        if " - " in cand.title:
            ea, _, et = cand.title.partition(" - ")
            pairs.append((ea.strip(), et.strip()))
            owner.append(ti)
    if not pairs:
        print(f"[SoundCloud] no seed matched query {query!r}")
        return None
    scores = await score_candidates(query, pairs)
    best_track, best_score = -1, MATCH_NONE
    for pi, sc in enumerate(scores):
        if sc > best_score:
            best_score, best_track = sc, owner[pi]
    if best_track < 0:
        print(f"[SoundCloud] no seed matched query {query!r}")
        return None
    return tracks[best_track].sourceUrl
```

- [ ] **Step 5: Await the `_pick_seed` call site**

`grep -n "_pick_seed(" python-service/app/adapters/soundcloud.py` → add `await` (enclosing method is async).

- [ ] **Step 6: Update tests**

In `tests/test_soundcloud.py`: delete `test_title_clean_*` cases; for seed tests stub `app.adapters.soundcloud.score_candidates` with an async function returning a scores list.

- [ ] **Step 7: Run + commit**

Run: `cd python-service && .venv/bin/pytest tests/test_soundcloud.py -v` → PASS

```bash
git add python-service/app/adapters/soundcloud.py python-service/tests/test_soundcloud.py
git commit -m "feat(soundcloud): canonical seed matching; drop regex title cleaning"
```

---

### Task 11: Central title normalization in the `/similar` route

**Files:**
- Modify: `python-service/app/api/routes/similar.py` — import (line 5, delete `title_norm`), `_normalize_title` (92-97, replace usage with canonical keys), `_clean_source_titles` (357-372, rewrite as the LLM pass that fills display + keys), and the dedup path that used `_normalize_title`.
- Test: `python-service/tests/test_similar.py`

**Interfaces:**
- Consumes: `title_llm.normalize`.
- Produces: every returned `TrackMeta` has cleaned `title`/`artist` and filled `artistKey`/`titleKey`; dedup uses `titleKey`.

- [ ] **Step 1: Replace the import (line 5)**

Remove `from app.core.title_norm import clean_title, strip_recording_suffixes`. Add:

```python
from app.core.title_llm import normalize as normalize_titles
```

- [ ] **Step 2: Rewrite `_clean_source_titles` as the canonical pass**

Replace `_clean_source_titles` (357-372) with an async function that batch-normalizes every track across all sources in one call and fills display + keys:

```python
async def _normalize_source_titles(source_lists: list[SourceList]) -> list[SourceList]:
    """Fill cleaned display title/artist and canonical artistKey/titleKey on
    every track via one batched LLM call. Raises on failure (no partial writes)."""
    flat = [(t.artist, t.title) for sl in source_lists for t in sl.tracks]
    if not flat:
        return source_lists
    canon = await normalize_titles(flat)
    out: list[SourceList] = []
    it = iter(canon)
    for sl in source_lists:
        tracks = []
        for t in sl.tracks:
            c = next(it)
            tracks.append(t.model_copy(update={
                "title": c.title or t.title,
                "artist": c.artist or t.artist,
                "artistKey": c.artist_key,
                "titleKey": c.title_key,
            }))
        out.append(SourceList(source=sl.source, tracks=tracks))
    return out
```

Update the caller (where `_clean_source_titles(source_lists)` was invoked in the handler) to `source_lists = await _normalize_source_titles(source_lists)`, sequenced **before** any dedup/return.

- [ ] **Step 3: Replace `_normalize_title` dedup usage**

Delete `_normalize_title` (92-97). Wherever it was used for within-source dedup, key on the already-filled `t.titleKey` (run `grep -n "_normalize_title" python-service/app/api/routes/similar.py` and replace each use; dedup must run after `_normalize_source_titles`).

- [ ] **Step 4: Update tests**

In `tests/test_similar.py`, stub `app.api.routes.similar.normalize_titles` with an async function returning `CanonicalTitle`s for the fixtures; assert returned tracks carry `titleKey`.

- [ ] **Step 5: Run + commit**

Run: `cd python-service && .venv/bin/pytest tests/test_similar.py -v` → PASS

```bash
git add python-service/app/api/routes/similar.py python-service/tests/test_similar.py
git commit -m "feat(similar): central LLM title normalization + key-based dedup"
```

---

### Task 12: ytm_playlist exact-resolver + delete `title_norm.py` and `_seed_match.py`

**Files:**
- Modify: `python-service/app/api/routes/ytm_playlist.py:6` (drop `_title_signature` import; use `title_llm` for the seed title key)
- Delete: `python-service/app/core/title_norm.py`, `python-service/app/adapters/_seed_match.py`
- Delete: `python-service/tests/test_title_norm.py`, `python-service/tests/test_title_clean.py`

**Interfaces:**
- Consumes: `title_llm.normalize` (for the embed-resolver's exact title comparison).

- [ ] **Step 1: Rework ytm_playlist's signature usage**

`grep -n "_title_signature" python-service/app/api/routes/ytm_playlist.py`. Replace the `_title_signature(x)` calls with the canonical `title_key` from a `await normalize_titles([(artist, title)])` lookup (batch the seed + candidates the same way as the adapters). Import:

```python
from app.core.title_llm import normalize as normalize_titles
```

Make the enclosing resolver function `async` if it isn't, and `await` its callers.

- [ ] **Step 2: Delete the dead modules + tests**

```bash
git rm python-service/app/core/title_norm.py python-service/app/adapters/_seed_match.py \
       python-service/tests/test_title_norm.py python-service/tests/test_title_clean.py
```

- [ ] **Step 3: Verify nothing imports them**

Run: `grep -rn "title_norm\|_seed_match\|query_match_score\|strip_recording_suffixes\|clean_title" python-service/app`
Expected: **no matches**.

- [ ] **Step 4: Run the whole python suite**

Run: `cd python-service && .venv/bin/pytest`
Expected: PASS (no import errors; smoke/speed markers stay opt-out).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(python-service): delete regex title_norm + _seed_match"
```

---

### Task 13: Regenerate the web client

**Files:**
- Generated: `web/lib/python-api/generated/**` (via `pnpm codegen`)

- [ ] **Step 1: Regenerate**

Run: `pnpm codegen`

- [ ] **Step 2: Verify TrackMeta gained the fields**

Run: `grep -n "artistKey\|titleKey" web/lib/python-api/generated/types/TrackMeta.ts`
Expected: both fields present.

- [ ] **Step 3: Commit**

```bash
git add web/lib/python-api/generated
git commit -m "chore(web): regenerate python-api client with TrackMeta keys"
```

---

### Task 14: Rewire web aggregator to canonical keys

**Files:**
- Modify: `web/lib/aggregator.ts:91-143` (delete `TITLE_STRIP_PATTERNS`, `normalizeTitle`, `normalizeArtist`; rewrite `identityKey`), `:204-220` (`diversifyArtists` uses `artistKey`)
- Test: `web/lib/aggregator.test.ts` (if present) — update identity/dedup expectations

**Interfaces:**
- Consumes: `TrackMeta.artistKey`, `TrackMeta.titleKey`.
- Produces: `identityKey(t) === \`${t.artistKey}||${t.titleKey}\``. `normalizeTitle`/`normalizeArtist` no longer exported.

- [ ] **Step 1: Delete regex normalizers + rewrite identityKey**

Remove `TITLE_STRIP_PATTERNS`, `normalizeTitle`, `normalizeArtist` (91-139). Replace `identityKey`:

```typescript
function identityKey(t: TrackMeta): string {
  return `${t.artistKey}||${t.titleKey}`;
}
```

- [ ] **Step 2: Fix `diversifyArtists` artist references**

Replace the two `normalizeArtist(t.artist)` / `normalizeArtist(pick.artist)` calls (lines ~214, 219) with `t.artistKey` / `pick.artistKey`.

- [ ] **Step 3: Build to surface other consumers**

Run: `cd web && pnpm tsc --noEmit` (or `pnpm build`)
Expected: errors only where `normalizeTitle`/`normalizeArtist` were imported elsewhere — those are handled in Tasks 15-16.

- [ ] **Step 4: Run aggregator tests + commit**

Run: `cd web && pnpm test aggregator`
Expected: PASS after updating fixtures to include `artistKey`/`titleKey`.

```bash
git add web/lib/aggregator.ts web/lib/aggregator.test.ts
git commit -m "feat(web): RRF identity + diversification on canonical keys"
```

---

### Task 15: Search cache key + version bump

**Files:**
- Modify: `web/features/search/searchCache.ts`
- Test: `web/features/search/*cache*.test.ts` if present

**Interfaces:**
- Produces: `searchCacheKey` no longer depends on `aggregator` normalizers; `SEARCH_CACHE_VERSION = "v18"`.

- [ ] **Step 1: Replace the import + key derivation**

Remove `import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";`. Bump the version and use minimal key hygiene (lowercase + trim + whitespace-collapse — infrastructure, not title cleaning):

```typescript
export const SEARCH_CACHE_VERSION = "v18";

function keyPart(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function searchCacheKey(artist: string, track: string | null): string {
  const a = keyPart(artist);
  const t = track ? keyPart(track) : "_";
  return `${SEARCH_CACHE_VERSION}:${a}|${t}`;
}
```

- [ ] **Step 2: Build + commit**

Run: `cd web && pnpm tsc --noEmit` (searchCache errors resolved)

```bash
git add web/features/search/searchCache.ts
git commit -m "feat(web): version-bump search cache; drop regex key normalization"
```

---

### Task 16: Dislike keys from canonical track keys

**Files:**
- Modify: `web/features/dislike/types.ts`
- Modify: callers of `makeDislikeKey` (find with grep)
- Test: `web/features/dislike/*.test.ts` if present

**Interfaces:**
- Produces: `makeDislikeKey(artistKey: string, titleKey: string): DislikeKey` returning `\`${artistKey}|${titleKey}\``.

- [ ] **Step 1: Rewrite `makeDislikeKey`**

```typescript
import { z } from "zod";

export const DislikeKeySchema = z.string().brand<"DislikeKey">();
export type DislikeKey = z.infer<typeof DislikeKeySchema>;

export function makeDislikeKey(artistKey: string, titleKey: string): DislikeKey {
  return DislikeKeySchema.parse(`${artistKey}|${titleKey}`);
}
```

- [ ] **Step 2: Update callers to pass the track's canonical keys**

Run: `grep -rn "makeDislikeKey(" web --include=*.ts --include=*.tsx`. For each call, pass `track.artistKey, track.titleKey` (the disliked track is a `TrackMeta`/`FusedCandidate` and now carries both). Where a caller only had raw artist/title strings, thread the canonical keys through from the track object.

- [ ] **Step 3: Build, test, commit**

Run: `cd web && pnpm tsc --noEmit && pnpm test`
Expected: PASS.

```bash
git add web/features/dislike
git commit -m "feat(web): dislike keys from canonical track keys"
```

---

### Task 17: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Confirm zero regex title cleaning remains**

Run: `grep -rn "normalizeTitle\|normalizeArtist\|strip_recording_suffixes\|clean_title\|query_match_score\|TITLE_STRIP_PATTERNS\|_SERVICE_PATTERNS" python-service/app web/lib web/features`
Expected: **no matches**.

- [ ] **Step 2: Python suite**

Run: `cd python-service && .venv/bin/pytest`
Expected: PASS.

- [ ] **Step 3: Web build + unit tests + lint**

Run: `pnpm build && cd web && pnpm test && cd .. && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke (per the project's test-before-commit rule)**

With `ANTHROPIC_API_KEY` set and dev servers up (`pnpm dev`), run one real `/similar` search for a known seed, confirm: titles are clean in the UI, results fuse across sources, no crash; then re-run the same search and confirm a cache hit (no second LLM batch in logs — `[cache] HIT source=title_norm`).

- [ ] **Step 5: Add changeset + commit**

```bash
cat > .changeset/llm-title-normalization.md <<'EOF'
---
"web": minor
"python-service": minor
---

Replace all regex title cleaning/sanitization with an LLM (Claude Haiku 4.5)
normalizer. Titles are cleaned and canonical match keys generated server-side,
cached raw->canonical. Existing dislikes reset (keys changed).
EOF
git add .changeset/llm-title-normalization.md
git commit -m "chore: changeset for LLM title normalization"
```

---

## Self-Review notes

- **Spec coverage:** display cleanup (Tasks 10, 12), matching/key generation (Tasks 3, 5, 11, 14), persistent cache (Tasks 2-3), Haiku 4.5 (Task 3), batching (Tasks 2-4, 11), fail-loud (Task 3), no dislike migration (Task 16 resets keys), config + env (Task 1), cache-version bump (Task 15), `pnpm codegen` (Task 13), seed matching across 5 adapters (Tasks 6-10), zero-regex verification (Tasks 12, 17).
- **Type consistency:** `CanonicalTitle` (artist/title/artist_key/title_key/artist_entities) defined in Task 3 and consumed unchanged in Tasks 4, 11; `MATCH_*` constants defined in Task 4 and used in Tasks 9-10; `TrackMeta.artistKey/titleKey` defined in Task 5, generated in Task 13, consumed in Tasks 14-16.
- **Open implementation note for the executor:** the exact within-source dedup site in `similar.py` (Task 11 Step 3) and the ytm_playlist resolver shape (Task 12 Step 1) must be located by grep at execution time; both have a single call site today.
