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
    automation_api_secret: str | None = Field(
        default=None, validation_alias="AUTOMATION_API_SECRET"
    )
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    hermes_api_url: str | None = Field(default=None, validation_alias="HERMES_API_URL")
    hermes_api_key: str | None = Field(default=None, validation_alias="HERMES_API_KEY")
    hermes_mcp_key: str | None = Field(default=None, validation_alias="HERMES_MCP_KEY")
    hermes_mcp_capability_secret: str | None = Field(
        default=None, validation_alias="HERMES_MCP_CAPABILITY_SECRET"
    )
    hermes_mcp_scopes: str = Field(
        default=(
            "leads:read,leads:write,cases:read,tasks:create,"
            "documents:read,documents:request,messages:draft,"
            "messages:send,appointments:write,approvals:create"
        ),
        validation_alias="HERMES_MCP_SCOPES",
    )
    telegram_bot_token: str | None = Field(
        default=None, validation_alias="TELEGRAM_BOT_TOKEN"
    )
    telegram_webhook_secret: str | None = Field(
        default=None, validation_alias="TELEGRAM_WEBHOOK_SECRET"
    )
    google_calendar_id: str | None = Field(
        default=None, validation_alias="GOOGLE_CALENDAR_ID"
    )
    google_service_account_json: str | None = Field(
        default=None, validation_alias="GOOGLE_SERVICE_ACCOUNT_JSON"
    )
    automation_enabled: bool = Field(default=False, validation_alias="AUTOMATION_ENABLED")

    @property
    def has_database(self) -> bool:
        return bool(self.database_url)

    @property
    def bridge_secret(self) -> str | None:
        """Dedicated Next.js-to-FastAPI signing secret."""
        return self.internal_api_secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
