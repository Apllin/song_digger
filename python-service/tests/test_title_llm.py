import json
import pytest

from app.core import title_llm
from app.core.title_llm import CanonicalTitle, TitleNormError


def _canon(artist, title, ak, tk, ents):
    return {"artist": artist, "title": title, "artist_key": ak,
            "title_key": tk, "artist_entities": ents}


class _ToolBlock:
    type = "tool_use"
    def __init__(self, payload): self.input = payload


class _FakeMessages:
    def __init__(self, payload, raise_exc=None):
        self._payload = payload
        self._raise = raise_exc
    async def create(self, **kwargs):
        if self._raise:
            raise self._raise
        class _Resp: content = [_ToolBlock(self._payload)]
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
    payload = {"results": [{"index": 0, **_canon("Foo", "Bar", "foo", "bar", ["foo"])}]}
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


async def test_reordered_results_map_by_index(monkeypatch):
    async def _fetch(**k): return {}
    async def _upsert(**k): pass
    # LLM returns the two items in REVERSE order — index must drive mapping.
    payload = {"results": [
        {"index": 1, **_canon("B", "B", "b", "btitle", ["b"])},
        {"index": 0, **_canon("A", "A", "a", "atitle", ["a"])},
    ]}
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", lambda: _FakeClient(payload))
    out = await title_llm.normalize([("A", "A"), ("B", "B")])
    assert out[0].title_key == "atitle" and out[1].title_key == "btitle"


async def test_duplicate_titles_persist_once(monkeypatch):
    # Same raw (artist, title) twice in one batch must normalize + persist once,
    # and the upsert must receive de-duplicated keys (no ON CONFLICT double-update).
    async def _fetch(**k): return {}
    persisted = {}
    calls = {"n": 0}
    async def _upsert(*, source, items):
        keys = [k for k, _ in items]
        assert len(keys) == len(set(keys)), f"duplicate keys in upsert: {keys}"
        persisted.update(dict(items))
    def _client():
        calls["n"] += 1
        return _FakeClient({"results": [{"index": 0, **_canon("A", "X", "a", "x", ["a"])}]})
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", _client)
    out = await title_llm.normalize([("A", "X"), ("A", "X")])
    assert len(out) == 2 and out[0].title_key == "x" and out[1].title_key == "x"
    assert len(persisted) == 1  # one row, not two


async def test_missing_index_raises(monkeypatch):
    async def _fetch(**k): return {}
    async def _upsert(**k): raise AssertionError("must not persist on bad output")
    payload = {"results": [{"index": 5, **_canon("A", "A", "a", "atitle", ["a"])}]}
    monkeypatch.setattr(title_llm, "fetch_external_cache_many", _fetch)
    monkeypatch.setattr(title_llm, "upsert_external_cache_many", _upsert)
    monkeypatch.setattr(title_llm, "_get_client", lambda: _FakeClient(payload))
    with pytest.raises(TitleNormError):
        await title_llm.normalize([("A", "A")])
