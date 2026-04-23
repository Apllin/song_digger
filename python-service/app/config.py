from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    cosine_club_api_key: str = "cosine_6rxVmKV8_ztVO6i3UyqanGuJSlVEsblk2kNpAwkqV"
    discogs_token: str = "eOgJIsfofGaBPEdbNNeNBnWOSyJXTxijlwqzKEFc"
    # Origin used in YouTube embed URLs — must match the frontend host
    frontend_origin: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
