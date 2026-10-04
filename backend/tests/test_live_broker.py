"""
More than one server process (TECHNICAL_REQUIREMENTS.md section 32, "more
than one node"): an event published on one process reaches a person held
by another, through the shared channel (app/live/broker.py), and the
heartbeat's own messages stay on their own process.

Two hubs stand in for two processes; a tiny in-memory channel stands in for
Redis, delivering every message to every listener as Redis does.
"""

import asyncio

from app.live.broker import RedisBroker
from app.live.hub import LiveHub


class MemoryChannel:
    """Every message to every hub attached, the sender included — the way a
    Redis channel behaves."""

    def __init__(self) -> None:
        self.hubs: list[LiveHub] = []
        self.sent: list[str] = []

    def join(self, hub: LiveHub) -> LiveHub:
        channel = self

        class Broker:
            def send(self, message: str) -> None:
                channel.sent.append(message)
                for other in channel.hubs:
                    other.receive(message)

        hub.attach(Broker())
        self.hubs.append(hub)
        return hub


def _drain(connection) -> list[dict]:
    out = []
    while not connection.queue.empty():
        out.append(connection.queue.get_nowait())
    return out


def test_a_message_reaches_somebody_held_by_another_process():
    async def run():
        channel = MemoryChannel()
        first = channel.join(LiveHub())
        second = channel.join(LiveHub())
        sara = first.register(1)
        bardia = second.register(2)

        # Sara's message is saved on the first process; Bardia is on the second.
        first.publish([2], {"type": "message", "conversation_id": 9})
        await asyncio.sleep(0)

        assert _drain(bardia) == [{"type": "message", "conversation_id": 9}]
        assert _drain(sara) == []

    asyncio.run(run())


def test_somebody_on_the_same_process_is_told_once_not_twice():
    async def run():
        channel = MemoryChannel()
        only = channel.join(LiveHub())
        bardia = only.register(2)
        only.publish([2], {"type": "read"})
        await asyncio.sleep(0)
        # Told directly; its own message coming back over the channel is skipped.
        assert _drain(bardia) == [{"type": "read"}]

    asyncio.run(run())


def test_everyone_on_every_process_hears_an_announcement_to_everyone():
    async def run():
        channel = MemoryChannel()
        first = channel.join(LiveHub())
        second = channel.join(LiveHub())
        a = first.register(1)
        b = second.register(2)
        first.publish_everyone({"type": "echo", "everyone": True})
        await asyncio.sleep(0)
        assert _drain(a) == [{"type": "echo", "everyone": True}]
        assert _drain(b) == [{"type": "echo", "everyone": True}]

    asyncio.run(run())


def test_the_heartbeat_tells_only_its_own_process():
    async def run():
        channel = MemoryChannel()
        first = channel.join(LiveHub())
        second = channel.join(LiveHub())
        here = first.register(1)
        there = second.register(1)  # the same person, on a second phone
        first.publish_local([1], {"type": "echo_counts"})
        await asyncio.sleep(0)
        assert _drain(here) == [{"type": "echo_counts"}]
        # The other process runs its own heartbeat for its own connections.
        assert _drain(there) == []
        assert channel.sent == []

    asyncio.run(run())


def test_a_broken_message_on_the_channel_is_dropped():
    async def run():
        hub = LiveHub()
        person = hub.register(1)
        hub.receive("not json")
        hub.receive('{"from": "x"}')
        await asyncio.sleep(0)
        assert _drain(person) == []

    asyncio.run(run())


def test_one_process_without_redis_works_as_before():
    async def run():
        hub = LiveHub()  # nothing attached: REDIS_URL unset
        person = hub.register(1)
        hub.publish([1], {"type": "friends"})
        await asyncio.sleep(0)
        assert _drain(person) == [{"type": "friends"}]

    asyncio.run(run())


def test_redis_being_down_never_turns_a_send_into_an_error():
    # Nothing listens on port 1: the send fails, quietly.
    RedisBroker("redis://127.0.0.1:1/0").send('{"users": [1], "event": {}}')
