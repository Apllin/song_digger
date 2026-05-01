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
