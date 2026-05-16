from fastapi import APIRouter, HTTPException, Query

from app.adapters.bandcamp import BandcampAdapter
from app.adapters.discogs import DiscogsAdapter
from app.core.models import LabelReleasesResponse
from app.services.label_discography import get_label_releases_combined

router = APIRouter(prefix="/discography")
_discogs = DiscogsAdapter()
_bandcamp = BandcampAdapter()


@router.get(
    "/label/{label_id}/releases",
    operation_id="get_label_releases_combined",
    response_model=LabelReleasesResponse,
)
async def get_label_releases(
    label_id: int,
    label_name: str = Query(..., min_length=1, max_length=300),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
):
    """Label discography: Discogs primary + Bandcamp staleness fallback (ADR-0024)."""
    try:
        return await get_label_releases_combined(
            discogs=_discogs,
            bandcamp=_bandcamp,
            label_id=label_id,
            label_name=label_name,
            page=page,
            per_page=per_page,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
