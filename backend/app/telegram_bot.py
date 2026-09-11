"""
A thin wrapper over the handful of Telegram Bot API methods this app
actually calls — all related to real Telegram Stars payments (see
app/topup/router.py's create_star_invoice and
app/telegram_webhook/router.py's incoming-payment handler).

Every Bot API call is just a plain HTTPS POST to
https://api.telegram.org/bot<TOKEN>/<method> — no SDK needed, so this
stays a small, direct, easy-to-read module rather than pulling in a
whole Telegram bot framework for three method calls.

Stars payments specifically need NO third-party payment provider: the
Bot API's normal invoice fields (provider_token, etc.) are simply left
empty/unused, and the currency is the fixed string "XTR" (Telegram's
own code for Stars) — see https://core.telegram.org/bots/payments-stars.
"""

import httpx

from app.core.config import settings

TELEGRAM_API_BASE = "https://api.telegram.org"


class TelegramBotApiError(Exception):
    """Raised when Telegram's API itself reports failure (ok: false in
    the response body) — as opposed to a network-level error, which
    httpx already raises on its own."""


def _call(method: str, payload: dict) -> dict:
    url = f"{TELEGRAM_API_BASE}/bot{settings.telegram_bot_token}/{method}"
    response = httpx.post(url, json=payload, timeout=10)
    response.raise_for_status()
    body = response.json()
    if not body.get("ok"):
        raise TelegramBotApiError(body.get("description", "Unknown Telegram API error"))
    return body["result"]


def create_star_invoice_link(*, title: str, description: str, payload: str, stars: int) -> str:
    """
    Asks Telegram for a one-time payment link for `stars` Telegram
    Stars. The returned URL is what the frontend hands to
    Telegram.WebApp.openInvoice() to pop up the native payment sheet —
    see docs/TECHNICAL_REQUIREMENTS.md's Telegram Stars section.
    """
    result = _call(
        "createInvoiceLink",
        {
            "title": title,
            "description": description,
            "payload": payload,
            "currency": "XTR",
            # Stars prices have no decimal subdivision, so this is
            # simply [{"amount": stars}] — a single line item for the
            # whole purchase, no per-unit breakdown needed.
            "prices": [{"label": title, "amount": stars}],
        },
    )
    return result


def answer_pre_checkout_query(*, pre_checkout_query_id: str, ok: bool, error_message: str | None = None) -> None:
    """
    Telegram holds the payment sheet open until we answer this — must
    happen within 10 seconds of the pre_checkout_query webhook arriving
    (see app/telegram_webhook/router.py). Answering ok=False (with a
    human-readable error_message) cancels the payment before any Stars
    actually move, e.g. if the invoice_payload doesn't match a purchase
    we actually created.
    """
    payload: dict = {"pre_checkout_query_id": pre_checkout_query_id, "ok": ok}
    if error_message is not None:
        payload["error_message"] = error_message
    _call("answerPreCheckoutQuery", payload)


def set_webhook(*, url: str, secret_token: str) -> None:
    """Called once, by hand, via scripts/set_telegram_webhook.py — not
    part of any request path. Registers our webhook URL with Telegram
    and the secret it must echo back on every call (see
    Settings.telegram_webhook_secret's docstring)."""
    _call(
        "setWebhook",
        {
            "url": url,
            "secret_token": secret_token,
            # Only these two update types are useful to us — narrowing
            # this means Telegram doesn't bother sending (and our
            # webhook doesn't have to ignore) every other kind of
            # update (new messages, edited messages, ...), since this
            # bot's mini-app functionality never talks to the bot's own
            # chat interface at all.
            "allowed_updates": ["pre_checkout_query", "message"],
        },
    )
