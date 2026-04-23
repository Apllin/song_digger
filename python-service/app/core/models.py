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


class SimilarResponse(BaseModel):
    tracks: list[TrackMeta]
    source_artist: str | None = None   # extracted from first Cosine/YTM result
    source_bpm: float | None = None    # median BPM of top Cosine results
    source_key: str | None = None      # most common key of top Cosine results
    source_energy: float | None = None # median energy of top Cosine results
