"""
Last.fm adapter — track.getSimilar via the public REST API, with an
artist-level fallback used both for artist-only queries and for seeds where
track.getSimilar returns nothing.

Last.fm exposes collaborative-filtering similarity (users who scrobbled
A also scrobbled B). Ranking is by list position only — we trust Last.fm's
own ordering and do not apply score floors on our side.

The artist-level path runs `artist.getSimilar(seed_artist)` →
`artist.getTopTracks(similar_artist)` aggregated over the top-N similar
artists. Artist similars are cached in Postgres (LastfmArtistSimilars,
30-day TTL) because artist relationships move slowly; top-tracks are not
cached because they are cheap and need to reflect new releases.
"""
import asyncio

import httpx

from app.adapters.base import AbstractAdapter
from app.config import settings
from app.core.db import (
    fetch_lastfm_artist_similars,
    upsert_lastfm_artist_similars,
)
from app.core.models import TrackMeta

LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/"
DEFAULT_LIMIT = 50
TIMEOUT_SECONDS = 8.0

LASTFM_FALLBACK_ARTIST_CAP = 10  # how many similar artists to expand
LASTFM_FALLBACK_TRACKS_PER_ARTIST = 3  # tracks fetched per similar artist
LASTFM_FALLBACK_TOTAL_CAP = 30  # final cap on fallback contribution
LASTFM_FALLBACK_TTL_DAYS = 30  # artist similars are slow-moving
LASTFM_FALLBACK_CONCURRENCY = 5  # max concurrent artist.getTopTracks calls
# Position decay applied to per-artist ranks 1..3. Multiplied by the artist
# match score so a high-match artist's rank-2 track can still outrank a
# low-match artist's rank-1 track.
_POSITION_DECAY = (1.0, 0.7, 0.5)


class LastfmAdapter(AbstractAdapter):
    SOURCE = "lastfm"

    async def find_similar(self, query: str, limit: int = DEFAULT_LIMIT) -> list[TrackMeta]:
        # Query is "Artist - Track" or just "Artist". track.getSimilar requires
        # both, so artist-only queries go straight to the artist-level path.
        artist, track = _split_query(query)

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
        params = {
            "method": "track.getsimilar",
            "artist": artist,
            "track": track,
            "api_key": api_key,
            "format": "json",
            "limit": limit,
            "autocorrect": 1,  # let Last.fm fix "Mulero" -> "Oscar Mulero"
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.get(LASTFM_API_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            print(f"[Lastfm] find_similar error: {e}")
            return []

        tracks_data = data.get("similartracks", {}).get("track", []) or []
        results: list[TrackMeta] = []
        for t in tracks_data:
            try:
                match = float(t.get("match", 0))
            except (TypeError, ValueError):
                match = 0.0

            title = (t.get("name") or "").strip()
            artist_obj = t.get("artist") or {}
            artist_name = (artist_obj.get("name") or "").strip()
            url = (t.get("url") or "").strip()
            if not title or not artist_name or not url:
                continue

            cover_url: str | None = None
            for img in t.get("image") or []:
                if img.get("size") == "extralarge":
                    cover_url = img.get("#text") or None
                    break

            results.append(
                TrackMeta(
                    title=title,
                    artist=artist_name,
                    source=self.SOURCE,
                    sourceUrl=url,
                    coverUrl=cover_url,
                    score=match,
                )
            )

        return results

    # ── artist-level fallback (Stage B) ───────────────────────────────────────

    async def _artist_fallback(
        self, api_key: str, artist: str, limit: int
    ) -> list[TrackMeta]:
        similars = await self._get_artist_similars_cached(api_key, artist)
        if not similars:
            return []

        top_similars = similars[:LASTFM_FALLBACK_ARTIST_CAP]

        # Concurrency-limit the per-artist top-track calls. Last.fm's published
        # policy is 5 concurrent; a semaphore here keeps us inside it even when
        # the route fans out to many adapters in parallel.
        sem = asyncio.Semaphore(LASTFM_FALLBACK_CONCURRENCY)

        async def _one(sim: dict) -> list[dict]:
            async with sem:
                return await self._fetch_artist_top_tracks(
                    api_key, sim.get("name") or "", LASTFM_FALLBACK_TRACKS_PER_ARTIST
                )

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

    async def _get_artist_similars_cached(
        self, api_key: str, artist: str
    ) -> list[dict]:
        """
        Return artist similars from cache when fresh, else fetch from API and
        write through. Empty list is a valid cached value (means "Last.fm has
        no similars for this artist") and is returned without re-fetching.
        """
        cached = await fetch_lastfm_artist_similars(
            artist=artist, ttl_days=LASTFM_FALLBACK_TTL_DAYS
        )
        if cached is not None:
            return cached

        fetched = await self._fetch_artist_similar(api_key, artist)
        # Persist even an empty result — repeated unknown-artist queries should
        # not hammer the API.
        try:
            await upsert_lastfm_artist_similars(artist=artist, similars=fetched)
        except Exception as e:
            print(f"[Lastfm] artist-similars cache write error: {e}")
        return fetched

    async def _fetch_artist_similar(
        self, api_key: str, artist: str
    ) -> list[dict]:
        """artist.getSimilar — returns up to LASTFM_FALLBACK_ARTIST_CAP entries
        of {name, match, url}. Soft-degrades to [] on any error."""
        params = {
            "method": "artist.getsimilar",
            "artist": artist,
            "api_key": api_key,
            "format": "json",
            "limit": LASTFM_FALLBACK_ARTIST_CAP,
            "autocorrect": 1,
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.get(LASTFM_API_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            print(f"[Lastfm] artist.getSimilar error: {e}")
            return []

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
    ) -> list[dict]:
        """artist.getTopTracks — returns up to `limit` {name, artist, url}
        dicts. Soft-degrades to [] on any error."""
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
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.get(LASTFM_API_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            print(f"[Lastfm] artist.getTopTracks error: {e}")
            return []

        return data.get("toptracks", {}).get("track", []) or []


def _split_query(query: str) -> tuple[str, str | None]:
    """Parse "Artist - Track" -> (artist, track). Returns (query, None) when no separator."""
    if " - " not in query:
        return query.strip(), None
    artist, _, track = query.partition(" - ")
    artist = artist.strip()
    track = track.strip()
    if not track:
        return artist, None
    return artist, track
