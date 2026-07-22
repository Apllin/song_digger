import asyncio
import re

from ytmusicapi import YTMusic
from app.adapters.base import AbstractAdapter
from app.core.seed_match import SEED_CANDIDATES, pick_best_candidate
from app.core.models import TrackMeta
from app.config import settings


def _bag(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", s.lower()) if t}

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


async def _pick_seed_video_id(query: str, results: list[dict]) -> str | None:
    """Return the videoId of the best query-matching hit, or None."""
    pairs = [
        (
            ", ".join(a.get("name", "") for a in (c.get("artists") or []) if a.get("name")),
            c.get("title") or "",
        )
        for c in results
    ]
    idx = await pick_best_candidate(query, pairs)
    if idx is None:
        print(f"[YouTubeMusic] no seed matched query {query!r}")
        return None
    return results[idx].get("videoId")


def _seed_dict_from_candidate(cand: dict, *, parse_title: bool) -> dict:
    """Build the {videoId, artist, title} seed dict resolve_seed returns.
    For UGC videos the real 'Artist - Title' is in the title and the artists
    field is the uploader channel, so parse it out; primary artist only."""
    names = [a.get("name", "") for a in (cand.get("artists") or []) if a.get("name")]
    if parse_title:
        parsed_artist, title = _split_artist_title(cand.get("title") or "")
        artist = parsed_artist or (names[0] if names else None)
    else:
        title = cand.get("title") or ""
        artist = names[0] if names else None
    return {"videoId": cand.get("videoId"), "artist": artist or None, "title": title}


def _pick_seed_video_id_from_videos(query: str, results: list[dict]) -> str | None:
    """Strict video-fallback seed matcher.

    Niche label releases (e.g. ND002 uploads on `the29nov`) live on YouTube
    Music as videos but are not indexed in the songs catalogue. For these the
    standard matcher rejects every songs hit because the artist appears with a
    different track. Videos search surfaces the actual upload — but the
    candidate's `artists` field carries the uploader channel name, not the
    real artist, so we cannot use the LLM-based seed matcher.

    Instead we treat the raw video title as one bag and require that **every**
    token of the query (both artist and title sides) appear in it. Token-set
    subset, no order, no stop-word stripping. Only used for "Artist - Title"
    queries — bare-artist queries should never videos-fall-back, since the
    matcher would be far too permissive (a single token in any random video
    title would qualify).
    """
    if " - " not in query:
        return None
    q_tokens = _bag(query.replace(" - ", " "))
    if not q_tokens:
        return None
    for cand in results:
        vid = cand.get("videoId")
        if not vid:
            continue
        title_tokens = _bag(cand.get("title") or "")
        if q_tokens.issubset(title_tokens):
            return vid
    return None


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
            # Seed search + async validation first, then radio in a thread.
            results = await asyncio.to_thread(_ytm.search, query, filter="songs", limit=SEED_CANDIDATES)
            video_id = await _pick_seed_video_id(query, results) if results else None

            # Videos fallback for label releases not indexed as songs.
            if not video_id and " - " in query:
                video_results = await asyncio.to_thread(_ytm.search, query, filter="videos", limit=SEED_CANDIDATES)
                video_id = _pick_seed_video_id_from_videos(query, video_results)
                if video_id:
                    print(f"[YouTubeMusic] seed from videos for {query!r}")

            if not video_id:
                return []

            return await asyncio.to_thread(self._radio_tracks_sync, video_id, limit)
        except Exception as e:
            print(f"[YouTubeMusic] find_similar error: {e}")
            return []

    def _radio_tracks_sync(self, video_id: str, limit: int) -> list[TrackMeta]:
        # playlistId="RDAMVM{videoId}" triggers the full radio station algorithm.
        radio_playlist_id = f"RDAMVM{video_id}"
        watch = _ytm.get_watch_playlist(videoId=video_id, playlistId=radio_playlist_id, limit=limit + 1)
        tracks_raw = watch.get("tracks", [])
        # Skip the first — it's the source track itself
        return [m for t in tracks_raw[1:limit + 1] if (m := _parse_ytm_track(t))]

    async def resolve_seed(self, query: str) -> dict | None:
        """Public seed resolver (catalog songs → UGC videos). Used by /similar to
        seed Cosine with the correct track URL and to derive the source artist."""
        try:
            songs = await asyncio.to_thread(_ytm.search, query, filter="songs", limit=SEED_CANDIDATES)
            vid = await _pick_seed_video_id(query, songs) if songs else None
            if vid:
                cand = next((c for c in songs if c.get("videoId") == vid), None)
                return _seed_dict_from_candidate(cand, parse_title=False) if cand else None
            if " - " in query:
                videos = await asyncio.to_thread(_ytm.search, query, filter="videos", limit=SEED_CANDIDATES)
                vid = _pick_seed_video_id_from_videos(query, videos)
                if vid:
                    cand = next((c for c in videos if c.get("videoId") == vid), None)
                    return _seed_dict_from_candidate(cand, parse_title=True) if cand else None
            return None
        except Exception as e:
            print(f"[YouTubeMusic] resolve_seed error: {e}")
            return None

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
        results = _ytm.search(artist, filter="artists", limit=1)
        if not results:
            return self._songs_radio_sync(artist, limit)

        artist_id = results[0].get("browseId")
        if not artist_id:
            return self._songs_radio_sync(artist, limit)

        artist_data = _ytm.get_artist(artist_id)

        # Prefer the artist's own radio station; fall back to a popular-track seed.
        radio_id = artist_data.get("radioId")
        if radio_id:
            watch = _ytm.get_watch_playlist(playlistId=radio_id, radio=True, limit=limit + 5)
        else:
            songs = artist_data.get("songs", {}).get("results", [])
            seed_vid = songs[0].get("videoId") if songs else None
            if not seed_vid:
                return self._songs_radio_sync(artist, limit)
            watch = _ytm.get_watch_playlist(videoId=seed_vid, limit=limit + 5)

        tracks_raw = watch.get("tracks", [])
        parsed = [m for t in tracks_raw if (m := _parse_ytm_track(t))]
        return parsed[:limit]

    def _songs_radio_sync(self, query: str, limit: int) -> list[TrackMeta]:
        # Bare-artist fallback: take the first songs hit without LLM validation.
        results = _ytm.search(query, filter="songs", limit=SEED_CANDIDATES)
        vid = next((c.get("videoId") for c in results if c.get("videoId")), None)
        if not vid:
            return []
        return self._radio_tracks_sync(vid, limit)

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

