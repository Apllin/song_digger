from difflib import SequenceMatcher

from fastapi import APIRouter, HTTPException
from ytmusicapi import YTMusic

from app.core.title_llm import normalize as normalize_titles

router = APIRouter(prefix="/ytm")


# ── Title-match helpers ──────────────────────────────────────────────────────
# Three tiers: canonical key equality → substring → token-level fuzzy typo.


def _token_close(a: str, b: str) -> bool:
    """True if two >= 4-char tokens are plausibly the same word with a typo."""
    if len(a) < 4 or len(b) < 4:
        return False
    if abs(len(a) - len(b)) > 2:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.85


def _title_close(our: str, ytm: str, our_key: str = "", ytm_key: str = "") -> bool:
    """True if YTM's title matches ours; canonical keys used when provided."""
    qt = our_key or our.lower().strip()
    ct = ytm_key or ytm.lower().strip()
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
    result by comparing canonical title keys.
    Returns { embedUrl, coverUrl } or { embedUrl: null }.
    """
    import asyncio

    _ytm_client = YTMusic()

    def _collect_candidates() -> tuple[list[dict], list[dict]]:
        query = f"{artist} - {title}"
        songs = _ytm_client.search(query, filter="songs", limit=10)
        videos = _ytm_client.search(query, filter="videos", limit=20)
        return songs, videos

    def _make_result(r: dict) -> dict:
        vid = r.get("videoId")
        thumbnails = r.get("thumbnails") or []
        cover = thumbnails[-1].get("url") if thumbnails else None
        return {
            "embedUrl": f"https://www.youtube.com/embed/{vid}?autoplay=1&origin=http://localhost:3000",
            "sourceUrl": f"https://music.youtube.com/watch?v={vid}",
            "coverUrl": cover,
        }

    try:
        songs, videos = await asyncio.to_thread(_collect_candidates)

        # Normalize seed + all candidate titles in one LLM batch.
        all_titles = [(artist, title)] + [
            ("", r.get("title") or "") for r in songs + videos
        ]
        canon = await normalize_titles(all_titles)
        seed_key = canon[0].title_key
        keys = [c.title_key for c in canon[1:]]
        ns = len(songs)

        artist_words = [w for w in artist.lower().split() if len(w) > 2]

        # 1. Official songs: match on title + artist metadata field.
        for i, r in enumerate(songs):
            r_title = r.get("title") or ""
            r_artists = " ".join(
                a.get("name", "") for a in (r.get("artists") or [])
            ).lower()
            if _title_close(title, r_title, seed_key, keys[i]) and any(w in r_artists for w in artist_words):
                if r.get("videoId"):
                    return _make_result(r)

        # 2. User-uploaded videos: check title string since artists = uploader channel.
        for i, r in enumerate(videos):
            r_title = r.get("title") or ""
            r_title_lower = r_title.lower()
            if _title_close(title, r_title, seed_key, keys[ns + i]) and any(w in r_title_lower for w in artist_words):
                if r.get("videoId"):
                    return _make_result(r)

        return {"embedUrl": None, "coverUrl": None}
    except Exception as e:
        print(f"[ytm.search_exact] error: {e}")
        raise HTTPException(status_code=500, detail="YouTube Music search failed")
