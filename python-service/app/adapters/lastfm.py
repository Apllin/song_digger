"""
Last.fm adapter — track.getSimilar via the public REST API, with an
artist-level fallback used both for artist-only queries and for seeds where
track.getSimilar returns nothing.

Last.fm exposes collaborative-filtering similarity (users who scrobbled
A also scrobbled B). Ranking is by list position only — we trust Last.fm's
own ordering and do not apply score floors on our side.

The artist-level path runs `artist.getSimilar(seed_artist)` →
`artist.getTopTracks(similar_artist)` aggregated over the top-N similar
artists. Result caching lives at the /similar endpoint level, not in this
adapter — every method here is a direct API read.
"""
import asyncio
import random

from app.adapters._http import fetch_json_with_retry
from app.adapters.base import AbstractAdapter
from app.config import settings
from app.core.models import ParsedQuery, TrackMeta

LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/"
DEFAULT_LIMIT = 50
TIMEOUT_SECONDS = 8.0

LASTFM_FALLBACK_ARTIST_CAP = 10  # how many similar artists to expand
LASTFM_FALLBACK_TRACKS_PER_ARTIST = 3  # tracks fetched per similar artist
LASTFM_FALLBACK_TOTAL_CAP = 30  # final cap on fallback contribution
LASTFM_FALLBACK_CONCURRENCY = 5  # max concurrent artist.getTopTracks calls
# Top-tracks fetch size: pull up to N once, slice per caller. Covers the artist
# fallback (1 top + 2 random) and lastfm_hop (picks from positions 1..4).
_LASTFM_TOP_TRACKS_FETCH_LIMIT = 10
# track.getSimilar fetch size: pull a fixed N — callers slice to their limit.
_LASTFM_TRACK_SIMILAR_FETCH_LIMIT = 50
# Position decay applied to per-artist ranks 1..3. Multiplied by the artist
# match score so a high-match artist's rank-2 track can still outrank a
# low-match artist's rank-1 track.
_POSITION_DECAY = (1.0, 0.7, 0.5)


class LastfmAdapter(AbstractAdapter):
    SOURCE = "lastfm"

    async def find_similar(self, query: ParsedQuery, limit: int = DEFAULT_LIMIT) -> list[TrackMeta]:
        # track.getSimilar requires both artist and track, so artist-only
        # queries go straight to the artist-level path.
        artist, track = query.artist, query.track

        api_key = settings.lastfm_api_key
        if not api_key:
            return []

        if not track:
            return await self._artist_fallback(api_key, artist, limit)

        track_results = await self._fetch_track_similar(api_key, artist, track, limit)
        if track_results:
            return track_results[:limit]

        return await self._artist_fallback(api_key, artist, limit)

    # ── track.getSimilar (Stage A) ────────────────────────────────────────────

    async def _fetch_track_similar(
        self, api_key: str, artist: str, track: str, limit: int
    ) -> list[TrackMeta]:
        raw = await self._fetch_track_similar_raw(api_key, artist, track)
        results = [tm for t in raw if (tm := self._parse_similar_track(t))]
        return results[:limit]

    def _parse_similar_track(self, t: dict) -> TrackMeta | None:
        """Map one track.getSimilar entry to TrackMeta. Drops entries missing
        title/artist/url."""
        title = (t.get("name") or "").strip()
        artist_obj = t.get("artist") or {}
        artist_name = (artist_obj.get("name") or "").strip()
        url = (t.get("url") or "").strip()
        if not title or not artist_name or not url:
            return None
        try:
            match = float(t.get("match", 0))
        except (TypeError, ValueError):
            match = 0.0
        cover_url: str | None = None
        for img in t.get("image") or []:
            if img.get("size") == "extralarge":
                cover_url = img.get("#text") or None
                break
        return TrackMeta(
            title=title,
            artist=artist_name,
            source=self.SOURCE,
            sourceUrl=url,
            coverUrl=cover_url,
            score=match,
        )

    async def _fetch_track_similar_raw(
        self, api_key: str, artist: str, track: str
    ) -> list[dict]:
        """track.getSimilar HTTP call — returns raw API track dicts. Soft-degrades to []."""
        params = {
            "method": "track.getsimilar",
            "artist": artist,
            "track": track,
            "api_key": api_key,
            "format": "json",
            "limit": _LASTFM_TRACK_SIMILAR_FETCH_LIMIT,
            "autocorrect": 1,  # let Last.fm fix "Mulero" -> "Oscar Mulero"
        }
        data = await fetch_json_with_retry(
            LASTFM_API_BASE, params=params, timeout=TIMEOUT_SECONDS, label="Lastfm.track.getSimilar"
        )
        if data is None:
            return []
        return data.get("similartracks", {}).get("track", []) or []

    # ── artist-level fallback (Stage B) ───────────────────────────────────────

    async def _artist_fallback(
        self, api_key: str, artist: str, limit: int
    ) -> list[TrackMeta]:
        similars = await self._fetch_artist_similar(api_key, artist)
        if not similars:
            return []

        top_similars = similars[:LASTFM_FALLBACK_ARTIST_CAP]

        # Concurrency-limit the per-artist top-track calls. Last.fm's published
        # policy is 5 concurrent; a semaphore here keeps us inside it even when
        # the route fans out to many adapters in parallel.
        sem = asyncio.Semaphore(LASTFM_FALLBACK_CONCURRENCY)

        async def _one(sim: dict) -> list[dict]:
            async with sem:
                tracks = await self._fetch_artist_top_tracks(
                    api_key, sim.get("name") or "", _LASTFM_TOP_TRACKS_FETCH_LIMIT
                )
                return _pick_fallback_tracks(tracks or [])

        track_lists = await asyncio.gather(
            *(_one(s) for s in top_similars), return_exceptions=True
        )

        # Aggregate (similar_artist_match × position_decay). The multiplicative
        # form preserves artist-match weight: a 0.9-match artist's rank-2 track
        # (0.9*0.7=0.63) beats a 0.4-match artist's rank-1 track (0.4*1.0=0.40).
        candidates: list[tuple[float, dict]] = []
        for sim, tracks in zip(top_similars, track_lists):
            if isinstance(tracks, Exception) or not tracks:
                continue
            try:
                match = float(sim.get("match", 0))
            except (TypeError, ValueError):
                match = 0.0
            for rank, t in enumerate(tracks):
                decay = _POSITION_DECAY[rank] if rank < len(_POSITION_DECAY) else 0.4
                candidates.append((match * decay, t))

        candidates.sort(key=lambda x: -x[0])
        capped = candidates[:LASTFM_FALLBACK_TOTAL_CAP]

        results: list[TrackMeta] = []
        seen_urls: set[str] = set()
        for score, t in capped:
            title = (t.get("name") or "").strip()
            artist_obj = t.get("artist")
            if isinstance(artist_obj, dict):
                artist_name = (artist_obj.get("name") or "").strip()
            else:
                artist_name = (artist_obj or "").strip()
            url = (t.get("url") or "").strip()
            if not title or not artist_name or not url:
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            results.append(
                TrackMeta(
                    title=title,
                    artist=artist_name,
                    source=self.SOURCE,
                    sourceUrl=url,
                    score=score,
                )
            )

        return results[:limit]

    async def _fetch_artist_similar(
        self, api_key: str, artist: str
    ) -> list[dict] | None:
        """artist.getSimilar — returns up to LASTFM_FALLBACK_ARTIST_CAP entries
        of {name, match, url} on API success (possibly []), or None on fetch
        failure. None must NOT be cached as "no similars"."""
        params = {
            "method": "artist.getsimilar",
            "artist": artist,
            "api_key": api_key,
            "format": "json",
            "limit": LASTFM_FALLBACK_ARTIST_CAP,
            "autocorrect": 1,
        }
        data = await fetch_json_with_retry(
            LASTFM_API_BASE, params=params, timeout=TIMEOUT_SECONDS, label="Lastfm.artist.getSimilar"
        )
        if data is None:
            return None

        artists_data = data.get("similarartists", {}).get("artist", []) or []
        out: list[dict] = []
        for a in artists_data:
            name = (a.get("name") or "").strip()
            url = (a.get("url") or "").strip()
            if not name:
                continue
            try:
                match = float(a.get("match", 0))
            except (TypeError, ValueError):
                match = 0.0
            out.append({"name": name, "match": match, "url": url})
        return out

    async def _fetch_artist_top_tracks(
        self, api_key: str, artist: str, limit: int
    ) -> list[dict] | None:
        """artist.getTopTracks — returns up to `limit` {name, artist, url}
        dicts on API success (possibly []), or None on fetch failure."""
        if not artist:
            return []
        params = {
            "method": "artist.gettoptracks",
            "artist": artist,
            "api_key": api_key,
            "format": "json",
            "limit": limit,
            "autocorrect": 1,
        }
        data = await fetch_json_with_retry(
            LASTFM_API_BASE, params=params, timeout=TIMEOUT_SECONDS, label="Lastfm.artist.getTopTracks"
        )
        if data is None:
            return None

        return data.get("toptracks", {}).get("track", []) or []

    # ── public methods for cross-service reuse (see services/lastfm_hop.py) ──

    async def get_artist_similars(self, artist: str) -> list[dict]:
        """Public read of artist.getSimilar. Returns [] if api key missing or fetch fails."""
        api_key = settings.lastfm_api_key
        if not api_key or not artist:
            return []
        return await self._fetch_artist_similar(api_key, artist) or []

    async def get_artist_top_tracks(self, artist: str) -> list[dict]:
        """Public read of artist.getTopTracks. Returns [] if api key missing or fetch fails."""
        api_key = settings.lastfm_api_key
        if not api_key or not artist:
            return []
        return await self._fetch_artist_top_tracks(api_key, artist, _LASTFM_TOP_TRACKS_FETCH_LIMIT) or []


def _pick_fallback_tracks(tracks: list[dict]) -> list[dict]:
    """Most-popular top track plus 2 random others, for diversity."""
    if len(tracks) <= LASTFM_FALLBACK_TRACKS_PER_ARTIST:
        return tracks
    extra = random.sample(tracks[1:], LASTFM_FALLBACK_TRACKS_PER_ARTIST - 1)
    return [tracks[0], *extra]
