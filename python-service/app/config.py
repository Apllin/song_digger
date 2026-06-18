from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Monorepo shares a single .env at the repo root. python-service/ runs with its
# own cwd, so anchor to this file's location instead of relying on cwd.
_REPO_ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # Empty by default — adapters no-op when missing. Real values live in .env.
    cosine_club_api_key: str = ""
    discogs_token: str = ""
    # FlareSolverr endpoint that solves the Cloudflare challenge on the Discogs
    # www stats page so the collaborative source can read a release's Have/Want
    # collectors, e.g. "http://flaresolverr:8191/v1". Empty → the collaborative
    # build soft-degrades to [] (no owner enumeration).
    discogs_stats_unblocker_url: str = ""
    yandex_music_token: str = ""
    lastfm_api_key: str = ""
    # Postgres connection string — shared with web (Prisma). Empty in test
    # environments; the trackid cache helpers soft-degrade when unset.
    database_url: str = ""
    # Trackid.net rewrite verified 2026-05-04. JSON API confirmed working
    # (no auth, no Cloudflare cookie); tests cover the full flow.
    # Enable by default — see ADR-0014.
    trackidnet_enabled: bool = True
    # Yandex Music API geoblocks non-RU IPs with HTTP 451 since 2024. The
    # adapter is functional but every request returns []. Default OFF to
    # save the ~1s gather wait and the log noise; flip to true from .env
    # when running on a RU-resident proxy or self-hosting in RU.
    yandex_music_enabled: bool = False
    # Origin used in YouTube embed URLs — must match the frontend host
    frontend_origin: str = "http://localhost:3000"
    # Shared secret for web → python-service requests. Required at startup
    # (app.main refuses to boot without it); empty default exists only so the
    # test suite can monkeypatch it per-case.
    python_service_secret: str = ""

    # extra="ignore": the shared root .env also holds POSTGRES_*, DATABASE_URL,
    # PYTHON_SERVICE_URL etc. for web/docker — silently ignore those here.
    model_config = SettingsConfigDict(
        env_file=_REPO_ROOT_ENV,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
