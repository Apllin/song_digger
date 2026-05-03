from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Monorepo shares a single .env at the repo root. python-service/ runs with its
# own cwd, so anchor to this file's location instead of relying on cwd.
_REPO_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    cosine_club_api_key: str = "cosine_6rxVmKV8_ztVO6i3UyqanGuJSlVEsblk2kNpAwkqV"
    discogs_token: str = "eOgJIsfofGaBPEdbNNeNBnWOSyJXTxijlwqzKEFc"
    # Empty by default — adapter no-ops when missing.
    yandex_music_token: str = ""
    lastfm_api_key: str = ""
    # Postgres connection string — shared with web (Prisma). Empty in test
    # environments; the tracklist1001 cache helpers soft-degrade when unset.
    database_url: str = ""
    # Disabled by default: the live 1001tracklists search HTML differs from
    # the fixtures the adapter was written against (the GET/POST search
    # endpoints both return the homepage instead of results, suggesting an
    # AJAX/CSRF-gated search path). Flip to True once the search parser is
    # fixed against the live markup. Cache, scraper internals, and route
    # wiring stay in place so re-enabling is a one-config change.
    tracklist1001_enabled: bool = False
    # Disabled by default like tracklist1001 — flip to True in .env once the
    # parser is verified against the live trackid.net markup. Cache, scraper,
    # and route wiring stay in place so re-enabling is a one-config change.
    trackidnet_enabled: bool = False
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
