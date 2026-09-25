"""
Noticing when somebody is being moved off the app to pay.

The one thing this product sells is the guarantee around paying a
stranger (TECHNICAL_REQUIREMENTS.md section 24). Money that leaves through
a card number typed into a chat is money the app cannot protect — and when
that goes wrong, the person who was cheated does not blame the stranger,
they blame the place where they met him.

Nothing here blocks a message. Two friends settling a dinner bill are not
doing anything wrong, and a chat that refuses to carry a number would push
the whole conversation to Telegram, which is the opposite of the point.
What happens instead is a warning in the conversation and a quiet signal
for staff — see the router.

**Every pattern below has to be certain, not likely.** The owner was
explicit that a wrong warning is worse than no warning, and that shaped
each rule:

- A card number must be sixteen digits AND pass the Luhn checksum every
  bank card carries. A random sixteen-digit number passes one time in
  ten, so most of what merely looks like a card is thrown out.
- A Sheba number must be IR followed by twenty-four digits AND pass the
  international bank account checksum, which is far stricter still.
- A phone number must be a whole Iranian mobile number, not any run of
  digits.
- A handle must stand on its own: "@name" at the start of a word, never
  the middle of an email address.

Persian and Arabic digits are read as the digits they are, because
someone who types a card number in Persian is still typing a card number.
"""

import re

#: What kind of detail was found. Kept as short stable strings: they are
#: stored, and staff filter by them.
KIND_CARD = "card"
KIND_SHEBA = "sheba"
KIND_PHONE = "phone"
KIND_HANDLE = "handle"

_PERSIAN = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC = "٠١٢٣٤٥٦٧٨٩"
_TO_LATIN = str.maketrans(_PERSIAN + _ARABIC, "0123456789" * 2)

# Sixteen digits, optionally grouped in fours by a single space or dash —
# the ways people actually write a card. Anchored on non-digits either
# side, so a sixteen-digit slice of a longer number is not a card.
_CARD = re.compile(r"(?<!\d)(\d{4})[ \-]?(\d{4})[ \-]?(\d{4})[ \-]?(\d{4})(?!\d)")

# IR, then twenty-four digits with any spacing people put in.
_SHEBA = re.compile(r"(?<![A-Za-z])IR[ ]?((?:\d[ ]?){24})(?!\d)", re.IGNORECASE)

# An Iranian mobile: 09xxxxxxxxx, or the same with +98 / 0098 in front.
_PHONE = re.compile(r"(?<!\d)(?:\+98|0098|0)9\d{2}[ \-]?\d{3}[ \-]?\d{4}(?!\d)")

# "@name" or a t.me / telegram.me link. The lookbehind is what keeps an
# email address — where "@" follows a word character — out of it.
_HANDLE = re.compile(
    r"(?:(?<![\w@])@[A-Za-z][A-Za-z0-9_]{4,31}\b)|(?:\b(?:t|telegram)\.me/[A-Za-z0-9_+]{3,})",
    re.IGNORECASE,
)


def _luhn_valid(digits: str) -> bool:
    """The checksum every bank card number carries.

    Double every second digit from the right, subtract nine from anything
    over nine, and the total has to divide by ten. It is the difference
    between "sixteen digits" and "a card number".
    """
    total = 0
    for position, char in enumerate(reversed(digits)):
        value = int(char)
        if position % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def _sheba_valid(digits24: str) -> bool:
    """The international bank account (IBAN) check, for an Iranian Sheba.

    Move the country code and its two check digits to the end, turn the
    letters into numbers, and the whole thing modulo 97 must be 1. Almost
    nothing that is not a real account passes it.
    """
    # "IR" is 18, 27 as numbers; the first two of the 24 are the check digits.
    rearranged = digits24[2:] + "1827" + digits24[:2]
    return int(rearranged) % 97 == 1


def find_payment_details(text: str | None) -> set[str]:
    """Which kinds of off-app payment detail this text contains.

    An empty set means nothing certain was found — which is the answer for
    nearly every message, and the only acceptable answer for anything that
    merely resembles one.
    """
    if not text:
        return set()

    normalised = text.translate(_TO_LATIN)
    found: set[str] = set()

    for match in _CARD.finditer(normalised):
        if _luhn_valid("".join(match.groups())):
            found.add(KIND_CARD)
            break

    for match in _SHEBA.finditer(normalised):
        digits = match.group(1).replace(" ", "")
        if len(digits) == 24 and _sheba_valid(digits):
            found.add(KIND_SHEBA)
            break

    if _PHONE.search(normalised):
        found.add(KIND_PHONE)

    if _HANDLE.search(normalised):
        found.add(KIND_HANDLE)

    return found
