"""
Integration tests for chat messages: send (text/photo/video/voice),
list, fetch a photo/video message's file, and the access/validation
rules around all of that.
"""

from app.core.config import settings
from app.models.chat_message import (
    MAX_CHAT_MESSAGE_TEXT_LENGTH,
    MAX_CHAT_VIDEO_DURATION_SECONDS,
    MAX_CHAT_VOICE_DURATION_SECONDS,
)
from tests.helpers import give_wallet_balance, make_test_image_bytes, sign_init_data


def _auth_header(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": sign_init_data({"id": telegram_id, "first_name": first_name})}


def _login(client, telegram_id: int, first_name: str = "Test") -> dict:
    return client.get("/me", headers=_auth_header(telegram_id, first_name)).json()


def _create_offer(client, auth: dict, **overrides):
    payload = {
        "price_stars": 40,
        "display_duration_minutes": 30,
        "title": "Chat with me",
        "description": "A nice chat",
    }
    payload.update(overrides)
    return client.post("/offers", headers=auth, json=payload).json()


def _open_paid_session(client, db_session, auth_provider, auth_buyer, buyer_id, offer) -> dict:
    """Same happy-path helper as test_chat_session.py: request, accept,
    fund the buyer, pay — returns the freshly-opened session as JSON."""
    req = client.post("/requests", headers=auth_buyer, json={"offer_id": offer["id"]}).json()
    client.post(f"/requests/{req['id']}/accept", headers=auth_provider)
    give_wallet_balance(
        db_session, buyer_id, amount_toman=offer["price_stars"] * settings.star_to_toman_rate
    )
    client.post(f"/requests/{req['id']}/pay", headers=auth_buyer)
    return client.get("/chat-sessions/mine", headers=auth_buyer).json()[0]


def _setup_session(client, db_session):
    """A ready-to-message open session between Alice (provider) and Bob
    (buyer) — returns (session, auth_alice, auth_bob)."""
    auth_a = _auth_header(1, "Alice")
    auth_b = _auth_header(2, "Bob")
    _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")
    offer = _create_offer(client, auth_a)
    session = _open_paid_session(client, db_session, auth_a, auth_b, bob["id"], offer)
    return session, auth_a, auth_b


# --- auth / access ----------------------------------------------------------


def test_list_messages_requires_auth(client, db_session):
    session, _, _ = _setup_session(client, db_session)

    response = client.get(f"/chat-sessions/{session['id']}/messages")

    assert response.status_code == 422


def test_a_stranger_cannot_list_or_send_messages(client, db_session):
    session, _, _ = _setup_session(client, db_session)
    auth_carol = _auth_header(3, "Carol")
    _login(client, 3, "Carol")

    list_response = client.get(f"/chat-sessions/{session['id']}/messages", headers=auth_carol)
    send_response = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_carol,
        data={"type": "text", "text": "hi"},
    )

    assert list_response.status_code == 404
    assert send_response.status_code == 404


# --- sending a text message ---------------------------------------------


def test_send_and_list_a_text_message(client, db_session):
    session, auth_a, auth_b = _setup_session(client, db_session)

    sent = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "text", "text": "hello there"},
    )

    assert sent.status_code == 201
    body = sent.json()
    assert body["type"] == "text"
    assert body["text"] == "hello there"
    assert body["duration_seconds"] is None
    assert body["chat_session_id"] == session["id"]

    # Both participants see the same message.
    for auth in (auth_a, auth_b):
        listed = client.get(f"/chat-sessions/{session['id']}/messages", headers=auth).json()
        assert len(listed) == 1
        assert listed[0]["id"] == body["id"]
        assert listed[0]["text"] == "hello there"


def test_messages_come_back_in_chronological_order_with_the_right_sender(client, db_session):
    session, auth_a, auth_b = _setup_session(client, db_session)
    alice = _login(client, 1, "Alice")
    bob = _login(client, 2, "Bob")

    client.post(f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "text", "text": "1"})
    client.post(f"/chat-sessions/{session['id']}/messages", headers=auth_a, data={"type": "text", "text": "2"})
    client.post(f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "text", "text": "3"})

    listed = client.get(f"/chat-sessions/{session['id']}/messages", headers=auth_a).json()

    assert [m["text"] for m in listed] == ["1", "2", "3"]
    assert [m["sender_id"] for m in listed] == [bob["id"], alice["id"], bob["id"]]


def test_send_rejects_empty_text(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "text", "text": "   "}
    )

    assert response.status_code == 400


def test_send_rejects_text_over_the_length_limit(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "text", "text": "x" * (MAX_CHAT_MESSAGE_TEXT_LENGTH + 1)},
    )

    assert response.status_code == 400


# --- sending a photo message ----------------------------------------------


def test_send_a_photo_message_and_fetch_its_file(client, db_session):
    session, auth_a, auth_b = _setup_session(client, db_session)

    sent = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "photo"},
        files={"file": ("pic.jpg", make_test_image_bytes(), "image/jpeg")},
    )

    assert sent.status_code == 201
    body = sent.json()
    assert body["type"] == "photo"
    assert body["text"] is None
    assert body["duration_seconds"] is None
    assert "file_path" not in body  # never exposed directly, see ChatMessageOut

    # The other participant can fetch the actual bytes.
    file_response = client.get(
        f"/chat-sessions/{session['id']}/messages/{body['id']}/file", headers=auth_a
    )
    assert file_response.status_code == 200
    assert len(file_response.content) > 0


def test_send_photo_without_a_file_is_rejected(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "photo"}
    )

    assert response.status_code == 400


def test_a_stranger_cannot_fetch_a_photo_messages_file(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)
    auth_carol = _auth_header(3, "Carol")
    _login(client, 3, "Carol")
    sent = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "photo"},
        files={"file": ("pic.jpg", make_test_image_bytes(), "image/jpeg")},
    ).json()

    response = client.get(
        f"/chat-sessions/{session['id']}/messages/{sent['id']}/file", headers=auth_carol
    )

    assert response.status_code == 404


# --- sending a video message -----------------------------------------------


def test_send_a_video_message(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    sent = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "video", "duration_seconds": "12"},
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    )

    assert sent.status_code == 201
    body = sent.json()
    assert body["type"] == "video"
    assert body["duration_seconds"] == 12


def test_send_video_without_duration_is_rejected(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "video"},
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    )

    assert response.status_code == 400


def test_send_video_with_duration_over_the_limit_is_rejected(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "video", "duration_seconds": str(MAX_CHAT_VIDEO_DURATION_SECONDS + 1)},
        files={"file": ("clip.mp4", b"fake video bytes", "video/mp4")},
    )

    assert response.status_code == 400


# --- sending a voice message (simulated — never a real file) --------------


def test_send_a_voice_message_needs_no_file(client, db_session):
    session, auth_a, auth_b = _setup_session(client, db_session)

    sent = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "voice", "duration_seconds": "8"},
    )

    assert sent.status_code == 201
    body = sent.json()
    assert body["type"] == "voice"
    assert body["duration_seconds"] == 8

    # No file exists for a voice message — fetching one 404s, exactly
    # like a message that was never sent at all.
    file_response = client.get(
        f"/chat-sessions/{session['id']}/messages/{body['id']}/file", headers=auth_a
    )
    assert file_response.status_code == 404


def test_send_voice_without_duration_is_rejected(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "voice"}
    )

    assert response.status_code == 400


def test_send_voice_with_duration_over_the_limit_is_rejected(client, db_session):
    session, _, auth_b = _setup_session(client, db_session)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages",
        headers=auth_b,
        data={"type": "voice", "duration_seconds": str(MAX_CHAT_VOICE_DURATION_SECONDS + 1)},
    )

    assert response.status_code == 400


# --- closed session is read-only -------------------------------------------


def test_cannot_send_a_message_once_the_session_is_closed(client, db_session):
    session, auth_a, auth_b = _setup_session(client, db_session)
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_a)

    response = client.post(
        f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "text", "text": "too late"}
    )

    assert response.status_code == 400


def test_closed_session_messages_are_still_readable(client, db_session):
    session, auth_a, auth_b = _setup_session(client, db_session)
    client.post(f"/chat-sessions/{session['id']}/messages", headers=auth_b, data={"type": "text", "text": "hi"})
    client.post(f"/chat-sessions/{session['id']}/close", headers=auth_a)

    response = client.get(f"/chat-sessions/{session['id']}/messages", headers=auth_a)

    assert response.status_code == 200
    assert len(response.json()) == 1
