from pydantic import BaseModel


class TrackMeta(BaseModel):
    title: str
    artist: str
    source: str
    sourceUrl: str
    coverUrl: str | None = None
    embedUrl: str | None = None
    bpm: float | None = None
    key: str | None = None      # Camelot notation e.g. "8A"
    energy: float | None = None  # 0.0 - 1.0
    genre: str | None = None
    label: str | None = None
    score: float | None = None


class SimilarRequest(BaseModel):
    input: str                  # raw query string (preserved for adapters that key off the full input)
    artist: str                 # parsed artist name
    track: str | None = None    # parsed track name (None = artist-only search)
    limit_per_source: int = 20


class SourceList(BaseModel):
    source: str
    tracks: list[TrackMeta]


class SimilarResponse(BaseModel):
    source_lists: list[SourceList]
    source_artist: str | None = None


class LabelRelease(BaseModel):
    id: int
    title: str
    year: int | None = None
    artist: str | None = None
    format: str | None = None
    catno: str | None = None
    thumb: str | None = None
    type: str | None = None


class LabelReleasesPagination(BaseModel):
    page: int
    pages: int
    per_page: int
    items: int


class LabelReleasesResponse(BaseModel):
    releases: list[LabelRelease]
    pagination: LabelReleasesPagination


class DiscogsArtist(BaseModel):
    id: int
    name: str
    imageUrl: str | None = None
    resourceUrl: str | None = None


class DiscogsLabel(BaseModel):
    id: int
    name: str
    imageUrl: str | None = None
    resourceUrl: str | None = None


class ArtistRelease(BaseModel):
    id: int
    title: str
    artist: str | None = None   # headline artist of the release (≠ searched artist for Remix/Appearance roles)
    year: int | None = None
    type: str | None = None     # "master" | "release"
    role: str | None = None     # "Main" | "Appearance" | "TrackAppearance"
    format: str | None = None
    label: str | None = None
    thumb: str | None = None
    resourceUrl: str | None = None


class ArtistReleasesResponse(BaseModel):
    releases: list[ArtistRelease]
    pagination: LabelReleasesPagination


class TracklistItem(BaseModel):
    position: str
    title: str
    duration: str
    artists: list[str]
