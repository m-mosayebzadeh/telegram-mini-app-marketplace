"""
Free conversations, and the three things that keep them safe.

What is sold here is the guarantee around paying a stranger, so the free
conversation has to be generous — voice and photographs included — while
making it obvious, both to the people talking and to staff, when money is
being moved somewhere the app cannot protect it.
"""

from io import BytesIO

from app.models.chat_message import ChatMessage
from app.models.report import Report
from app.models.user import User
from tests.helpers import make_test_image_bytes, sign_init_data

VALID_CARD = "6037991234567893"


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _pair(client, db_session, a, b):
    client.get("/me", headers=_auth(a, "Ali"))
    client.get("/me", headers=_auth(b, "Sara"))
    other = db_session.query(User).filter_by(telegram_id=b).one()
    thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(a)).json()
    return thread["id"], other


# --- what a free conversation can carry --------------------------------


def test_a_free_conversation_carries_voice(client, db_session):
    thread, _ = _pair(client, db_session, 6001, 6002)
    sent = client.post(
        f"/conversations/{thread}/messages",
        data={"type": "voice", "duration_seconds": "4"},
        headers=_auth(6001),
    )
    assert sent.status_code == 201, sent.text


def test_a_free_conversation_carries_photographs(client, db_session):
    thread, _ = _pair(client, db_session, 6003, 6004)
    sent = client.post(
        f"/conversations/{thread}/messages",
        data={"type": "photo"},
        files={"file": ("p.jpg", BytesIO(make_test_image_bytes()), "image/jpeg")},
        headers=_auth(6003),
    )
    assert sent.status_code == 201, sent.text


def test_video_still_belongs_to_a_paid_session(client, db_session):
    thread, _ = _pair(client, db_session, 6005, 6006)
    sent = client.post(
        f"/conversations/{thread}/messages",
        data={"type": "video", "duration_seconds": "4"},
        files={"file": ("v.mp4", BytesIO(b"\x00" * 64), "video/mp4")},
        headers=_auth(6005),
    )
    assert sent.status_code == 409
    assert sent.json()["detail"]["reason"] == "capability_not_available"


# --- the warning ------------------------------------------------------


def test_a_card_number_is_sent_and_marked_not_refused(client, db_session):
    """Two friends splitting a bill are not doing anything wrong, and a chat
    that refused to carry a number would push the whole conversation to
    Telegram. So it goes through, and it is marked."""
    thread, _ = _pair(client, db_session, 6010, 6011)
    sent = client.post(
        f"/conversations/{thread}/messages",
        data={"type": "text", "text": f"بریز به {VALID_CARD}"},
        headers=_auth(6010),
    )
    assert sent.status_code == 201
    assert sent.json()["flagged_payment"] is True


def test_an_ordinary_message_is_not_marked(client, db_session):
    thread, _ = _pair(client, db_session, 6012, 6013)
    sent = client.post(
        f"/conversations/{thread}/messages",
        data={"type": "text", "text": "سلام، امشب وقت داری؟"},
        headers=_auth(6012),
    )
    assert sent.json()["flagged_payment"] is False


def test_the_mark_is_seen_by_the_person_receiving_it_too(client, db_session):
    """The one being asked to pay is usually the one who gets hurt, so the
    warning cannot be something only the sender sees."""
    thread, _ = _pair(client, db_session, 6014, 6015)
    client.post(
        f"/conversations/{thread}/messages",
        data={"type": "text", "text": VALID_CARD},
        headers=_auth(6014),
    )
    received = client.get(f"/conversations/{thread}/messages", headers=_auth(6015)).json()
    assert received[-1]["flagged_payment"] is True


# --- reporting it -----------------------------------------------------


def test_being_asked_to_pay_outside_the_app_is_its_own_reason(client, db_session):
    thread, other = _pair(client, db_session, 6020, 6021)
    response = client.post(
        "/reports",
        json={
            "reported_user_id": other.id,
            "reason": "off_app_payment",
            "note": "اصرار داشت کارت‌به‌کارت کنم",
            "conversation_id": thread,
        },
        headers=_auth(6020),
    )
    assert response.status_code == 201
    report = db_session.query(Report).one()
    assert report.reason == "off_app_payment"
    assert report.note == "اصرار داشت کارت‌به‌کارت کنم"


def test_the_note_is_optional(client, db_session):
    _, other = _pair(client, db_session, 6022, 6023)
    response = client.post(
        "/reports",
        json={"reported_user_id": other.id, "reason": "off_app_payment"},
        headers=_auth(6022),
    )
    assert response.status_code == 201
    assert db_session.query(Report).one().note is None


def test_an_empty_note_is_stored_as_no_note(client, db_session):
    """A blank row is something staff open and find nothing in."""
    _, other = _pair(client, db_session, 6024, 6025)
    client.post(
        "/reports",
        json={"reported_user_id": other.id, "reason": "insult", "note": "   "},
        headers=_auth(6024),
    )
    assert db_session.query(Report).one().note is None


def test_a_note_cannot_be_an_essay(client, db_session):
    _, other = _pair(client, db_session, 6026, 6027)
    response = client.post(
        "/reports",
        json={"reported_user_id": other.id, "reason": "other", "note": "x" * 501},
        headers=_auth(6026),
    )
    assert response.status_code == 422


# --- the signal staff see ---------------------------------------------


def _staff(client, db_session, monkeypatch, telegram_id=6900):
    from app.core.config import settings

    monkeypatch.setattr(settings, "owner_telegram_id", telegram_id)
    client.get("/me", headers=_auth(telegram_id, "Owner"))
    return _auth(telegram_id)


def test_one_friend_is_not_a_pattern(client, db_session, monkeypatch):
    """Somebody who sends their card to the same friend five times has one
    relationship, not a routine."""
    thread, _ = _pair(client, db_session, 6030, 6031)
    for _ in range(5):
        client.post(
            f"/conversations/{thread}/messages",
            data={"type": "text", "text": VALID_CARD},
            headers=_auth(6030),
        )
    signals = client.get(
        "/admin/reports/payment-signals", headers=_staff(client, db_session, monkeypatch)
    ).json()
    assert signals == []


def test_the_same_card_sent_to_three_strangers_is_seen(client, db_session, monkeypatch):
    """Nobody reported this person — the pattern did. Most people who are
    cheated never report anything, so a list built only from reports sees
    the scams that already failed."""
    client.get("/me", headers=_auth(6040, "Scammer"))
    for index, stranger in enumerate((6041, 6042, 6043)):
        client.get("/me", headers=_auth(stranger, f"S{index}"))
        other = db_session.query(User).filter_by(telegram_id=stranger).one()
        thread = client.post(
            "/conversations", json={"user_id": other.id}, headers=_auth(6040)
        ).json()["id"]
        client.post(
            f"/conversations/{thread}/messages",
            data={"type": "text", "text": f"بریز به {VALID_CARD}"},
            headers=_auth(6040),
        )

    signals = client.get(
        "/admin/reports/payment-signals", headers=_staff(client, db_session, monkeypatch)
    ).json()
    assert len(signals) == 1
    assert signals[0]["display_name"] == "Scammer"
    assert signals[0]["distinct_conversations"] == 3


def test_appearing_on_the_list_restricts_nobody(client, db_session, monkeypatch):
    """A signal is something for a person to look at. Nothing automatic
    happens: an automatic punishment is never permanent, and a permanent
    one is never automatic."""
    client.get("/me", headers=_auth(6050, "Flagged"))
    threads = []
    for stranger in (6051, 6052, 6053):
        client.get("/me", headers=_auth(stranger))
        other = db_session.query(User).filter_by(telegram_id=stranger).one()
        thread = client.post(
            "/conversations", json={"user_id": other.id}, headers=_auth(6050)
        ).json()["id"]
        threads.append(thread)
        client.post(
            f"/conversations/{thread}/messages",
            data={"type": "text", "text": VALID_CARD},
            headers=_auth(6050),
        )

    still_talking = client.post(
        f"/conversations/{threads[0]}/messages",
        data={"type": "text", "text": "hello again"},
        headers=_auth(6050),
    )
    assert still_talking.status_code == 201


# --- the files behind voice notes and photographs ----------------------


def _send_photo(client, thread, telegram_id):
    return client.post(
        f"/conversations/{thread}/messages",
        data={"type": "photo"},
        files={"file": ("p.jpg", BytesIO(make_test_image_bytes()), "image/jpeg")},
        headers=_auth(telegram_id),
    ).json()


def test_both_people_can_open_a_photograph(client, db_session):
    thread, _ = _pair(client, db_session, 6060, 6061)
    photo = _send_photo(client, thread, 6060)
    for telegram_id in (6060, 6061):
        response = client.get(
            f"/conversations/{thread}/messages/{photo['id']}/file", headers=_auth(telegram_id)
        )
        assert response.status_code == 200


def test_a_stranger_cannot_open_it(client, db_session):
    thread, _ = _pair(client, db_session, 6062, 6063)
    photo = _send_photo(client, thread, 6062)
    client.get("/me", headers=_auth(6064))
    response = client.get(
        f"/conversations/{thread}/messages/{photo['id']}/file", headers=_auth(6064)
    )
    assert response.status_code == 404


def test_clearing_a_conversation_hides_its_files_too(client, db_session):
    """Otherwise "clear this conversation" would be a lie: the message gone
    from the screen, the photograph still one request away."""
    thread, _ = _pair(client, db_session, 6065, 6066)
    photo = _send_photo(client, thread, 6065)
    client.delete(f"/conversations/{thread}", headers=_auth(6066))

    cleared = client.get(
        f"/conversations/{thread}/messages/{photo['id']}/file", headers=_auth(6066)
    )
    assert cleared.status_code == 404

    # The other side cleared nothing and still has it.
    kept = client.get(
        f"/conversations/{thread}/messages/{photo['id']}/file", headers=_auth(6065)
    )
    assert kept.status_code == 200


# --- the conversation list, a page at a time ------------------------------


def test_conversations_come_a_page_at_a_time(client, db_session):
    """The stair asks for fifteen at a time; describing every thread at once
    was what made it heavy."""
    client.get("/me", headers=_auth(6900, "Me"))
    others = []
    for n in range(5):
        client.get("/me", headers=_auth(6901 + n, f"P{n}"))
        other = db_session.query(User).filter_by(telegram_id=6901 + n).one()
        thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(6900)).json()
        client.post(f"/conversations/{thread['id']}/messages", data={"text": str(n)}, headers=_auth(6900))
        others.append(thread["id"])

    everything = client.get("/conversations", headers=_auth(6900)).json()
    first = client.get("/conversations?limit=2", headers=_auth(6900)).json()
    second = client.get("/conversations?limit=2&offset=2", headers=_auth(6900)).json()
    rest = client.get("/conversations?limit=2&offset=4", headers=_auth(6900)).json()

    assert len(everything) == 5
    # Pages are the same order as the whole list, with nothing lost or repeated.
    assert [c["id"] for c in first + second + rest] == [c["id"] for c in everything]
    # Most recent first.
    assert first[0]["id"] == others[-1]


def test_the_unread_count_knows_about_an_old_thread_on_a_later_page(client, db_session):
    """The list is fetched fifteen at a time; an old unread thread on page
    two once made the door say "1" while the header said "0". The count is
    its own question now, over every thread."""
    client.get("/me", headers=_auth(6950, "Me"))
    threads = []
    for n in range(4):
        client.get("/me", headers=_auth(6951 + n, f"Q{n}"))
        other = db_session.query(User).filter_by(telegram_id=6951 + n).one()
        thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(6950)).json()
        threads.append(thread["id"])
    # The oldest thread gets a message from the other side and stays unread...
    client.post(f"/conversations/{threads[0]}/messages", data={"text": "hi"}, headers=_auth(6951))
    # ...and three newer ones arrive and are read.
    for n in range(1, 4):
        client.post(f"/conversations/{threads[n]}/messages", data={"text": "hey"}, headers=_auth(6951 + n))
        client.post(f"/conversations/{threads[n]}/read", headers=_auth(6950))

    # By date, not unread first (the owner's decision): the old unread
    # thread waits on a later page, and the count still knows about it.
    first = client.get("/conversations?limit=2", headers=_auth(6950)).json()
    assert [c["id"] for c in first] == [threads[3], threads[2]]

    count = client.get("/conversations/unread", headers=_auth(6950)).json()
    assert count == {"conversations": 1}

    client.post(f"/conversations/{threads[0]}/read", headers=_auth(6950))
    assert client.get("/conversations/unread", headers=_auth(6950)).json() == {"conversations": 0}


def test_your_own_last_message_is_not_unread(client, db_session):
    """Writing in a thread does not make it count as waiting for you."""
    client.get("/me", headers=_auth(6960, "Me"))
    client.get("/me", headers=_auth(6961, "R"))
    other = db_session.query(User).filter_by(telegram_id=6961).one()
    thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(6960)).json()
    client.post(f"/conversations/{thread['id']}/messages", data={"text": "hi"}, headers=_auth(6960))
    assert client.get("/conversations/unread", headers=_auth(6960)).json() == {"conversations": 0}
    assert client.get("/conversations/unread", headers=_auth(6961)).json() == {"conversations": 1}


# --- one daily budget for new people: "say hello" and Echo together ------


def _someone_new(client, db_session, telegram_id):
    client.get("/me", headers=_auth(telegram_id, f"P{telegram_id}"))
    return db_session.query(User).filter_by(telegram_id=telegram_id).one()


def test_the_eleventh_stranger_in_a_day_is_refused(client, db_session):
    """Ten new people a day in total (section 30.21), editable in the panel."""
    client.get("/me", headers=_auth(6800, "Me"))
    for n in range(10):
        other = _someone_new(client, db_session, 6801 + n)
        assert client.post("/conversations", json={"user_id": other.id}, headers=_auth(6800)).status_code == 201
    left = client.get("/conversations/new-people", headers=_auth(6800)).json()
    assert left == {"limit": 10, "left": 0}
    one_more = _someone_new(client, db_session, 6799)
    refused = client.post("/conversations", json={"user_id": one_more.id}, headers=_auth(6800))
    assert refused.status_code == 429
    assert refused.json()["detail"] == {"reason": "daily_new_people_limit", "limit": 10}


def test_someone_you_already_know_never_counts(client, db_session):
    """Saying hello again to a person you have a thread with is not meeting
    somebody new, and is never refused."""
    client.get("/me", headers=_auth(6600, "Me"))
    friend = _someone_new(client, db_session, 6601)
    client.post("/conversations", json={"user_id": friend.id}, headers=_auth(6600))
    for n in range(9):
        other = _someone_new(client, db_session, 6602 + n)
        client.post("/conversations", json={"user_id": other.id}, headers=_auth(6600))
    again = client.post("/conversations", json={"user_id": friend.id}, headers=_auth(6600))
    assert again.status_code == 201


def test_being_greeted_by_many_people_never_stops_you_greeting(client, db_session):
    """The budget counts the people you approach. It once counted every
    thread you were in, so strangers saying hello to you locked you out."""
    me = _someone_new(client, db_session, 6700)
    for n in range(12):
        _someone_new(client, db_session, 6701 + n)
        assert client.post("/conversations", json={"user_id": me.id}, headers=_auth(6701 + n)).status_code == 201
    stranger = _someone_new(client, db_session, 6650)
    assert client.post("/conversations", json={"user_id": stranger.id}, headers=_auth(6700)).status_code == 201


def test_the_budget_comes_from_the_panel(client, db_session):
    from app.core.rates import get_rates

    rates = get_rates(db_session)
    rates.daily_new_people = 2
    db_session.commit()
    client.get("/me", headers=_auth(6500, "Me"))
    for n in range(2):
        other = _someone_new(client, db_session, 6501 + n)
        client.post("/conversations", json={"user_id": other.id}, headers=_auth(6500))
    third = _someone_new(client, db_session, 6509)
    assert client.post("/conversations", json={"user_id": third.id}, headers=_auth(6500)).status_code == 429
