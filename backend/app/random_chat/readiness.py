"""
The door into random chat: what a person must have told us before the
matcher can use them.

Signup asks for almost nothing on purpose (TECHNICAL_REQUIREMENTS.md
section 28) — every field on that screen costs users, and this product's
biggest problem is not having enough people. So the two facts the matcher
genuinely needs are asked here instead, at the moment the reason for
asking is obvious, which is also the moment people answer honestly.

Only two, and only because matching cannot work without them:

- **gender**, because "who do you want to meet" has nothing to compare
  against otherwise;
- **birth date**, because the age range does not either.

Everything else people are asked at this point — who they want today,
which age range, which interests — is a *search* preference, not a fact
about them, so it is asked on every search and stored nowhere.

What is deliberately NOT checked here: age itself. The eighteen-or-over
confirmation happens once at signup and the rest is left open (owner's
decision, section 28). This module answers "can the matcher use you",
not "are you allowed in".
"""

from datetime import date

from app.models.profile import Profile

#: What is missing, as stable strings the interface can map to its own
#: wording. Not sentences: these cross the wire and get translated.
MISSING_GENDER = "gender"
MISSING_BIRTH_YEAR = "birth_year"


#: Said "eighteen or over" (section 32): asked the first time Echo opens.
MISSING_ADULT = "adult"


def missing_for_random_chat(user, schedule=None) -> list[str]:
    """
    What this person still owes before they can be matched.

    Gender and birth date used to be asked here, for the matcher's
    preferences; the owner took them out of Echo (section 32): not asked,
    not matched on. What remains is "eighteen or over", asked the first
    time Echo opens — Echo is where strangers meet — and never again once
    given. The panel can turn the question off (`schedule.ask_adult`).
    """
    if schedule is not None and getattr(schedule, "ask_adult", True) is False:
        return []
    if getattr(user, "adult_confirmed_at", None) is None:
        return [MISSING_ADULT]
    return []


def is_ready_for_random_chat(user, schedule=None) -> bool:
    """Shorthand for "nothing is missing"."""
    return not missing_for_random_chat(user, schedule)


def age_from_birth_year(birth_year: int | None, *, today: date | None = None) -> int | None:
    """
    Age in whole years, or None when the year was never given.

    Deliberately coarse: "how old they turn this year" rather than a real
    age to the day, which is all an age *range* ever needed.

    The door collects a full birth date, not just a year (section 28.1).
    Asking only for the year was proposed and rejected: people withhold
    their birth year because they do not want their age public, not
    because typing a date is hard — so the year is collected and can be
    hidden instead, which keeps the day and month that make a birthday
    worth having.

    `today` is injectable so tests do not drift as real years pass.
    """
    if birth_year is None:
        return None
    current_year = (today or date.today()).year
    return max(0, current_year - birth_year)
