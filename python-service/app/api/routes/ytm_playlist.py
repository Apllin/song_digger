from difflib import SequenceMatcher

from fastapi import APIRouter, HTTPException
from ytmusicapi import YTMusic

from app.adapters._seed_match import _title_signature

router = APIRouter(prefix="/ytm")


# ── Title-match helpers ──────────────────────────────────────────────────────
# Three tiers ordered cheapest-first: signature equality → either-side
# substring → token-level fuzzy. The fuzzy tier exists to tolerate YTM upload
# typos like "Bjarki - Teach Me Frisbe [PX099]" matching our Discogs-clean
# "Teach Me Frisbee" — without that tier the strict substring check fails and
# the user gets "No playback available" even though the YTM result is right
# there in the top hit.
#
# The fuzzy tier is intentionally narrow:
#   - Operates token-by-token so extra YTM-side junk (catalog tags, edition
#     markers) doesn't drag the score down.
#   - Skipped entirely when our title signature is < 8 chars — short titles
#     ("Up", "Cobra") can't safely tolerate single-character edits without
#     opening the door to false matches.
#   - Per-token typo tolerance only kicks in when both tokens are >= 4 chars,
#     length difference <= 2, and SequenceMatcher.ratio() >= 0.85.
#
# This stays local to /ytm/search-exact (the embed-resolver path). The
# adapter seed-match validators in `_seed_match.py` are deliberately
# untouched: a wrong seed there corrupts every recommendation downstream,
# whereas the worst case here is one wrong inline-playback resolution that
# the user can dismiss.
#
# Deliberately NOT done: an artist-only video fallback (i.e. searching just
# the artist name when both filters above miss). It would catch cases like
# "Estella Boersma - Harmonizer" → "Estella Boersma - Harmonize [PX099]"
# (same per-token fuzzy logic, just a wider candidate pool), but the broader
# pool plus the same fuzzy criterion was judged too risky for false positives
# — the project would rather show "No playback available" than play the wrong
# track. If reconsidered, gate it behind explicit user opt-in or per-tier
# logging so the false-positive rate is observable before broadening.


def _token_close(a: str, b: str) -> bool:
    """Two tokens close enough to plausibly be the same word with a typo.

    Both tokens must be >= 4 chars: typo-tolerance on shorter tokens has
    too much false-positive risk (e.g. "love" vs "live" would pass).
    """
    if len(a) < 4 or len(b) < 4:
        return False
    if abs(len(a) - len(b)) > 2:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.85


def _title_close(our: str, ytm: str) -> bool:
    """True if YTM's title is a confident match for our title."""
    qt = _title_signature(our)
    ct = _title_signature(ytm)
    if not qt or not ct:
        return False
    if qt == ct:
        return True
    if qt in ct or ct in qt:
        return True
    if len(qt) < 8:
        return False
    our_tokens = qt.split()
    ytm_tokens = set(ct.split())
    return all(
        ot in ytm_tokens or any(_token_close(ot, yt) for yt in ytm_tokens)
        for ot in our_tokens
    )


@router.get("/search-exact")
async def search_exact(title: str, artist: str) -> dict:
    """
    Exact track lookup: search YTM for 'artist - title', pick the best matching
    result by comparing normalised artist+title strings.
    Returns { embedUrl, coverUrl } or { embedUrl: null }.
    """
    import asyncio

    _ytm_client = YTMusic()

    def _search_sync() -> dict | None:
        query = f"{artist} - {title}"
        artist_words = [w for w in artist.lower().split() if len(w) > 2]

        def _make_result(r: dict) -> dict:
            vid = r.get("videoId")
            thumbnails = r.get("thumbnails") or []
            cover = thumbnails[-1].get("url") if thumbnails else None
            return {
                "embedUrl": f"https://www.youtube.com/embed/{vid}?autoplay=1&origin=http://localhost:3000",
                "sourceUrl": f"https://music.youtube.com/watch?v={vid}",
                "coverUrl": cover,
            }

        # 1. Official songs: match on title + artist metadata field
        songs = _ytm_client.search(query, filter="songs", limit=10)
        for r in songs:
            r_title = r.get("title") or ""
            r_artists = " ".join(
                a.get("name", "") for a in (r.get("artists") or [])
            ).lower()
            if _title_close(title, r_title) and any(w in r_artists for w in artist_words):
                if r.get("videoId"):
                    return _make_result(r)

        # 2. User-uploaded videos: artists field contains the uploader channel,
        #    not the performer. Check both title and track name against the video
        #    title (user uploads typically follow "Artist - Title" format).
        videos = _ytm_client.search(query, filter="videos", limit=20)
        for r in videos:
            r_title = r.get("title") or ""
            r_title_lower = r_title.lower()
            # Both the track title and at least one artist word must appear in
            # the video title so we don't match unrelated uploads.
            if _title_close(title, r_title) and any(w in r_title_lower for w in artist_words):
                if r.get("videoId"):
                    return _make_result(r)

        return None

    try:
        result = await asyncio.to_thread(_search_sync)
        if result:
            return result
        return {"embedUrl": None, "coverUrl": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
