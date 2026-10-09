"""
The events the app may report about itself (TECHNICAL_REQUIREMENTS.md
section 43, "analytics"; the table is app/models/analytics.py).

A fixed list, each with what its number and its word may be. Anything else
is dropped, never stored: the vocabulary is the guarantee that no message
text, name or anything typed can ever end up here, whatever a client sends.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Kind:
    #: The words `detail` may be; None means it carries none.
    details: frozenset[str] | None = None
    #: The range `value` must fall in; None means it carries none.
    values: tuple[int, int] | None = None


EVENTS: dict[str, Kind] = {
    # Where people are on the way in, to see where they give up: the page
    # shown, then the way they chose.
    "signin_step": Kind(details=frozenset({"ways", "google", "telegram", "device", "test"})),
    # How long the app took to show something, in milliseconds.
    "app_load": Kind(values=(0, 120_000)),
    # Something broke on the phone: a script error or a promise nobody caught.
    "app_error": Kind(details=frozenset({"script", "promise"})),
    # The world's frames per second, measured once a visit, and whether the
    # light-graphics switch was on.
    "frame_rate": Kind(details=frozenset({"normal", "light"}), values=(1, 240)),
    # A notification was tapped.
    "push_opened": Kind(),
}

#: How many events one report may carry.
MAX_PER_REPORT = 20


def clean(name: str, value: int | None, detail: str | None) -> tuple[int | None, str | None] | None:
    """The event's number and word as they may be stored, or None when the
    event is not one the app may report."""
    kind = EVENTS.get(name)
    if kind is None:
        return None
    if kind.values is None:
        value = None
    elif value is None or not kind.values[0] <= value <= kind.values[1]:
        return None
    if kind.details is None:
        detail = None
    elif detail not in kind.details:
        return None
    return value, detail
