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
