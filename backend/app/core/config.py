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

# How many equal blocks a chat session is divided into. Fixed rather than
# per-offer on purpose: it is one less decision for a provider to make, and it
# keeps the session UI identical everywhere. A session's price must divide
# evenly by this, so no block price ever needs rounding.
SESSION_BLOCK_COUNT = 4


class Settings(BaseSettings):
    # The field name (telegram_bot_token) is matched to the environment
    # variable TELEGRAM_BOT_TOKEN (case-insensitive).
    telegram_bot_token: str

    # Maximum allowed age of Telegram init data, in seconds.
    # If a user sends data older than this, validation is rejected.
    telegram_auth_max_age_seconds: int = 24 * 60 * 60  # 24 hours

    # The database, in development as well as production.
    # Postgres, in development as well as production. The money code depends
    # on how the database takes locks, and running a different engine locally
    # from the one that will hold real balances is how a silent money bug gets
    # in. docs/LOCAL_DEV.md has the one command that starts it.
    database_url: str = "postgresql+psycopg://marketplace:devpass@localhost:5433/marketplace"

    # Enables developer-only routes (e.g. /dev/test-init-data) that must
    # never be reachable in production. Defaults to OFF on purpose: an
    # unset or missing value should always be the safe choice. Turn this
    # on locally only, and never while a tunnel (cloudflared/ngrok) is
    # forwarding external traffic to this server — the tunnel makes
    # requests look like they came from localhost too, so this flag is
    # the only real guard.
    enable_dev_tools: bool = False

    # Where uploaded content files are stored (see app/core/storage.py).
    # Defaults to backend/uploads/, but tests override it directly
    # (settings.uploads_dir = tmp_path) so uploads made during a test run
    # never touch this real local folder.
    uploads_dir: Path = BACKEND_DIR / "uploads"

    # --- financial settings (see TECHNICAL_REQUIREMENTS.md, "مدل مالی و اعتبار") ---
    #
    # Phase 1 only: these are plain constants here, not a database table,
    # because the admin panel that would let someone change them at
    # runtime is itself phase 2. Every other part of the app already
    # reads these from `settings` instead of hardcoding them, so phase 2
    # only has to move the VALUES into the database and add an endpoint
    # to edit them — no other code needs to change.

    # Toman per Drop, the app's own pricing unit. This is a FIXED PEG, not
    # a market rate: Drops and Toman are one currency at two scales. Keeping
    # it fixed is what removes a whole layer of complexity — every internal
    # money calculation stays in whole Toman, so a percentage split is exact
    # to within one Toman and rounding effectively disappears.
    drop_to_toman_rate: int = 1000

    # Platform commission on a purchase, as a whole percent of the price.
    # These are only the SEED values for a brand-new database: once the
    # singleton rates row exists, the admin panel (finance.rates scope) is
    # the source of truth and these are never read again.
    #
    # Charged at different moments by design: a chat's commission is taken
    # when the transaction is released (after the session closed cleanly and
    # the grace period passed), never before the service happened; content is
    # delivered instantly, so its commission is taken at purchase time.
    chat_commission_percent: int = 10
    content_commission_percent: int = 5

    # How long after a chat session closes before its transaction
    # auto-releases to the provider, if nobody disputes it (see
    # app/wallet/service.py's release_due_chat_transactions() and
    # TECHNICAL_REQUIREMENTS.md's "مدل مالی و اعتبار" — this mirrors the
    # grace-period pattern real escrow platforms like Upwork and
    # Clarity.fm use, just shorter given how small a single chat payment
    # is here).
    chat_release_grace_hours: int = 24

    # --- admin access (see TECHNICAL_REQUIREMENTS.md, "پنل مدیریتی") ---
    #
    # The one true super-admin, identified by their real Telegram id —
    # fixed here in .env rather than "first user to register", which
    # would be a real security hole on a live database (anyone who signs
    # up before the actual owner does would permanently become full
    # admin). Every other admin (support, accountant, ...) is granted
    # narrow, per-person access via the AdminGrant table instead — see
    # app/auth/dependencies.py's require_admin().
    owner_telegram_id: int | None = None

    # --- manual card-to-card top-up (see app/topup/router.py) ---
    #
    # Deliberately NOT hardcoded with a real value here — this file is
    # committed to git, and a bank card number/name is exactly the kind
    # of thing that must only ever live in .env (gitignored), the same
    # as TELEGRAM_BOT_TOKEN. Empty defaults just mean "not configured
    # yet" rather than a hard failure, since tests never need these set.
    topup_card_number: str = ""
    topup_card_holder_name: str = ""


    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")


# A single shared settings instance used throughout the app.
# Creating it is what actually triggers reading the .env file.
settings = Settings()
