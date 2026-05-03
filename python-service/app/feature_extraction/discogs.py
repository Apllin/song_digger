"""
Discogs-augmented features (Stage C2).

Pure compute given pre-resolved input — caching and the Discogs API live in
app.core.db and app.adapters.discogs respectively. The background fill route
(app.api.routes.discogs_features) glues the three together. Splitting the
pure logic out keeps it trivially testable and matches the layering already
in feature_extraction/cheap.py for C1.

ADR-0013 covers the architectural rationale (background fill, two cache
tables, lazy TTL).
"""
from __future__ import annotations

import unicodedata
from typing import Optional


def normalize_artist(artist: str) -> str:
    """
    Normalize an artist name for cache keys and set membership.

    Mirrors web/lib/aggregator.ts:normalizeArtist — NFKD-decompose so accented
    forms split into base letters + combining marks, drop the marks, lowercase,
    drop non-alphanumerics. "Óscar Mulero" and "Oscar Mulero" both collapse to
    "oscarmulero" so the same cache row resolves regardless of which
    upstream source supplied the spelling.
    """
    decomposed = unicodedata.normalize("NFKD", artist)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return "".join(ch for ch in stripped.lower() if ch.isalnum())


def year_proximity(
    seed_year: Optional[int], cand_year: Optional[int]
) -> Optional[float]:
    """
    Bounded [0, 1] year-distance signal.

      same year     → 1.0
      1 year apart  → 0.5
      2 years       → 0.333…
      ...

    Returns None when either year is unknown. Stage D treats None and 0
    differently — None is "no data", which is a different signal from "many
    years apart, almost zero".
    """
    if seed_year is None or cand_year is None:
        return None
    return 1.0 / (abs(seed_year - cand_year) + 1)


def artist_corelease(
    seed_collaborators: Optional[set[str]],
    cand_artist_normalized: str,
) -> Optional[int]:
    """
    1 if `cand_artist_normalized` appears in the seed artist's collaborator
    set, else 0. None if the seed has no cached collaborator data yet
    (Discogs hasn't returned, or the seed artist isn't in Discogs at all).

    The candidate name must already be normalized via `normalize_artist` —
    callers normalize once at the top of the fill loop rather than per-check.
    """
    if seed_collaborators is None:
        return None
    return 1 if cand_artist_normalized in seed_collaborators else 0


def derive_collaborators(
    artist_name: str,
    discography: list[dict],
    release_credits_lookup: dict[str, list[str]],
) -> set[str]:
    """
    Walk the artist's discography; for each release look up its full credit
    list and add every other credited artist as a collaborator.

    `discography` is the list returned by `DiscogsAdapter.fetch_artist_discography`
    (each entry has at least `releaseId`).
    `release_credits_lookup` maps releaseId → list of raw credit names.

    The artist themselves is filtered out (releases credit the main artist
    too, and we don't want everyone to be their own collaborator). Empty
    strings and credits that normalize away to nothing are also dropped.
    """
    artist_n = normalize_artist(artist_name)
    collaborators: set[str] = set()
    for release in discography:
        release_id = release.get("releaseId")
        if release_id is None:
            continue
        for credit in release_credits_lookup.get(release_id, []):
            credit_n = normalize_artist(credit)
            if credit_n and credit_n != artist_n:
                collaborators.add(credit_n)
    return collaborators
