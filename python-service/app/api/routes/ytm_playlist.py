from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ytmusicapi import YTMusic
import os

router = APIRouter(prefix="/ytm")

OAUTH_FILE = os.path.join(os.path.dirname(__file__), "../../../../oauth.json")
PLAYLIST_ID_FILE = os.path.join(os.path.dirname(__file__), "../../../../playlist_id.txt")

PLAYLIST_NAME = "Song Digger Likes"


def _get_ytm_auth() -> YTMusic:
    if not os.path.exists(OAUTH_FILE):
        raise HTTPException(
            status_code=503,
            detail="YTM OAuth not configured. Run: ytmusicapi oauth --file oauth.json in python-service/",
        )
    return YTMusic(OAUTH_FILE)


def _get_or_create_playlist(ytm: YTMusic) -> str:
    # Cache playlist ID locally
    if os.path.exists(PLAYLIST_ID_FILE):
        pid = open(PLAYLIST_ID_FILE).read().strip()
        if pid:
            return pid

    # Create new playlist
    result = ytm.create_playlist(
        PLAYLIST_NAME,
        "Tracks saved from Song Digger",
        privacy_status="PRIVATE",
    )
    pid = result if isinstance(result, str) else result.get("playlistId", "")
    if pid:
        with open(PLAYLIST_ID_FILE, "w") as f:
            f.write(pid)
    return pid


@router.get("/search-exact")
async def search_exact(title: str, artist: str) -> dict:
    """
    Exact track lookup: search YTM for 'artist - title', pick the best matching
    result by comparing normalised artist+title strings.
    Returns { embedUrl, coverUrl } or { embedUrl: null }.
    """
    import asyncio
    from ytmusicapi import YTMusic

    _ytm_client = YTMusic()

    def _search_sync() -> dict | None:
        query = f"{artist} - {title}"
        title_lower = title.lower()
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
            r_title = (r.get("title") or "").lower()
            r_artists = " ".join(
                a.get("name", "") for a in (r.get("artists") or [])
            ).lower()
            if title_lower in r_title and any(w in r_artists for w in artist_words):
                if r.get("videoId"):
                    return _make_result(r)

        # 2. User-uploaded videos: artists field contains the uploader channel,
        #    not the performer. Check both title and track name against the video
        #    title (user uploads typically follow "Artist - Title" format).
        videos = _ytm_client.search(query, filter="videos", limit=20)
        for r in videos:
            r_title = (r.get("title") or "").lower()
            # Both the track title and at least one artist word must appear in
            # the video title so we don't match unrelated uploads.
            if title_lower in r_title and any(w in r_title for w in artist_words):
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


class AddToPlaylistRequest(BaseModel):
    video_id: str  # YouTube videoId


@router.post("/add-to-playlist")
async def add_to_playlist(req: AddToPlaylistRequest) -> dict:
    try:
        ytm = _get_ytm_auth()
        playlist_id = _get_or_create_playlist(ytm)
        ytm.add_playlist_items(playlist_id, [req.video_id])
        return {"ok": True, "playlistId": playlist_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/playlist-status")
async def playlist_status() -> dict:
    """Check if OAuth is configured."""
    configured = os.path.exists(OAUTH_FILE)
    playlist_id = None
    if os.path.exists(PLAYLIST_ID_FILE):
        playlist_id = open(PLAYLIST_ID_FILE).read().strip() or None
    return {"configured": configured, "playlistId": playlist_id}
