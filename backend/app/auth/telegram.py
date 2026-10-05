"""
A Telegram identity: who somebody is on Telegram, as far as this app needs.

Telegram is one of the doors into Cosmos (TECHNICAL_REQUIREMENTS.md section
32): the app is no longer opened inside Telegram, and Telegram's launch data
is no longer accepted anywhere. Signing in through Telegram will go through
our own bot, which learns who tapped "Start" from Telegram itself. This is
the shape both that and development sign-in hand to
app/auth/dependencies.py's user_from_telegram.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TelegramUser:
    """Somebody's Telegram account: the id that never changes, and the
    names used only to pre-fill a new account."""

    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
