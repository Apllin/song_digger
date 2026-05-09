from fastapi import APIRouter, HTTPException, Query
from app.adapters.discogs import DiscogsAdapter
from app.core.models import (
    ArtistReleasesResponse,
    DiscogsArtist,
    DiscogsLabel,
    LabelReleasesResponse,
    TracklistItem,
)

router = APIRouter(prefix="/discogs")
_discogs = DiscogsAdapter()


@router.get(
    "/search",
    operation_id="search_artists",
    response_model=list[DiscogsArtist],
)
async def search_artist(q: str = Query(..., min_length=1)):
    try:
        return await _discogs.search_artist(q)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get(
    "/artist/{artist_id}/releases",
    operation_id="get_artist_releases",
    response_model=ArtistReleasesResponse,
)
async def get_releases(
    artist_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    role: str | None = Query(None, max_length=64),
):
    try:
        return await _discogs.get_releases(artist_id, page, per_page, role)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get(
    "/label/search",
    operation_id="search_labels",
    response_model=list[DiscogsLabel],
)
async def search_label(q: str = Query(..., min_length=1)):
    try:
        return await _discogs.search_label(q)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get(
    "/label/{label_id}/releases",
    operation_id="get_label_releases",
    response_model=LabelReleasesResponse,
)
async def get_label_releases(
    label_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
):
    try:
        return await _discogs.get_label_releases(label_id, page, per_page)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get(
    "/release/{release_id}/tracklist",
    operation_id="get_release_tracklist",
    response_model=list[TracklistItem],
)
async def get_tracklist(
    release_id: int,
    release_type: str = Query("release", pattern="^(release|master)$"),
):
    try:
        return await _discogs.get_tracklist(release_id, release_type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
