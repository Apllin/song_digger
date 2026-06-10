import os

from fastapi import APIRouter
from pydantic import BaseModel

from app.adapters.beatport import BeatportAdapter
from app.core.models import TrackMeta

router = APIRouter()

_beatport = BeatportAdapter()
# Global cap on concurrent Beatport requests (shared across all in-flight
# searches). Tunable via env without a redeploy; raise carefully — higher means
# faster cold searches but more rate-limit/ToS exposure.
ENRICH_CONCURRENCY = int(os.getenv("BEATPORT_ENRICH_CONCURRENCY", "12"))


class EnrichRequest(BaseModel):
    tracks: list[TrackMeta]


class EnrichResponse(BaseModel):
    tracks: list[TrackMeta]
    # sourceUrls whose Beatport lookup failed transiently (not 'no data'). The
    # caller leaves these unmarked so they are retried on a later search.
    failed_urls: list[str] = []


@router.post(
    "/enrich",
    operation_id="enrich_audio_features",
    response_model=EnrichResponse,
)
async def enrich(req: EnrichRequest) -> EnrichResponse:
    """
    Synchronous fill of BPM + Camelot key from Beatport for tracks the web
    service didn't already have cached. Idempotent; already-complete tracks pass
    through untouched. Transiently-failed lookups are reported in `failed_urls`
    so the caller can retry them instead of caching a false negative.
    """
    if not req.tracks:
        return EnrichResponse(tracks=[], failed_urls=[])
    enriched_map, failed = await _beatport.enrich_tracks(req.tracks, max_concurrent=ENRICH_CONCURRENCY)
    return EnrichResponse(
        tracks=[enriched_map.get(t.sourceUrl, t) for t in req.tracks],
        failed_urls=sorted(failed),
    )
