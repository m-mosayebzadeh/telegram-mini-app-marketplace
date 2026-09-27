"""
How many new people somebody may meet in a day — one budget for every way
of meeting a stranger (TECHNICAL_REQUIREMENTS.md section 30.21).

Two doors lead to a stranger: saying hello to somebody in the world, and
Echo finding somebody at random. They used to have separate limits (twenty
hellos, and an Echo quota that started unlimited), which added up to a lot
of strangers and two numbers nobody could keep in their head. The owner
made it one number: ten a day in total, editable from the panel.

What counts:
- a conversation this person OPENED today (Conversation.opened_by_id) —
  never one somebody else opened with them, and never talking again to
  somebody they already have a thread with;
- an Echo conversation this person had today.

"Today" is the UTC day, the same boundary Echo and the request quota use,
so everyone gets their fresh budget at the same moment.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.rates import get_rates
from app.core.time import start_of_utc_day
from app.models.conversation import Conversation
from app.random_chat.service import used_today as echo_used_today


def new_people_limit(db: Session) -> int:
    return get_rates(db).daily_new_people


def new_people_used(db: Session, user_id: int) -> int:
    opened = db.scalar(
        select(func.count(Conversation.id)).where(
            Conversation.opened_by_id == user_id,
            Conversation.created_at >= start_of_utc_day(),
        )
    )
    return (opened or 0) + echo_used_today(db, user_id)


def new_people_left(db: Session, user_id: int) -> int:
    return max(0, new_people_limit(db) - new_people_used(db, user_id))
