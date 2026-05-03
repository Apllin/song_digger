"""
Stage C2 — eventually-consistent fill of Discogs-derived CandidateFeatures
columns (yearProximity, artistCorelease).

Called fire-and-forget from web's `runSearch` after `saveTracks` completes
(in parallel to the existing /features/extract call). The handler:

  1. Resolves the seed artist's discography + collaborator set, going through
     the ArtistDiscography / ArtistCollaborations caches first and falling
     back to the Discogs API on miss.
  2. For each candidate, resolves the candidate artist's discography (cache
     then API), picks a "candidate year" via the same heuristic used for the
     seed, and computes the two features.
  3. Batch-updates the matching CandidateFeatures rows; rows that don't yet
     exist (race with /features/extract) are silently skipped — the next
     search re-fires.

Latency: 1–10 s for cache-cold artist sets, sub-second when warm. Always
slower than the search itself; the user has long since received their
response by the time this lands.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.adapters.discogs import DiscogsAdapter
from app.core.db import (
    fetch_artist_collaborations_cache,
    fetch_artist_discography_cache,
    update_candidate_features_discogs_batch,
    upsert_artist_collaborations,
    upsert_artist_discography,
)
from app.feature_extraction.discogs import (
    artist_corelease,
    derive_collaborators,
    normalize_artist,
    year_proximity,
)

router = APIRouter()
_discogs = DiscogsAdapter()

# Cache TTL — see ADR-0013. Discogs data is slow-moving so 90 days is well
# inside the safe range; lazy eviction at read time so no scheduler.
_CACHE_TTL_DAYS = 90

# Hard cap on per-artist credit fetches when deriving collaborators. The
# discography may have up to ~100 entries (see MAX_DISCOGRAPHY_RELEASES);
# fetching credits for each blows the rate limit. Top-N by year already
# captures the dominant collaboration partners for typical techno catalogs.
_TOP_RELEASES_FOR_CREDITS = 10


class CandidateInput(BaseModel):
    trackId: str
    artist: str
    title: str | None = None


class DiscogsFillRequest(BaseModel):
    search_query_id: str
    seed_artist: str
    candidates: list[CandidateInput]


@router.post("/features/discogs-fill")
async def discogs_fill(req: DiscogsFillRequest) -> dict:
    """Fire-and-forget background fill — see module docstring."""
    seed_artist_n = normalize_artist(req.seed_artist) if req.seed_artist else ""
    if not seed_artist_n or not req.candidates:
        return {"updated": 0, "skipped": "no seed or no candidates"}

    seed_disc = await _resolve_discography(seed_artist_n)
    seed_collabs = await _resolve_collaborators(seed_artist_n, seed_disc)
    seed_year = _pick_seed_year(seed_disc)

    updates: list[dict] = []
    # Many candidates share an artist; cache resolved-per-artist values
    # within this request so we don't re-query Postgres or Discogs for the
    # same name twice in one fill.
    per_artist_year: dict[str, int | None] = {}

    for cand in req.candidates:
        cand_artist_n = normalize_artist(cand.artist) if cand.artist else ""
        if not cand_artist_n:
            updates.append({
                "trackId": cand.trackId,
                "yearProximity": None,
                "artistCorelease": None,
            })
            continue

        if cand_artist_n in per_artist_year:
            cand_year = per_artist_year[cand_artist_n]
        else:
            cand_disc = await _resolve_discography(cand_artist_n)
            cand_year = _pick_artist_year(cand_disc)
            per_artist_year[cand_artist_n] = cand_year

        updates.append({
            "trackId": cand.trackId,
            "yearProximity": year_proximity(seed_year, cand_year),
            "artistCorelease": artist_corelease(seed_collabs, cand_artist_n),
        })

    matched = await update_candidate_features_discogs_batch(
        search_query_id=req.search_query_id,
        updates=updates,
    )
    if matched == 0 and updates:
        # CandidateFeatures rows may not yet exist due to a race with the C1
        # /features/extract call. Log so we can spot it but don't error —
        # next search will retry with the same data.
        print(
            f"[Discogs] discogs-fill matched 0 rows for "
            f"search_query_id={req.search_query_id} "
            f"(C1 features likely not yet persisted)"
        )

    return {"updated": matched, "candidates": len(updates)}


async def _resolve_discography(artist_normalized: str) -> list[dict] | None:
    """
    Cache-aside read for ArtistDiscography. None means "no data on this artist
    (yet)", `[]` means "Discogs has nothing on this artist". Distinct cases
    so that None propagates as a None feature value rather than 0.
    """
    cached = await fetch_artist_discography_cache(
        artist=artist_normalized, ttl_days=_CACHE_TTL_DAYS
    )
    if cached is not None:
        return cached

    fetched = await _discogs.fetch_artist_discography(artist_normalized)
    if fetched is None:
        # Don't cache — leaves the next search free to retry the API.
        return None

    await upsert_artist_discography(
        artist=artist_normalized,
        releases=fetched,
    )
    return fetched


async def _resolve_collaborators(
    artist_normalized: str,
    discography: list[dict] | None,
) -> set[str] | None:
    """
    Cache-aside read for ArtistCollaborations. Derives from the discography
    on miss (top-N releases only — see _TOP_RELEASES_FOR_CREDITS). Returns
    None when discography is None, an empty set when no collaborators were
    found.
    """
    if discography is None:
        return None

    cached = await fetch_artist_collaborations_cache(
        artist=artist_normalized, ttl_days=_CACHE_TTL_DAYS
    )
    if cached is not None:
        return cached

    top = discography[:_TOP_RELEASES_FOR_CREDITS]
    credits_lookup: dict[str, list[str]] = {}
    for release in top:
        rid = release.get("releaseId")
        if rid is None:
            continue
        credits = await _discogs.fetch_release_credits(rid)
        if credits is not None:
            credits_lookup[rid] = credits

    collabs = derive_collaborators(artist_normalized, top, credits_lookup)
    await upsert_artist_collaborations(
        artist=artist_normalized,
        collaborators=sorted(collabs),
    )
    return collabs


def _pick_seed_year(discography: list[dict] | None) -> int | None:
    """
    Heuristic: the artist's most recent release year, as a proxy for "current
    era" of the seed. Exact-track lookup would be better but Discogs catalog
    titles often don't match upstream titles cleanly enough for that to be
    reliable, and the C2 feature is already a coarse signal.
    """
    if not discography:
        return None
    years = [r["year"] for r in discography if isinstance(r.get("year"), int)]
    return max(years) if years else None


def _pick_artist_year(discography: list[dict] | None) -> int | None:
    """Same heuristic as the seed; revisit if Stage D shows the proxy is
    too lossy (e.g. always-recent year flattens older catalog overlap)."""
    return _pick_seed_year(discography)
