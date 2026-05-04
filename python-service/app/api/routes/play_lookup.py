"""On-demand YTM lookup for sources that don't carry their own playable
embed (today: trackid.net). Called from the web TrackCard when the user
clicks play on a track that has no embedUrl. Soft-degrades on any error.
"""
from fastapi import APIRouter
from app.adapters.youtube_music import YouTubeMusicAdapter, _yt_embed_url

router = APIRouter()
_ytm = YouTubeMusicAdapter()


@router.get("/play-lookup")
async def play_lookup(artist: str, title: str) -> dict:
    q = f"{artist} - {title}".strip(" -")
    if not q:
        return {"found": False}

    try:
        results = await _ytm.search_songs(q, limit=1)
    except Exception as e:
        print(f"[PlayLookup] YTM search failed for {q!r}: {e}")
        return {"found": False}

    if not results:
        return {"found": False}

    top = results[0]
    video_id = top.get("videoId")
    if not video_id:
        return {"found": False}

    thumbnails = top.get("thumbnails") or []
    cover_url = thumbnails[-1].get("url") if thumbnails else None

    return {
        "found": True,
        "embedUrl": _yt_embed_url(video_id),
        "sourceUrl": f"https://music.youtube.com/watch?v={video_id}",
        "coverUrl": cover_url,
    }
