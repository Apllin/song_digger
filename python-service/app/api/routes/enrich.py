from fastapi import APIRouter
from app.core.models import TrackMeta
from app.api.routes.similar import _beatport, ENRICH_CONCURRENCY

router = APIRouter()


@router.post("/enrich", response_model=list[TrackMeta])
async def enrich(tracks: list[TrackMeta]) -> list[TrackMeta]:
    """
    Background fill for tracks that didn't fit the inline budget in /similar.
    Web's enrichment queue calls this fire-and-forget after marking the search done.
    """
    if not tracks:
        return []
    enriched_map = await _beatport.enrich_tracks(tracks, max_concurrent=ENRICH_CONCURRENCY)
    return [enriched_map.get(t.sourceUrl, t) for t in tracks]
