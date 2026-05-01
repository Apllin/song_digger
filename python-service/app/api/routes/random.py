import asyncio
from fastapi import APIRouter, HTTPException
from app.core.models import TrackMeta
from app.adapters.beatport import BeatportAdapter
from app.adapters.youtube_music import YouTubeMusicAdapter
from app.adapters.yandex_music import YandexMusicAdapter

router = APIRouter()

_beatport = BeatportAdapter()
_ytm = YouTubeMusicAdapter()
_yandex = YandexMusicAdapter()


@router.get("/random", response_model=TrackMeta)
async def random_track() -> TrackMeta:
    """
    Hedged requests: all sources start simultaneously.
    Returns the first non-None result — no sequential fallback latency.
    Priority order (by quality of metadata): Beatport > YTM > Yandex.
    Cosine.club has no /random endpoint in its public API.
    """
    tasks = [
        asyncio.create_task(_beatport.random_techno_track()),
        asyncio.create_task(_ytm.random_techno_track()),
        asyncio.create_task(_yandex.random_techno_track()),
    ]

    # Priority order: Cosine first, then Beatport, then YTM, then Yandex.
    # We wait for all to settle but pick in priority order.
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if isinstance(r, TrackMeta) and r is not None:
            return r

    raise HTTPException(status_code=503, detail="No random track available")
