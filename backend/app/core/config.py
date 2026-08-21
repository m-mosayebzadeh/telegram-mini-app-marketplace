"""
Application settings.

Instead of hardcoding values like the bot token directly in code (which is
dangerous — anyone with access to the code would also get the secret), we
read them from a ".env" file. The pydantic-settings library does this
automatically: we define a class where each field maps to an environment
variable.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The backend/ folder (three levels up from this file: core -> app -> backend).
# Anchoring the .env lookup here means it's always found regardless of
# which directory the process was launched from (VSCode debugger, a
# plain terminal, a script under scripts/, pytest, ...).
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


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

    # Enables developer-only routes (e.g. /dev/test-init-data) that must
    # never be reachable in production. Defaults to OFF on purpose: an
    # unset or missing value should always be the safe choice. Turn this
    # on locally only, and never while a tunnel (cloudflared/ngrok) is
    # forwarding external traffic to this server — the tunnel makes
    # requests look like they came from localhost too, so this flag is
    # the only real guard.
    enable_dev_tools: bool = False

    # Where uploaded photo files are stored (see app/core/storage.py).
    # Defaults to backend/uploads/, but tests override it directly
    # (settings.uploads_dir = tmp_path) so uploads made during a test run
    # never touch this real local folder.
    uploads_dir: Path = BACKEND_DIR / "uploads"

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")


# A single shared settings instance used throughout the app.
# Creating it is what actually triggers reading the .env file.
settings = Settings()
