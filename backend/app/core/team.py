"""
Cosmos Team (TECHNICAL_REQUIREMENTS.md section 37): the one account the app
itself writes from.

Every person has one ordinary conversation with it, at the top of nobody's
attention until something happens: a new sign-in to their account ("if this
was not you, close it" — with the button), a change to their ways in, and
later events. It is written into like any conversation, so it reaches the
phone live, shows in the list with its unread mark, and needs nothing new
on the screen beyond its name and mark.

It is not a person, and the world never shows it: its status is TEAM, never
ACTIVE, and everything that lists people lists active people only. In the
conversation list it looks like somebody you chat with (the owner's
decision).

People may answer it, and that is how somebody talks to us: staff with
the support permission read and answer these conversations as the team,
from the app's own conversation screen (app/support, section 43). The
person only ever sees "Cosmos Team".
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.conversation.service import get_or_create_direct, touch
from app.core.time import utcnow
from app.models.chat_message import ChatMessage, ChatMessageType
from app.models.conversation import CAP_TEXT
from app.models.user import User, UserStatus

#: The name it goes by, in every language: it is a name, not a phrase.
TEAM_NAME = "Cosmos Team"

#: What the team says, by the language the person uses the app in.
WORDS = {
    "fa": {
        "new_sign_in": "ورودِ تازه به حسابت\n{device}، با {way}.\n\nاگر خودت نبودی، همین حالا این نشست را ببند.",
        "door_changed": "{what}\n\nاگر کارِ خودت نبود، همین حالا از تنظیمات، دستگاه‌های دیگر را ببند.",
        "ways": {"google": "گوگل", "telegram": "تلگرام", "device": "گوشیِ دیگر", "dev": "ورودِ آزمایشی"},
        "unknown": "دستگاهِ نامشخص",
        "doors": {
            "google_linked": "یک حسابِ گوگل به‌عنوانِ راهِ ورود به حسابت وصل شد{label}.",
            "google_removed": "ورود با گوگل از حسابت برداشته شد.",
            "telegram_linked": "یک حسابِ تلگرام به‌عنوانِ راهِ ورود به حسابت وصل شد{label}.",
            "telegram_removed": "ورود با تلگرام از حسابت برداشته شد.",
        },
    },
    "en": {
        "new_sign_in": "A new sign-in to your account\n{device}, with {way}.\n\nIf it wasn’t you, close this session now.",
        "door_changed": "{what}\n\nIf it wasn’t you, close your other devices in Settings now.",
        "ways": {"google": "Google", "telegram": "Telegram", "device": "another phone", "dev": "test sign-in"},
        "unknown": "an unknown device",
        "doors": {
            "google_linked": "A Google account was connected as a way into your account{label}.",
            "google_removed": "Google was taken off the ways into your account.",
            "telegram_linked": "A Telegram account was connected as a way into your account{label}.",
            "telegram_removed": "Telegram was taken off the ways into your account.",
        },
    },
}


def words_for(user: User) -> dict:
    """In the person's language; English when the app has not said yet."""
    return WORDS["fa"] if user.language == "fa" else WORDS["en"]


def team_user(db: Session) -> User:
    """The Cosmos Team account, made the first time it is needed."""
    team = db.scalar(select(User).where(User.status == UserStatus.TEAM).order_by(User.id).limit(1))
    if team is None:
        team = User(first_name=TEAM_NAME, status=UserStatus.TEAM, joined_at=utcnow())
        db.add(team)
        db.flush()
    return team


def is_team(user: User | None) -> bool:
    return user is not None and user.status == UserStatus.TEAM


def say(db: Session, user: User, text: str, action: str | None = None) -> ChatMessage:
    """Writes `text` to `user` in their conversation with the team, and
    tells their open devices at once. Commits."""
    from app.live.events import announce_message  # the live layer imports the models; not at load time

    team = team_user(db)
    conversation = get_or_create_direct(db, user.id, team.id)
    # Only words go both ways here: no photos or voice to the team.
    conversation.base_capabilities = [CAP_TEXT]
    message = ChatMessage(
        conversation_id=conversation.id,
        sender_id=team.id,
        type=ChatMessageType.TEXT,
        text=text,
        action=action,
        created_at=utcnow(),
    )
    db.add(message)
    db.flush()
    touch(conversation, message.created_at)
    db.commit()
    db.refresh(message)
    announce_message(db, conversation, message)
    return message


def new_sign_in(db: Session, user: User, session_id: int, provider: str, device: str) -> None:
    """"A new sign-in to your account", with the button to close it.

    Not for the very first sign-in of a new account: that is the person
    arriving, not somebody arriving in their account.
    """
    said = words_for(user)
    shown_device = device if device and device != "?" else said["unknown"]
    way = said["ways"].get(provider, provider)
    say(db, user, said["new_sign_in"].format(device=shown_device, way=way), action=f"close_session:{session_id}")


def door_changed(db: Session, user: User, event: str, label: str | None = None) -> None:
    """A way in was connected or taken away (section 36, rule 3)."""
    said = words_for(user)
    what = said["doors"][event].format(label=f" ({label})" if label else "")
    say(db, user, said["door_changed"].format(what=what))

