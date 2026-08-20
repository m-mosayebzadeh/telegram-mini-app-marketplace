"""
Application settings.

Instead of hardcoding values like the bot token directly in code (which is
dangerous — anyone with access to the code would also get the secret), we
read them from a ".env" file. The pydantic-settings library does this
automatically: we define a class where each field maps to an environment
variable.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The field name (telegram_bot_token) is matched to the environment
    # variable TELEGRAM_BOT_TOKEN (case-insensitive).
    telegram_bot_token: str

    # Maximum allowed age of Telegram init data, in seconds.
    # If a user sends data older than this, validation is rejected.
    telegram_auth_max_age_seconds: int = 24 * 60 * 60  # 24 hours

    # Local development database. SQLite stores everything in a single
    # file, so no separate database server needs to be installed or run.
    # In production this will be swapped for a Postgres URL, without
    # changing any code that uses the ORM.
    database_url: str = "sqlite:///./app.db"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


# A single shared settings instance used throughout the app.
# Creating it is what actually triggers reading the .env file.
settings = Settings()
