"""
One-off setup, run by hand after deploying (or whenever the address or the
secret changes): tells Telegram where to send what people say to our bot —
today, signing in through it (app/auth/telegram_router.py).

Not done by the app on startup: the webhook is a setting on Telegram's side
that stays until changed, and doing it on every boot would fail on any
machine without access to api.telegram.org (tests, CI).

Run from backend/, with TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and
TELEGRAM_WEBHOOK_SECRET in .env:
    python scripts/set_telegram_webhook.py https://<domain>/api/telegram/webhook

A secret of your own, once:
    python -c "import secrets; print(secrets.token_urlsafe(32))"

To stop Telegram sending anything (e.g. to test locally with
scripts/telegram_dev_poll.py):
    python scripts/set_telegram_webhook.py --delete
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from app.core.config import settings  # noqa: E402


def bot(method: str, **params) -> dict:
    answer = requests.post(f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}", data=params, timeout=15)
    return answer.json()


def main() -> None:
    if sys.argv[1:] == ["--delete"]:
        print(bot("deleteWebhook"))
        return
    if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
        print("Usage: python scripts/set_telegram_webhook.py https://<domain>/api/telegram/webhook  (Telegram accepts HTTPS only)")
        sys.exit(1)
    if not settings.telegram_webhook_secret:
        print("TELEGRAM_WEBHOOK_SECRET is empty in .env: set it to a real random value first.")
        sys.exit(1)
    print(bot(
        "setWebhook",
        url=sys.argv[1],
        secret_token=settings.telegram_webhook_secret,
        allowed_updates='["message","callback_query"]',
    ))


if __name__ == "__main__":
    main()
