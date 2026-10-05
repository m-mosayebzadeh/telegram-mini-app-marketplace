"""
"Too many tries, try again later" for the ways in (TECHNICAL_REQUIREMENTS.md
section 32): a light count of attempts, by who is asking, over a window.

Kept in this process's memory, not the database: counting must cost
nothing, and somebody hammering a route must not turn into database load —
which is the very thing the limit exists to stop. Old counts are forgotten
as the window passes, so memory stays bounded by how many people tried in
the last window, never by how many people the app has.

With several server processes each counts on its own, so the real limit is
somewhat looser. That is fine for the light limits (another phone,
Telegram); the strict one for text messages, which cost money, will count
in Redis when it is built.
"""

from __future__ import annotations

import threading
import time
from collections import deque


class Attempts:
    """At most `limit` attempts per key within `window_seconds`."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._seen: dict[str, deque[float]] = {}
        # Routes run on worker threads.
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def allow(self, key: str) -> bool:
        """Counts one attempt for `key`; False when it is one too many (and
        then it is not counted, so waiting is enough to be let in again)."""
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            tries = self._seen.setdefault(key, deque())
            while tries and now - tries[0] >= self.window:
                tries.popleft()
            if len(tries) >= self.limit:
                return False
            tries.append(now)
            return True

    def _sweep(self, now: float) -> None:
        """Once a window, forgets everybody whose attempts have all expired."""
        if now - self._last_sweep < self.window:
            return
        self._last_sweep = now
        for key in [k for k, tries in self._seen.items() if not tries or now - tries[-1] >= self.window]:
            del self._seen[key]

    def clear(self) -> None:
        """For tests."""
        with self._lock:
            self._seen.clear()
