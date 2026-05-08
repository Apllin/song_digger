import asyncio
from ytmusicapi import YTMusic
from app.adapters.base import AbstractAdapter
from app.adapters._seed_match import SEED_CANDIDATES, query_match_score
from app.core.models import TrackMeta
from app.config import settings

# ytmusicapi is synchronous — we run it in a thread pool
_ytm = YTMusic()


def _yt_embed_url(video_id: str) -> str:
    return f"https://www.youtube.com/embed/{video_id}?autoplay=1&origin={settings.frontend_origin}"


def _pick_seed_video_id(query: str, results: list[dict]) -> str | None:
    """Return the videoId of the best-scoring search hit for `query`.

    YTM search is fuzzy: a query with no exact match still returns the closest
    text-similar song, and `get_watch_playlist()` on that mismatched seed
    yields a radio of the wrong genre. Picking the highest-scoring candidate
    (exact signature > substring) lets a version-specific query prefer the
    version-specific catalog entry over the bare title.
    """
    best_vid: str | None = None
    best_score = 0
    for cand in results:
        vid = cand.get("videoId")
        if not vid:
            continue
        cand_artist = ", ".join(
            a.get("name", "") for a in (cand.get("artists") or []) if a.get("name")
        )
        cand_title = cand.get("title") or ""
        score = query_match_score(query, cand_artist, cand_title)
        if score > best_score:
            best_score = score
            best_vid = vid
    if best_vid is not None:
        return best_vid
    rejected = ", ".join(
        f"{', '.join(a.get('name', '') for a in (c.get('artists') or []) if a.get('name'))!r}"
        f" - {c.get('title', '')!r}"
        for c in results
    )
    print(f"[YouTubeMusic] no seed matched query {query!r}; rejected: {rejected}")
    return None


def _parse_ytm_track(t: dict) -> TrackMeta | None:
    """Parse a track from get_watch_playlist results (uses singular `thumbnail`).

    Not for `search()` results — those have a different shape (`thumbnails` plural).
    """
    vid = t.get("videoId")
    if not vid:
        return None
    artists = t.get("artists") or []
    artist = ", ".join(a.get("name", "") for a in artists) or "Unknown"
    thumbnails = t.get("thumbnail") or []
    cover_url = thumbnails[-1].get("url") if thumbnails else None
    return TrackMeta(
        title=t.get("title", "Unknown"),
        artist=artist,
        source="youtube_music",
        sourceUrl=f"https://music.youtube.com/watch?v={vid}",
        embedUrl=_yt_embed_url(vid),
        coverUrl=cover_url,
    )


class YouTubeMusicAdapter(AbstractAdapter):
    """
    Uses unofficial ytmusicapi to find related tracks via get_watch_playlist.
    Does NOT return BPM/key.

    Docs: https://ytmusicapi.readthedocs.io/en/stable/
    """

    async def find_similar(self, query: str, limit: int = 10) -> list[TrackMeta]:
        try:
            tracks = await asyncio.to_thread(self._find_similar_sync, query, limit)
            return tracks
        except Exception as e:
            print(f"[YouTubeMusic] find_similar error: {e}")
            return []

    def _find_similar_sync(self, query: str, limit: int) -> list[TrackMeta]:
        # Step 1: search for the track and validate the seed.
        # YTM search is fuzzy and will return *something* for almost any input.
        # Without validation a query like "Ignez - Aventurine" can resolve to
        # an unrelated record and the radio playlist will be off-genre.
        results = _ytm.search(query, filter="songs", limit=SEED_CANDIDATES)
        if not results:
            return []

        video_id = _pick_seed_video_id(query, results)
        if not video_id:
            return []

        # Step 2: get YTM Radio for this track.
        # playlistId="RDAMVM{videoId}" triggers the full radio station algorithm
        # (audio-similarity based), not just the short "Up Next" queue.
        radio_playlist_id = f"RDAMVM{video_id}"
        watch = _ytm.get_watch_playlist(videoId=video_id, playlistId=radio_playlist_id, limit=limit + 1)
        tracks_raw = watch.get("tracks", [])

        # Skip the first — it's the source track itself
        parsed = [m for t in tracks_raw[1:limit + 1] if (m := _parse_ytm_track(t))]
        return parsed

    async def find_similar_by_video_id(self, video_id: str, limit: int = 50) -> list[TrackMeta]:
        """Start YTM Radio from a known videoId — no search step needed."""
        try:
            return await asyncio.to_thread(self._radio_from_video_id_sync, video_id, limit)
        except Exception as e:
            print(f"[YouTubeMusic] find_similar_by_video_id error: {e}")
            return []

    def _radio_from_video_id_sync(self, video_id: str, limit: int) -> list[TrackMeta]:
        radio_playlist_id = f"RDAMVM{video_id}"
        watch = _ytm.get_watch_playlist(videoId=video_id, playlistId=radio_playlist_id, limit=limit + 1)
        tracks_raw = watch.get("tracks", [])
        return [m for t in tracks_raw[1:limit + 1] if (m := _parse_ytm_track(t))]

    async def find_similar_by_artist(self, artist: str, limit: int = 20) -> list[TrackMeta]:
        """
        Artist-only mode: search for the artist, get their channel,
        then return tracks from related/similar artists via watch playlist.
        """
        try:
            return await asyncio.to_thread(self._find_by_artist_sync, artist, limit)
        except Exception as e:
            print(f"[YouTubeMusic] find_similar_by_artist error: {e}")
            return []

    def _find_by_artist_sync(self, artist: str, limit: int) -> list[TrackMeta]:
        # Search for the artist
        results = _ytm.search(artist, filter="artists", limit=1)
        if not results:
            # Fallback: search as song query
            return self._find_similar_sync(artist, limit)

        artist_id = results[0].get("browseId")
        if not artist_id:
            return self._find_similar_sync(artist, limit)

        # Get artist page → pick a popular track → get watch playlist
        artist_data = _ytm.get_artist(artist_id)
        songs = artist_data.get("songs", {}).get("results", [])
        if not songs:
            return self._find_similar_sync(artist, limit)

        # Use first popular track as seed
        seed_vid = songs[0].get("videoId")
        if not seed_vid:
            return self._find_similar_sync(artist, limit)

        watch = _ytm.get_watch_playlist(videoId=seed_vid, limit=limit + 5)
        tracks_raw = watch.get("tracks", [])

        parsed = [m for t in tracks_raw if (m := _parse_ytm_track(t))]
        return parsed[:limit]

    async def search_songs(self, query: str, limit: int = 3) -> list[dict]:
        """Return raw YTM song search results (for seeding Cosine.club)."""
        try:
            return await asyncio.to_thread(
                lambda: _ytm.search(query, filter="songs", limit=limit)
            )
        except Exception as e:
            print(f"[YouTubeMusic] search_songs error: {e}")
            return []

    async def get_suggestions(self, query: str) -> list[str]:
        """Return YTM search suggestions for autocomplete."""
        try:
            return await asyncio.to_thread(
                lambda: _ytm.get_search_suggestions(query)
            )
        except Exception as e:
            print(f"[YouTubeMusic] get_suggestions error: {e}")
            return []

