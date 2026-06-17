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
    # environments; the /similar cache helpers soft-degrade when unset.
    database_url: str = ""
    # NOTE: MetaBrainz data (Troi / ListenBrainz lb-radio) is free for
    # non-commercial use only — confirm the commercial posture before a paid
    # deployment (source-legality thread).
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
