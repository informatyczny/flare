from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    NOSTR_RELAYS: list[str] = ["ws://localhost:8080"]

    CONSENSUS_THRESHOLD: int = 2
    DATABASE_URL: str = "sqlite:///./data/flare.db"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
