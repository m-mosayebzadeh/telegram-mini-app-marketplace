"""
Signing in with Google (TECHNICAL_REQUIREMENTS.md section 32).

The page's own "continue with Google" button is a plain link: the browser
goes to Google, the person chooses an account there, and Google sends the
browser back to us with a signed token (an "ID token"). Going there and
back, rather than through Google's script and its button, is what lets
the button be ours: Google's brand rules allow any button that follows
them, and this works in the browsers inside other apps, where pop-ups
are blocked (the owner's decision, section 32).

The token is checked here with Google's published keys: that Google signed
it, that it was made for our Client ID, that it has not expired, and that it
answers the very request this browser started (the nonce). The address
is never asked for (the scope is only "openid profile"), so there is none
to check. Only then is the person signed in — through the same door every
time, Google's account id ("sub"), which never changes even if they
change their address.

What is kept: the account id, to recognise them next time, and their name,
only to pre-fill a new account. Not the email address: nothing in the
product needs it, and what is not kept cannot leak.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

from app.core.config import settings

#: Who may have issued a real token.
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
#: Where the browser is sent to choose an account.
AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"


def ready() -> bool:
    """Google sign-in is set up: both the Client ID and the way back."""
    return bool(settings.google_client_id and settings.google_redirect_uri)


def authorization_url(state: str, nonce: str, language: str | None = None) -> str:
    """Google's account chooser, for this one sign-in.

    Asks only for who the person is (openid, profile), never for mail or
    anything else. The token comes back in a form posted to the way back,
    so it never sits in an address bar or a history. `state` ties the
    answer to this browser; `nonce` is sealed inside the token by Google.
    """
    query = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "id_token",
        "response_mode": "form_post",
        "scope": "openid profile",
        "state": state,
        "nonce": nonce,
        # Somebody with two accounts chooses, rather than being signed in
        # with whichever Google last used.
        "prompt": "select_account",
    }
    if language:
        query["hl"] = language
    return f"{AUTHORIZE}?{urlencode(query)}"


class GoogleSignInError(Exception):
    """The token was not a valid Google sign-in for this app."""


@dataclass(frozen=True)
class GoogleAccount:
    #: Google's id for the account: the door, and it never changes.
    subject: str
    first_name: str
    last_name: str | None


def verify(credential: str, nonce: str) -> GoogleAccount:
    """Checks the token Google sent back. Raises GoogleSignInError when it is
    not a fresh, genuine sign-in to this app, started by this browser."""
    if not settings.google_client_id:
        raise GoogleSignInError("Google sign-in is not set up (GOOGLE_CLIENT_ID).")
    # Imported here so the rest of the app never pays for loading it.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), settings.google_client_id)
    except ValueError as error:  # bad signature, wrong audience, expired…
        raise GoogleSignInError(str(error)) from error
    if claims.get("nonce") != nonce:
        # A token from some other sign-in, replayed into this one.
        raise GoogleSignInError("Not the sign-in this browser started.")
    if claims.get("iss") not in ISSUERS:
        raise GoogleSignInError("Not issued by Google.")
    return GoogleAccount(
        subject=str(claims["sub"]),
        first_name=(claims.get("given_name") or claims.get("name") or "").strip()[:64] or "New User",
        last_name=(claims.get("family_name") or "").strip()[:64] or None,
    )
