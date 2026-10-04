"""
Carrying live events from one server process to the others
(TECHNICAL_REQUIREMENTS.md section 32, "more than one node").

Every phone with the app open holds one live connection, to ONE server
process — whichever the load balancer handed it to. With a single process
that is the whole story (app/live/hub.py). With several, Sara may be held
by the first and Bardia by the second: the first saves Sara's message and
looks for Bardia among its own connections, and he is not there.

Redis closes the gap. Every process sends each event to one Redis channel
and every process listens on it; the process that holds the person
delivers it. Redis keeps nothing — an event is gone the moment it is
heard — which is exactly right: the database already holds everything,
and a phone that missed an event simply asks again when it reconnects.

Optional on purpose. Without REDIS_URL the app runs as one process, as it
always has; with it, as many as are needed. Nothing that announces an
event knows the difference.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

log = logging.getLogger(__name__)

#: The one channel every process speaks on.
CHANNEL = "cosmos:live"

#: How long to wait before listening again after Redis went away. Short,
#: because while a process is not listening, people held by it miss events
#: from the others (they catch up from the database, but late).
RETRY_SECONDS = 2.0


class RedisBroker:
    """Sends and listens on Redis. Sending is synchronous on purpose: most
    routes run on worker threads, and a publish is one quick round trip."""

    def __init__(self, url: str) -> None:
        import redis  # imported here so a single-process install never needs it

        self._url = url
        self._client = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)

    def send(self, message: str) -> None:
        """Never raises: Redis being down must never turn a saved message
        into an error. The people on this same process were already told
        directly (hub.publish); the rest catch up when they reconnect."""
        try:
            self._client.publish(CHANNEL, message)
        except Exception:  # noqa: BLE001 — any failure here is only a missed nudge
            log.warning("live event not sent to other processes (Redis unreachable)")

    async def listen(self, deliver: Callable[[str], None], stop: asyncio.Event) -> None:
        """Hands every message on the channel to `deliver` until `stop` is
        set, listening again by itself whenever Redis goes away."""
        import redis.asyncio as aioredis

        while not stop.is_set():
            client = aioredis.Redis.from_url(self._url)
            try:
                async with client.pubsub() as pubsub:
                    await pubsub.subscribe(CHANNEL)
                    while not stop.is_set():
                        message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                        if message is not None:
                            data = message["data"]
                            deliver(data.decode() if isinstance(data, bytes) else data)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — keep listening whatever went wrong
                log.warning("lost the live channel; listening again in %ss", RETRY_SECONDS)
                try:
                    await asyncio.wait_for(stop.wait(), RETRY_SECONDS)
                except asyncio.TimeoutError:
                    pass
            finally:
                await client.aclose()
