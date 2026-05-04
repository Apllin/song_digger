from typing import Any
from app.adapters.base import AbstractAdapter
from app.core.models import TrackMeta
from app.config import settings

try:
    from yandex_music import ClientAsync
    from yandex_music.exceptions import YandexMusicError
except ImportError:
    ClientAsync = None  # type: ignore[assignment,misc]
    YandexMusicError = Exception  # type: ignore[assignment,misc]


class YandexMusicAdapter(AbstractAdapter):
    """
    Yandex.Music adapter via MarshalX/yandex-music-api (reverse-engineered).

    Provides catalog + cover art + similar-track recommendations. Does NOT
    return BPM/key/energy.
    Token must be set as YANDEX_MUSIC_TOKEN in the environment; without it
    the adapter no-ops (returns empty lists / None).
    """

    SOURCE = "yandex_music"

    def __init__(self) -> None:
        self._client: Any = None
        self._init_failed = False

    async def _get_client(self) -> Any:
        if self._client is not None or self._init_failed:
            return self._client
        if ClientAsync is None:
            print("[YandexMusic] yandex-music package not installed; adapter disabled")
            self._init_failed = True
            return None
        token = settings.yandex_music_token
        if not token:
            print("[YandexMusic] YANDEX_MUSIC_TOKEN is empty; adapter disabled")
            self._init_failed = True
            return None
        try:
            self._client = await ClientAsync(token).init()
            return self._client
        except Exception as e:
            print(f"[YandexMusic] init failed: {e}")
            self._init_failed = True
            return None

    async def find_similar(self, query: str, limit: int = 20) -> list[TrackMeta]:
        client = await self._get_client()
        if client is None:
            return []
        try:
            search = await client.search(query, type_="track", nocorrect=False)
            results = (search.tracks.results if search and search.tracks else None) or []
            if not results:
                return []
            seed = results[0]
            similar = await client.tracks_similar(seed.id)
            sim = (similar.similar_tracks if similar else None) or []
            return [m for t in sim[:limit] if (m := self._parse(t))]
        except YandexMusicError as e:
            print(f"[YandexMusic] find_similar error: {e}")
            return []
        except Exception as e:
            print(f"[YandexMusic] find_similar unexpected error: {e}")
            return []

    def _parse(self, t: Any) -> TrackMeta | None:
        if t is None or not getattr(t, "id", None):
            return None
        artists_list = getattr(t, "artists", None) or []
        artist = ", ".join(a.name for a in artists_list if getattr(a, "name", None)) or "Unknown"
        cover_url = self._cover_url(t)
        track_url = self._track_url(t)
        if not track_url:
            return None
        return TrackMeta(
            title=getattr(t, "title", None) or "Unknown",
            artist=artist,
            source=self.SOURCE,
            sourceUrl=track_url,
            coverUrl=cover_url,
            embedUrl=self._embed_url(t),
        )

    @staticmethod
    def _cover_url(t: Any) -> str | None:
        # cover_uri is a Yandex template like "avatars.yandex.net/get-music-content/.../%%"
        cover_uri = getattr(t, "cover_uri", None)
        if not cover_uri:
            albums = getattr(t, "albums", None) or []
            if albums:
                cover_uri = getattr(albums[0], "cover_uri", None)
        if not cover_uri:
            return None
        return f"https://{cover_uri.replace('%%', '400x400')}"

    @staticmethod
    def _track_url(t: Any) -> str | None:
        track_id = getattr(t, "id", None)
        if not track_id:
            return None
        albums = getattr(t, "albums", None) or []
        if albums and getattr(albums[0], "id", None):
            return f"https://music.yandex.ru/album/{albums[0].id}/track/{track_id}"
        return f"https://music.yandex.ru/track/{track_id}"

    @staticmethod
    def _embed_url(t: Any) -> str | None:
        # Yandex's iframe player requires both album and track id; the
        # bare-track URL has no embed equivalent, so fall through to None
        # and let the UI keep the external link.
        track_id = getattr(t, "id", None)
        albums = getattr(t, "albums", None) or []
        album_id = getattr(albums[0], "id", None) if albums else None
        if not track_id or not album_id:
            return None
        return f"https://music.yandex.ru/iframe/#track/{track_id}/{album_id}"
