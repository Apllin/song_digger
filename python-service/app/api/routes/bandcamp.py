from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.adapters.bandcamp import BandcampAdapter
from app.core.models import TracklistItem

router = APIRouter(prefix="/bandcamp")
_bandcamp = BandcampAdapter()


class BandcampLabel(BaseModel):
    id: int | None = None
    name: str
    url: str
    image: str | None = None


@router.get(
    "/label/search",
    operation_id="bandcamp_search_label",
    response_model=list[BandcampLabel],
)
async def search_label(q: str = Query(..., min_length=1, max_length=200)):
    try:
        return await _bandcamp.search_label(q)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get(
    "/release/tracklist",
    operation_id="bandcamp_release_tracklist",
    response_model=list[TracklistItem],
)
async def get_release_tracklist(url: str = Query(..., min_length=1, max_length=2048)):
    """Tracklist for a Bandcamp release URL (cached via get_release_meta)."""
    try:
        meta = await _bandcamp.get_release_meta(url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not meta:
        return []
    return meta.get("tracklist", [])
