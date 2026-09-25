"""
Noticing payment details typed into a chat.

The owner's rule for this is stricter than "usually right": a warning that
fires on an ordinary message is worse than no warning at all, because it
teaches people to ignore the real one. So there are as many tests here for
what must NOT be caught as for what must.
"""

import pytest

from app.chat_message.payment_details import (
    KIND_CARD,
    KIND_HANDLE,
    KIND_PHONE,
    KIND_SHEBA,
    find_payment_details,
)

# A number that passes the card checksum, and the same digits with the last
# one changed so that it does not. The pair is the whole point: the second
# LOOKS exactly like a card and must not be treated as one.
VALID_CARD = "6037991234567893"
NOT_A_CARD = "6037991234567894"

# The standard published example of an Iranian Sheba, which passes the
# international account checksum.
VALID_SHEBA = "IR062960000000100324200001"


# --- what has to be caught --------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        VALID_CARD,
        "6037 9912 3456 7893",
        "6037-9912-3456-7893",
        "کارتم اینه ۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۳ بزن",
        "بریز به 6037991234567893 مرسی",
    ],
)
def test_a_card_number_is_found_however_it_is_written(text):
    assert KIND_CARD in find_payment_details(text)


@pytest.mark.parametrize(
    "text",
    [VALID_SHEBA, "IR06 2960 0000 0010 0324 2000 01", "شبا: ir062960000000100324200001"],
)
def test_a_sheba_number_is_found(text):
    assert KIND_SHEBA in find_payment_details(text)


@pytest.mark.parametrize(
    "text",
    ["09121234567", "0912 123 4567", "+989121234567", "۰۹۱۲۱۲۳۴۵۶۷"],
)
def test_a_mobile_number_is_found(text):
    assert KIND_PHONE in find_payment_details(text)


@pytest.mark.parametrize(
    "text",
    ["پیام بده @sara_dev", "@nightowl99", "https://t.me/sara_dev", "telegram.me/someone"],
)
def test_a_handle_that_takes_the_conversation_elsewhere_is_found(text):
    assert KIND_HANDLE in find_payment_details(text)


# --- what must be left alone ------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        # Looks exactly like a card, fails the checksum.
        NOT_A_CARD,
        # Too short, too long.
        "603799123456789",
        "60379912345678931",
        # A card-length slice of a longer run of digits.
        "1" + VALID_CARD + "1",
        # A price, a year, a time.
        "۱۲۰۰۰۰ تومان",
        "سال ۱۴۰۵",
        "ساعت ۲۲:۳۰",
        # An email address has an "@" in it but is not a handle.
        "ایمیلم sara@example.com عه",
        # Ordinary conversation.
        "سلام، امشب وقت داری حرف بزنیم؟",
        "",
    ],
)
def test_nothing_is_found_in_what_only_resembles_a_detail(text):
    assert find_payment_details(text) == set()


def test_a_sheba_that_fails_its_checksum_is_left_alone():
    # One digit changed. IR and twenty-four digits is exactly the shape of
    # a Sheba, and this still must not be reported as one.
    assert KIND_SHEBA not in find_payment_details("IR062960000000100324200002")


def test_nothing_at_all_is_found_in_an_empty_message():
    assert find_payment_details(None) == set()
