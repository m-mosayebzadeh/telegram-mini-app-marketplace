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
- **birth year**, because the age range does not either.

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


def missing_for_random_chat(profile: Profile | None) -> list[str]:
    """
    The facts this person still owes us before they can be matched.

    An empty list means the door is open. Someone with no profile row at
    all owes both — the same answer as someone who has a profile but has
    filled in neither, because from the matcher's side those are the same
    situation.

    Order is fixed rather than incidental, so the interface can show the
    questions in a stable order without sorting them itself.
    """
    missing: list[str] = []
    if profile is None or profile.gender is None:
        missing.append(MISSING_GENDER)
    if profile is None or profile.birthday_year is None:
        missing.append(MISSING_BIRTH_YEAR)
    return missing


def is_ready_for_random_chat(profile: Profile | None) -> bool:
    """Shorthand for "nothing is missing"."""
    return not missing_for_random_chat(profile)


def age_from_birth_year(birth_year: int | None, *, today: date | None = None) -> int | None:
    """
    Age in whole years, or None when the year was never given.

    Deliberately coarse. Only the year is known, so this is "how old they
    turn this year" rather than a real age — which is all an age *range*
    ever needed, and it is the reason the door asks for one number instead
    of a full date.

    `today` is injectable so tests do not drift as real years pass.
    """
    if birth_year is None:
        return None
    current_year = (today or date.today()).year
    return max(0, current_year - birth_year)
