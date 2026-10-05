"""
Development only: signing in through the bot on a machine Telegram cannot
reach (no domain, no tunnel).

In production Telegram sends each update to our webhook. Here, this script
fetches the updates from Telegram instead and hands each one to the local
server's webhook, exactly as Telegram would, with the secret. Nothing in
the app changes; only the way updates arrive.

Telegram allows one or the other: while a webhook is set, fetching is
refused. The script then stops and says so; remove the webhook with
    python scripts/set_telegram_webhook.py --delete
— knowing that whatever server it pointed to stops hearing the bot until
it is set again.

Run from backend/, with the server up:
    python scripts/telegram_dev_poll.py [http://localhost:8000]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from app.core.config import settings  # noqa: E402


def main() -> None:
    local = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
    if not settings.telegram_webhook_secret:
        print("Set TELEGRAM_WEBHOOK_SECRET in .env (any random value) first.")
        sys.exit(1)
    api = f"https://api.telegram.org/bot{settings.telegram_bot_token}"
    hook = requests.get(f"{api}/getWebhookInfo", timeout=15).json().get("result", {})
    if hook.get("url"):
        print(f"A webhook is set ({hook['url']}), so Telegram will not hand updates out here.")
        print("Remove it with: python scripts/set_telegram_webhook.py --delete")
        sys.exit(1)
    print(f"Handing @{settings.telegram_bot_username}'s updates to {local} — Ctrl+C to stop.")
    offset = 0
    while True:
        # Telegram holds this open up to 50 seconds until something arrives.
        updates = requests.get(f"{api}/getUpdates", params={"timeout": 50, "offset": offset}, timeout=60).json()
        for update in updates.get("result", []):
            offset = update["update_id"] + 1
            answer = requests.post(
                f"{local}/telegram/webhook",
                json=update,
                headers={"X-Telegram-Bot-Api-Secret-Token": settings.telegram_webhook_secret},
                timeout=15,
            )
            print(update["update_id"], answer.status_code)


if __name__ == "__main__":
    main()
