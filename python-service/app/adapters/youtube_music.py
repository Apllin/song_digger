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


def _split_artist_title(raw_title: str) -> tuple[str | None, str]:
    """UGC video titles pack 'Artist - Title' into one string, with the channel
    as the nominal artist. Split on the first ' - '; return (None, raw) when
    there's no separator so the caller keeps the channel / original title."""
    parts = raw_title.split(" - ", 1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[0].strip(), parts[1].strip()
    return None, raw_title.strip()


def _best_seed_candidate(
    query: str, results: list[dict], *, parse_title: bool
) -> dict | None:
    """Pick the best-scoring search hit for `query` as a seed.

    YTM search is fuzzy: a query with no exact match still returns the closest
    text-similar hit, and a radio off that mismatched seed is the wrong genre.
    Scoring comes from `_seed_match.query_match_score` ("Artist - Title" needs an
    exact title-signature match; bare-artist accepts an artist match).

    `parse_title=False` (catalog `songs`): score the artists field + title.
    `parse_title=True` (`videos`): the real 'Artist - Title' lives in the video
    title and the artists field is the uploader channel, so parse the title
    first and fall back to the channel only when there's no separator.

    Returns {"videoId", "artist", "title"} of the best match (artist = primary
    name, never a compound), or None.
    """
    best: dict | None = None
    best_score = 0
    for cand in results:
        vid = cand.get("videoId")
        if not vid:
            continue
        names = [a.get("name", "") for a in (cand.get("artists") or []) if a.get("name")]
        if parse_title:
            parsed_artist, cand_title = _split_artist_title(cand.get("title") or "")
            score_artist = parsed_artist or ", ".join(names)
            primary_artist = parsed_artist or (names[0] if names else "")
        else:
            cand_title = cand.get("title") or ""
            score_artist = ", ".join(names)
            primary_artist = names[0] if names else ""
        score = query_match_score(query, score_artist, cand_title)
        if score > best_score:
            best_score = score
            best = {"videoId": vid, "artist": primary_artist or None, "title": cand_title}
    return best


def _parse_ytm_track(t: dict) -> TrackMeta | None:
    """Parse a track from get_watch_playlist results (uses singular `thumbnail`).

    Not for `search()` results — those have a different shape (`thumbnails` plural).
    """
    vid = t.get("videoId")
    if not vid:
        return None
    raw_title = t.get("title", "Unknown")
    artist = ", ".join(a.get("name", "") for a in (t.get("artists") or [])) or "Unknown"
    title = raw_title
    # UGC uploads carry 'Artist - Title' in the title and the uploader channel in
    # the artists field — parse the real pair so cards show the performer, not the
    # channel. Catalog tracks (ATV/OMV) keep their clean fields untouched.
    if t.get("videoType") == "MUSIC_VIDEO_TYPE_UGC":
        parsed_artist, parsed_title = _split_artist_title(raw_title)
        if parsed_artist:
            artist = parsed_artist
            title = parsed_title
    thumbnails = t.get("thumbnail") or []
    cover_url = thumbnails[-1].get("url") if thumbnails else None
    return TrackMeta(
        title=title,
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
        # Step 1: resolve + validate the seed (catalog songs, then UGC videos).
        seed = self._resolve_seed_sync(query)
        if not seed:
            return []
        video_id = seed["videoId"]

        # Step 2: get YTM Radio for this track.
        # playlistId="RDAMVM{videoId}" triggers the full radio station algorithm
        # (audio-similarity based), not just the short "Up Next" queue.
        radio_playlist_id = f"RDAMVM{video_id}"
        watch = _ytm.get_watch_playlist(videoId=video_id, playlistId=radio_playlist_id, limit=limit + 1)
        tracks_raw = watch.get("tracks", [])

        # Skip the first — it's the source track itself
        parsed = [m for t in tracks_raw[1:limit + 1] if (m := _parse_ytm_track(t))]
        return parsed

    def _resolve_seed_sync(self, query: str) -> dict | None:
        """Resolve `query` to a seed across catalog songs, then UGC videos.

        `search(filter='songs')` only covers YTM's official catalog; many
        underground tracks exist solely as user video uploads. When no song hit
        validates, fall back to `filter='videos'` and match against the parsed
        title. Returns {"videoId", "artist", "title"} or None.
        """
        songs = _ytm.search(query, filter="songs", limit=SEED_CANDIDATES)
        seed = _best_seed_candidate(query, songs, parse_title=False) if songs else None
        if seed:
            return seed
        videos = _ytm.search(query, filter="videos", limit=SEED_CANDIDATES)
        seed = _best_seed_candidate(query, videos, parse_title=True) if videos else None
        if not seed:
            print(f"[YouTubeMusic] no seed matched query {query!r} in songs or videos")
        return seed

    async def resolve_seed(self, query: str) -> dict | None:
        """Public seed resolver (catalog songs → UGC videos). Used by /similar to
        seed Cosine with the correct track URL and to derive the source artist."""
        try:
            return await asyncio.to_thread(self._resolve_seed_sync, query)
        except Exception as e:
            print(f"[YouTubeMusic] resolve_seed error: {e}")
            return None

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

