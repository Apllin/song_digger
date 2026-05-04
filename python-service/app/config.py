from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Monorepo shares a single .env at the repo root. python-service/ runs with its
# own cwd, so anchor to this file's location instead of relying on cwd.
_REPO_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # Empty by default — adapters no-op when missing. Real values live in .env.
    cosine_club_api_key: str = ""
    discogs_token: str = ""
    yandex_music_token: str = ""
    lastfm_api_key: str = ""
    # Postgres connection string — shared with web (Prisma). Empty in test
    # environments; the trackid cache helpers soft-degrade when unset.
    database_url: str = ""
    # Trackid.net rewrite verified 2026-05-04. JSON API confirmed working
    # (no auth, no Cloudflare cookie); tests cover the full flow.
    # Enable by default — see ADR-0014.
    trackidnet_enabled: bool = True
    # Last.fm artist-similar fallback: when track.getSimilar returns 0 results
    # (common for underground techno seeds), expand via artist.getSimilar →
    # artist.getTopTracks. Default off until eval confirms it doesn't bleed
    # genres on control seeds (Charlotte, Beyer).
    lastfm_artist_fallback_enabled: bool = True
    # Origin used in YouTube embed URLs — must match the frontend host
    frontend_origin: str = "http://localhost:3000"

    # extra="ignore": the shared root .env also holds POSTGRES_*, DATABASE_URL,
    # PYTHON_SERVICE_URL etc. for web/docker — silently ignore those here.
    model_config = SettingsConfigDict(
        env_file=_REPO_ROOT_ENV,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
