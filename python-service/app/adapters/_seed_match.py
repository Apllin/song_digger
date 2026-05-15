"""Shared seed-match validation for adapters whose upstream search is fuzzy.

Several adapters (Cosine.club, Yandex.Music, YouTube Music) resolve a free-form
query like "Ignez - Aventurine" to a track id and then ask the upstream for
"similar tracks". When the upstream's catalog has no exact match, its fuzzy
search still returns *something* — often an unrelated record — and the
similarity recommendations are then wildly off-genre.

`query_match_score()` enforces two regimes:

- "Artist - Title" queries require an **exact** title-signature match against
  a candidate whose artist tokens overlap with the query's artist. Anything
  short of an exact title match is rejected, and the caller falls back to
  dropping the source's contribution entirely.

- Bare-artist queries (no ` - ` separator) accept any candidate whose artist
  tokens overlap with the query — the intent is "pick the first track by this
  artist as a seed". Candidates whose artist doesn't match are rejected.

`query_matches()` is the boolean wrapper kept for callers that only need a
yes/no answer.
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
MATCH_ARTIST = 1  # bare-artist query: artist tokens overlap with the candidate
MATCH_EXACT = 3   # "Artist - Title" query: title signatures equal after normalisation


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
    """Score a candidate against the query.

    Returns:
        MATCH_EXACT  — "Artist - Title" query: artist tokens overlap *and* title
                       signatures are equal after normalisation. The only score
                       that makes an "Artist - Title" query accept a candidate.
        MATCH_ARTIST — bare-artist query (no ' - '): artist tokens overlap with
                       the candidate. Caller uses the first such candidate as
                       the seed track for that artist.
        MATCH_NONE   — neither rule matched. Caller should reject this
                       candidate and, if no candidate scores higher than
                       MATCH_NONE, drop the source from the response entirely.
    """
    if " - " not in query:
        return MATCH_ARTIST if _artists_match(query, cand_artist) else MATCH_NONE
    q_artist, q_title = (p.strip() for p in query.split(" - ", 1))
    if not _artists_match(q_artist, cand_artist):
        return MATCH_NONE
    qt, ct = _title_signature(q_title), _title_signature(cand_title)
    if not qt or not ct:
        return MATCH_NONE
    return MATCH_EXACT if qt == ct else MATCH_NONE


def query_matches(query: str, cand_artist: str, cand_title: str) -> bool:
    """Backwards-compatible boolean wrapper around `query_match_score`."""
    return query_match_score(query, cand_artist, cand_title) > MATCH_NONE
