"""Shared seed-match validation for adapters whose upstream search is fuzzy.

Several adapters (Cosine.club, Yandex.Music, YouTube Music) resolve a free-form
query like "Ignez - Aventurine" to a track id and then ask the upstream for
"similar tracks". When the upstream's catalog has no exact match, its fuzzy
search still returns *something* — often an unrelated record — and the
similarity recommendations are then wildly off-genre.

`query_matches()` validates a candidate against the query's "Artist - Title"
form so callers can scan the top N hits and reject phantom seeds.

`query_match_score()` returns a 0/1/3 score so callers can prefer the *most
specific* match among accepted candidates — without it, "Bailando (NK & David
Löhlein Version)" and "Bailando" both validate against the long query (one by
exact match, one by substring) and the upstream's own ranking decides which
seed wins, so alternate versions silently collapse onto the original.
"""

import re
import unicodedata

from app.core.title_norm import strip_recording_suffixes


# Number of search hits to scan when resolving the seed. Same default across
# adapters so behaviour is uniform.
SEED_CANDIDATES = 5


# Match scores returned by query_match_score(). Callers pick the candidate
# with the highest score among the top SEED_CANDIDATES hits.
MATCH_NONE = 0
MATCH_LOOSE = 1   # one title signature is a substring of the other
MATCH_EXACT = 3   # title signatures equal after normalisation


def _normalize(s: str) -> str:
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return stripped.lower().strip()


_COLLAB_SPLIT = re.compile(
    r"[,&]|\s+(?:vs\.?|x|feat\.?|ft\.?|featuring|with)\s+", re.IGNORECASE
)


def _artist_tokens(s: str) -> set[str]:
    s = _COLLAB_SPLIT.sub(" ", _normalize(s))
    return set(s.split())


def _title_signature(s: str) -> str:
    """Lower-cased title with same-recording suffixes (Original Mix, feat.,
    Remaster, …) stripped. Version markers like (Remix), (Dub), (Live), (VIP),
    (... Version) survive — they identify a distinct recording."""
    s = strip_recording_suffixes(_normalize(s))
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def _artists_match(query_artist: str, cand_artist: str) -> bool:
    qa, ca = _artist_tokens(query_artist), _artist_tokens(cand_artist)
    if not qa or not ca:
        return False
    shorter, longer = (qa, ca) if len(qa) <= len(ca) else (ca, qa)
    return shorter.issubset(longer)


def query_match_score(query: str, cand_artist: str, cand_title: str) -> int:
    """Score a candidate against an "Artist - Title" query.

    Returns:
        MATCH_EXACT — title signatures equal (best).
        MATCH_LOOSE — one title signature is a substring of the other
                      (tolerates extra unstripped parens like "[Vinyl Edit]").
        MATCH_NONE  — artist mismatch or unrelated title.

    Free-form queries (no ' - ' separator) get MATCH_LOOSE for any candidate —
    we have no way to validate them and the typeahead-driven UI almost always
    sends the canonical form anyway.
    """
    if " - " not in query:
        return MATCH_LOOSE
    q_artist, q_title = (p.strip() for p in query.split(" - ", 1))
    if not _artists_match(q_artist, cand_artist):
        return MATCH_NONE
    qt, ct = _title_signature(q_title), _title_signature(cand_title)
    if not qt or not ct:
        return MATCH_NONE
    if qt == ct:
        return MATCH_EXACT
    if qt in ct or ct in qt:
        return MATCH_LOOSE
    return MATCH_NONE


def query_matches(query: str, cand_artist: str, cand_title: str) -> bool:
    """Backwards-compatible boolean wrapper around `query_match_score`."""
    return query_match_score(query, cand_artist, cand_title) > MATCH_NONE
