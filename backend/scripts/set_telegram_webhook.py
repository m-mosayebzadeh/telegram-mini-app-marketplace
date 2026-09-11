"""
One-off setup script — run by hand, once, after deploying (or whenever
the webhook URL/secret changes). Tells Telegram where to send Stars
payment updates from now on (see app/telegram_webhook/router.py).

This is NOT something the app calls itself, and it's not run
automatically on startup — registering a webhook is a Telegram-side
setting that persists until explicitly changed, so doing it on every
app boot would be pointless (and would fail loudly on a machine with no
internet access to api.telegram.org, e.g. most CI/test runs).

Run from backend/, after TELEGRAM_WEBHOOK_SECRET is set in .env:
    python scripts/set_telegram_webhook.py https://api.ensanemanavi.ir/telegram/webhook

Requires TELEGRAM_WEBHOOK_SECRET to already be set in .env to a real
random value — generate one yourself, e.g.:
    python -c "import secrets; print(secrets.token_urlsafe(32))"
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.telegram_bot import set_webhook  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python scripts/set_telegram_webhook.py <https://your-domain/telegram/webhook>")
        sys.exit(1)

    url = sys.argv[1]
    if not url.startswith("https://"):
        print("The webhook URL must be HTTPS — Telegram refuses anything else.")
        sys.exit(1)
    if not settings.telegram_webhook_secret:
        print("TELEGRAM_WEBHOOK_SECRET is empty in .env — set it to a real random value first.")
        sys.exit(1)

    set_webhook(url=url, secret_token=settings.telegram_webhook_secret)
    print(f"Webhook registered: {url}")


if __name__ == "__main__":
    main()
