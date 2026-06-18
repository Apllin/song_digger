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
