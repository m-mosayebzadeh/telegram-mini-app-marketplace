"""
The live connection: somebody with the app open hears about a new message
or a read receipt the moment it happens, without asking.
"""

import pytest
from starlette.websockets import WebSocketDisconnect

from app.live.hub import MAX_PENDING, LiveHub
from app.models.user import User
from tests.helpers import sign_init_data


def _credentials(telegram_id: int, first_name: str = "Test") -> str:
    return sign_init_data({"id": telegram_id, "first_name": first_name})


def _auth(telegram_id: int, first_name: str = "Test") -> dict:
    return {"X-Telegram-Init-Data": _credentials(telegram_id, first_name)}


def _pair(client, db_session, a, b):
    client.get("/me", headers=_auth(a, "Ali"))
    client.get("/me", headers=_auth(b, "Sara"))
    other = db_session.query(User).filter_by(telegram_id=b).one()
    thread = client.post("/conversations", json={"user_id": other.id}, headers=_auth(a)).json()
    return thread["id"], other


def _connect(client, telegram_id):
    socket = client.websocket_connect("/live")
    live = socket.__enter__()
    live.send_json({"type": "hello", "credentials": _credentials(telegram_id)})
    assert live.receive_json() == {"type": "ready"}
    return socket, live


def test_the_other_person_hears_a_new_message(client, db_session):
    thread, _ = _pair(client, db_session, 7001, 7002)
    socket, live = _connect(client, 7002)
    try:
        client.post(f"/conversations/{thread}/messages", data={"text": "سلام"}, headers=_auth(7001))
        event = live.receive_json()
        assert event["type"] == "message"
        assert event["conversation_id"] == thread
        assert event["message"]["text"] == "سلام"
    finally:
        socket.__exit__(None, None, None)


def test_the_sender_hears_their_own_message_too(client, db_session):
    # Their other device has the same thread open and needs it.
    thread, _ = _pair(client, db_session, 7003, 7004)
    socket, live = _connect(client, 7003)
    try:
        client.post(f"/conversations/{thread}/messages", data={"text": "hi"}, headers=_auth(7003))
        assert live.receive_json()["message"]["text"] == "hi"
    finally:
        socket.__exit__(None, None, None)


def test_a_stranger_hears_nothing(client, db_session):
    thread, _ = _pair(client, db_session, 7005, 7006)
    client.get("/me", headers=_auth(7007))
    socket, live = _connect(client, 7007)
    try:
        client.post(f"/conversations/{thread}/messages", data={"text": "private"}, headers=_auth(7005))
        live.send_json({"type": "ping"})
        # The first thing to arrive is the answer to the ping, not the message.
        assert live.receive_json() == {"type": "pong"}
    finally:
        socket.__exit__(None, None, None)


def test_the_sender_hears_when_it_was_read(client, db_session):
    thread, _ = _pair(client, db_session, 7008, 7009)
    client.post(f"/conversations/{thread}/messages", data={"text": "x"}, headers=_auth(7008))
    socket, live = _connect(client, 7008)
    try:
        client.post(f"/conversations/{thread}/read", headers=_auth(7009))
        event = live.receive_json()
        assert event["type"] == "read"
        assert event["conversation_id"] == thread
        assert event["read_at"]
    finally:
        socket.__exit__(None, None, None)


def test_the_thread_says_how_far_the_other_side_has_read(client, db_session):
    # So the ticks are right the moment the screen opens, before any event.
    thread, _ = _pair(client, db_session, 7010, 7011)
    before = client.get(f"/conversations/{thread}", headers=_auth(7010)).json()
    assert before["others_read_at"] is None
    client.post(f"/conversations/{thread}/read", headers=_auth(7011))
    after = client.get(f"/conversations/{thread}", headers=_auth(7010)).json()
    assert after["others_read_at"] is not None


def test_a_socket_without_valid_credentials_is_turned_away(client):
    with client.websocket_connect("/live") as live:
        live.send_json({"type": "hello", "credentials": "forged"})
        with pytest.raises(WebSocketDisconnect):
            live.receive_json()


def test_a_socket_that_never_says_hello_is_turned_away(client):
    with client.websocket_connect("/live") as live:
        live.send_text("not json")
        with pytest.raises(WebSocketDisconnect):
            live.receive_json()


def test_a_connection_that_stops_reading_is_cut_not_grown():
    # A phone that stopped reading must not make the server's memory grow
    # for as long as it runs.
    import asyncio

    async def scenario():
        hub = LiveHub()
        connection = hub.register(1)
        for index in range(MAX_PENDING + 50):
            connection.push({"n": index})
        assert connection.overflowed
        assert connection.queue.qsize() == MAX_PENDING + 1

    asyncio.run(scenario())


# --- sending twice is sending once ------------------------------------


def test_a_resent_message_is_saved_once(client, db_session):
    # The phone never saw the first answer and sent again.
    thread, _ = _pair(client, db_session, 7020, 7021)
    first = client.post(
        f"/conversations/{thread}/messages",
        data={"text": "hi", "client_id": "abc-1"},
        headers=_auth(7020),
    )
    again = client.post(
        f"/conversations/{thread}/messages",
        data={"text": "hi", "client_id": "abc-1"},
        headers=_auth(7020),
    )
    assert first.status_code == 201 and again.status_code == 201
    assert first.json()["id"] == again.json()["id"]
    listed = client.get(f"/conversations/{thread}/messages", headers=_auth(7020)).json()
    assert len(listed) == 1
    assert listed[0]["client_id"] == "abc-1"


def test_two_people_may_choose_the_same_name(client, db_session):
    # Unique per sender: it identifies a retry, not a message worldwide.
    thread, _ = _pair(client, db_session, 7022, 7023)
    a = client.post(f"/conversations/{thread}/messages", data={"text": "a", "client_id": "same"}, headers=_auth(7022))
    b = client.post(f"/conversations/{thread}/messages", data={"text": "b", "client_id": "same"}, headers=_auth(7023))
    assert a.json()["id"] != b.json()["id"]
