"""
What our Telegram bot says, and saying it (TECHNICAL_REQUIREMENTS.md
section 32, "Telegram through our bot").

The bot has one job today: confirming a sign-in. Kept apart from the routes
so the words live in one place and the routes stay about the sign-in.

Sending never raises. Telegram being slow or down must not turn a sign-in
the database already holds into an error; the page learns the outcome from
the database, never from whether a message went out.
"""

from __future__ import annotations

import json
import logging

from app.core.config import settings

log = logging.getLogger(__name__)

#: How long to wait for Telegram before giving up on one message.
TIMEOUT_SECONDS = 5

#: The bot's words, in Persian and in English, chosen by the language the
#: person's Telegram is set to.
WORDS = {
    "fa": {
        "ask": "دستگاهِ «{device}» می‌خواهد با حسابِ تلگرامِ تو واردِ Cosmos شود.\n\nخودت همین الان «ادامه با تلگرام» را زدی؟ اگر کسی این لینک را برایت فرستاده، تأیید نکن؛ او واردِ حسابت می‌شود.",
        "yes": "بله، خودم هستم",
        "no": "نه",
        "signed_in": "وارد شدی. حالا به Cosmos برگرد.",
        "refused": "باشد، کسی وارد نشد.",
        "expired": "این لینکِ ورود تمام شده. در Cosmos دوباره «ادامه با تلگرام» را بزن.",
        "hello": "برای ورود به Cosmos، در صفحه‌ی ورود «ادامه با تلگرام» را بزن.",
        "unknown": "نامشخص",
    },
    "en": {
        "ask": "The device “{device}” wants to sign in to Cosmos with your Telegram account.\n\nDid you just tap “Continue with Telegram” yourself? If someone sent you this link, don’t approve: they would be in your account.",
        "yes": "Yes, it’s me",
        "no": "No",
        "signed_in": "You’re signed in. Go back to Cosmos.",
        "refused": "OK, nobody was signed in.",
        "expired": "This sign-in link has run out. In Cosmos, tap “Continue with Telegram” again.",
        "hello": "To sign in to Cosmos, tap “Continue with Telegram” on the sign-in page.",
        "unknown": "unknown",
    },
}


def words(language_code: str | None) -> dict[str, str]:
    """Persian for a Telegram set to Persian, English for everyone else."""
    return WORDS["fa"] if (language_code or "").startswith("fa") else WORDS["en"]


def call(method: str, payload: dict) -> None:
    """One call to Telegram's Bot API. Never raises (see the module note)."""
    import requests  # imported here so nothing else pays for it

    try:
        requests.post(
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}",
            data={k: json.dumps(v) if isinstance(v, (dict, list)) else v for k, v in payload.items()},
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001 — a lost message is not a failed sign-in
        log.warning("Telegram did not take %s", method)


def say(chat_id: int, text: str) -> None:
    call("sendMessage", {"chat_id": chat_id, "text": text})


def ask(chat_id: int, text: str, yes: str, no: str, code: str) -> None:
    """The question, with its two buttons; each carries the request's code."""
    call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text,
            "reply_markup": {"inline_keyboard": [[{"text": yes, "callback_data": f"ok:{code}"}, {"text": no, "callback_data": f"no:{code}"}]]},
        },
    )


def answer_button(callback_id: str, chat_id: int, message_id: int, text: str) -> None:
    """After a button was tapped: the question is replaced by the outcome
    (so it cannot be tapped twice), and Telegram's spinner on it stops."""
    call("answerCallbackQuery", {"callback_query_id": callback_id})
    call("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": text})
