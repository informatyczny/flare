from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    INVITE_EXPIRY_DAYS: int = 7
    MAX_OUTSTANDING_INVITES: int = 3

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
