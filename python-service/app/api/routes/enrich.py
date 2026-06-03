from fastapi import APIRouter
from pydantic import BaseModel

from app.adapters.beatport import BeatportAdapter
from app.core.models import TrackMeta

router = APIRouter()

_beatport = BeatportAdapter()
ENRICH_CONCURRENCY = 5


class EnrichRequest(BaseModel):
    tracks: list[TrackMeta]


class EnrichResponse(BaseModel):
    tracks: list[TrackMeta]


@router.post(
    "/enrich",
    operation_id="enrich_audio_features",
    response_model=EnrichResponse,
)
async def enrich(req: EnrichRequest) -> EnrichResponse:
    """
    Background fill of BPM + Camelot key from Beatport for tracks that the
    web service didn't already have cached. Idempotent; already-complete
    tracks pass through untouched.
    """
    if not req.tracks:
        return EnrichResponse(tracks=[])
    enriched_map = await _beatport.enrich_tracks(req.tracks, max_concurrent=ENRICH_CONCURRENCY)
    return EnrichResponse(tracks=[enriched_map.get(t.sourceUrl, t) for t in req.tracks])
