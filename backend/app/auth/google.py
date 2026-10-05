"""
Signing in with Google (TECHNICAL_REQUIREMENTS.md section 32).

Google's own sign-in button runs in the browser and, once the person has
chosen their account, hands the page a signed token (an "ID token"). The
page passes it here, and this checks it with Google's published keys: that
Google signed it, that it was made for our Client ID, that it has not
expired, and that Google has confirmed the address. Only then is the person
signed in — through the same door every time, Google's account id ("sub"),
which never changes even if they change their address.

What is kept: the account id, to recognise them next time, and their name,
only to pre-fill a new account. Not the email address: nothing in the
product needs it, and what is not kept cannot leak.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings

#: Who may have issued a real token.
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleSignInError(Exception):
    """The token was not a valid Google sign-in for this app."""


@dataclass(frozen=True)
class GoogleAccount:
    #: Google's id for the account: the door, and it never changes.
    subject: str
    first_name: str
    last_name: str | None


def verify(credential: str) -> GoogleAccount:
    """Checks a token from Google's sign-in button. Raises GoogleSignInError
    when it is not a fresh, genuine sign-in to this app."""
    if not settings.google_client_id:
        raise GoogleSignInError("Google sign-in is not set up (GOOGLE_CLIENT_ID).")
    # Imported here so the rest of the app never pays for loading it.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), settings.google_client_id)
    except ValueError as error:  # bad signature, wrong audience, expired…
        raise GoogleSignInError(str(error)) from error
    if claims.get("iss") not in ISSUERS:
        raise GoogleSignInError("Not issued by Google.")
    if not claims.get("email_verified", False):
        raise GoogleSignInError("Google has not confirmed this account's address.")
    return GoogleAccount(
        subject=str(claims["sub"]),
        first_name=(claims.get("given_name") or claims.get("name") or "").strip()[:64] or "New User",
        last_name=(claims.get("family_name") or "").strip()[:64] or None,
    )
