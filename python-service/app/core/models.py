from pydantic import BaseModel


class TrackMeta(BaseModel):
    title: str
    artist: str
    source: str  # "youtube_music" | "cosine_club"
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
    input: str                  # raw query string (kept for Bandcamp)
    artist: str                 # parsed artist name
    track: str | None = None    # parsed track name (None = artist-only search)
    sources: list[str] = ["youtube_music", "cosine_club"]
    limit_per_source: int = 20


class SourceList(BaseModel):
    source: str
    tracks: list[TrackMeta]


class SimilarResponse(BaseModel):
    source_lists: list[SourceList]
    source_artist: str | None = None
    source_bpm: float | None = None
    source_key: str | None = None
    source_energy: float | None = None
    source_label: str | None = None
    source_genre: str | None = None
