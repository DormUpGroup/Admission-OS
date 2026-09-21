from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings shared by the API and workers.

    The existing root `.env` file remains the source of the Supabase URL and
    credentials. Python-specific values deliberately have no insecure default.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "IMMIGROME Backend"
    app_env: str = "development"
    database_url: str | None = Field(default=None, validation_alias="DATABASE_URL")
    internal_api_secret: str | None = Field(
        default=None, validation_alias="INTERNAL_API_SECRET"
    )
    auth_secret: str | None = Field(default=None, validation_alias="AUTH_SECRET")
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")

    @property
    def has_database(self) -> bool:
        return bool(self.database_url)

    @property
    def bridge_secret(self) -> str | None:
        """Use a dedicated bridge secret when present; retain safe local compatibility."""
        return self.internal_api_secret or self.auth_secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
