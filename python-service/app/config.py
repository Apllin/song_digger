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
    # Yandex Music API geoblocks non-RU IPs with HTTP 451 since 2024. The
    # adapter is functional but every request returns []. Default OFF to
    # save the ~1s gather wait and the log noise; flip to true from .env
    # when running on a RU-resident proxy or self-hosting in RU.
    yandex_music_enabled: bool = False
    # Troi / ListenBrainz lb-radio adapter (TRA-28). Enabled by default — it
    # contributes to the merged /similar set and to model training. Set
    # TROI_ENABLED=false in .env to A/B against the Last.fm-only baseline.
    # NOTE: MetaBrainz data is free for non-commercial use only — confirm the
    # commercial posture before a paid deployment (source-legality thread).
    troi_enabled: bool = True
    # dig_intensity → lb-radio mode (easy/medium/hard). "hard" biases toward the
    # long tail (exploration), which is the core Track Digger goal; gate-tested
    # to return on-target results for hypnotic/dub techno seeds.
    troi_dig_intensity: str = "hard"
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
