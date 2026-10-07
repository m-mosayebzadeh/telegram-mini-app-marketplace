"""
Sending notifications to closed apps (TECHNICAL_REQUIREMENTS.md section 38).

Who is told: only people who are NOT here right now. Somebody with the app
open hears it live already (app/live), and a notification on top would be
noise. "Here" is read from `last_seen_at`, which the heartbeat refreshes
every minute for everyone connected, on every server process — so this
works the same with one process or many, without asking the others.

What it costs: one small HTTPS request per subscribed device of each person
not here, per thing that happened. Never on a clock. The requests go out on
a few background threads, so the route that saved the message answers at
once, and a slow push service never holds a database place.

What is said: the sender's name and the message itself, short, in the
reader's own language for the words the app adds ("sent a photo") — the
way every messenger does it.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import sessions
from app.core.config import settings
from app.core.time import utcnow
from app.models.auth_session import AuthSession
from app.models.push import PushSubscription
from app.models.user import User

log = logging.getLogger(__name__)

#: Seen this recently means "here now": the heartbeat writes every minute.
HERE_WITHIN = timedelta(seconds=90)
#: How long a push service keeps trying to deliver a notification.
TTL_SECONDS = 24 * 60 * 60
#: The longest message text put into a notification.
PREVIEW = 120

#: A few threads: sending is waiting on the network, not work.
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="push")

#: The app's own words in a notification, by the reader's language.
WORDS = {
    "fa": {
        "photo": "یک عکس فرستاد",
        "voice": "یک پیامِ صوتی فرستاد",
        "video": "یک ویدیو فرستاد",
        "friend_asked": "می‌خواهد با تو دوست شود",
        "friend_accepted": "درخواستِ دوستی‌ات را پذیرفت",
        "message": "یک پیام فرستاد",
    },
    "en": {
        "photo": "sent a photo",
        "voice": "sent a voice message",
        "video": "sent a video",
        "friend_asked": "wants to be your friend",
        "friend_accepted": "accepted your friend request",
        "message": "sent a message",
    },
}


def ready() -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def words_for(user: User) -> dict[str, str]:
    return WORDS["fa"] if user.language == "fa" else WORDS["en"]


def is_here(user: User) -> bool:
    return user.last_seen_at is not None and utcnow() - user.last_seen_at < HERE_WITHIN


def tell(db: Session, user_ids: list[int], build) -> None:
    """Notifies whichever of `user_ids` is not here. `build(user)` returns
    the notification for that person ({title, body, url, tag}), or None to
    say nothing to them. Reads what it needs now; sends later."""
    if not ready() or not user_ids:
        return
    people = db.scalars(select(User).where(User.id.in_(user_ids))).all()
    away = [u for u in people if not is_here(u)]
    if not away:
        return
    subscriptions = db.execute(
        select(PushSubscription, AuthSession)
        .join(AuthSession, AuthSession.id == PushSubscription.session_id)
        .where(PushSubscription.user_id.in_([u.id for u in away]))
    ).all()
    # A device signed out, closed from elsewhere or unused for ninety days
    # is not told anything, and forgets its subscription.
    dead = [s.id for s, session in subscriptions if session.revoked_at is not None or utcnow() - session.last_used_at > sessions.lifetime()]
    if dead:
        db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead)))
        db.commit()
    by_user = {u.id: u for u in away}
    jobs = []
    for subscription, session in subscriptions:
        if subscription.id in dead:
            continue
        note = build(by_user[subscription.user_id])
        if note is None:
            continue
        jobs.append((subscription.id, subscription.endpoint, subscription.p256dh, subscription.auth, json.dumps(note)))
    for job in jobs:
        _pool.submit(_send, *job)


def _send(subscription_id: int, endpoint: str, p256dh: str, auth: str, data: str) -> None:
    """One notification to one browser. A browser that has gone (the person
    turned notifications off, or the subscription expired) is forgotten."""
    from pywebpush import WebPushException, webpush  # only the senders load it

    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=data,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=TTL_SECONDS,
            timeout=10,
        )
    except WebPushException as error:
        status = getattr(error.response, "status_code", None)
        if status in (404, 410):
            from app.core.database import SessionLocal

            with SessionLocal() as db:
                db.execute(delete(PushSubscription).where(PushSubscription.id == subscription_id))
                db.commit()
        else:
            log.warning("push not delivered (%s)", status)
    except Exception:  # noqa: BLE001 — a lost notification must never surface anywhere
        log.warning("push not delivered", exc_info=True)


# --- what happened ------------------------------------------------------------


def message_sent(db: Session, conversation, message, sender: User) -> None:
    """A message: to everyone else in the thread who is away and has not
    muted it. One notification per thread at a time (`tag`), so ten
    messages do not stack ten notifications."""
    from app.models.chat_message import ChatMessageType

    muted = {p.user_id for p in conversation.participants if p.muted or p.left_at is not None}
    others = [p.user_id for p in conversation.participants if p.user_id != sender.id and p.user_id not in muted]

    def build(reader: User) -> dict:
        if not reader.push_preview:
            # Only who wrote, unless the reader chose to see the words too:
            # a lock screen is seen by whoever is next to it.
            body = words_for(reader)["message"]
        elif message.type == ChatMessageType.TEXT:
            text = (message.text or "").strip()
            body = text if len(text) <= PREVIEW else text[: PREVIEW - 1] + "…"
        else:
            body = words_for(reader).get(message.type.value, "")
        return {
            "title": sender.display_name,
            "body": body,
            "url": f"/conversations/{conversation.id}",
            "tag": f"conversation-{conversation.id}",
        }

    tell(db, others, build)


def friend_asked(db: Session, asker: User, asked_id: int) -> None:
    tell(db, [asked_id], lambda reader: {
        "title": asker.display_name,
        "body": words_for(reader)["friend_asked"],
        "url": "/friends",
        "tag": f"friend-{asker.id}",
    })


def friend_accepted(db: Session, accepter: User, asker_id: int) -> None:
    tell(db, [asker_id], lambda reader: {
        "title": accepter.display_name,
        "body": words_for(reader)["friend_accepted"],
        "url": "/friends",
        "tag": f"friend-{accepter.id}",
    })
