from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    NOSTR_RELAYS: list[str] = ["ws://localhost:8080"]

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()