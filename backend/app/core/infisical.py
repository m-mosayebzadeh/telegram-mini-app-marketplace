"""
Reading the server's settings from Infisical at start (TECHNICAL_REQUIREMENTS.md
section 41).

Every setting lives in Infisical (the owner's decision), and the server
fetches them itself when it starts, before anything reads them: the plain
start command is enough, on a development machine and on the main server
alike. What the machine holds is only who it is and which settings it wants:

- INFISICAL_UNIVERSAL_AUTH_CLIENT_ID / INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET:
  this machine's identity in Infisical (Windows user variables on the
  development machines, the service's environment on the main server);
- COSMOS_ENV: which environment to read, "dev" or "prod". Required, with no
  default on purpose: a server that forgot to say would otherwise quietly
  run on the other environment's settings.

The fetched values become environment variables of this process only —
never a file — and app/core/config.py reads them as it always reads its
settings. A variable already set by hand is left alone, so one value can be
overridden for a single run.

Kept to this one module, called once from config.py, so Infisical stays
behind a narrow boundary: moving to another secrets service, or to Infisical
on our own server, changes this file and nothing else. It talks to
Infisical's HTTP API directly (two requests) rather than through its Python
package, one dependency fewer.

Without an identity it does nothing: the tests, tools, and anybody running
the code with their own environment variables need no Infisical at all.
The tests switch it off explicitly (COSMOS_SETTINGS=local in conftest.py),
since the development machines do have an identity.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

#: Our Infisical lives in its EU region; INFISICAL_DOMAIN overrides it (a
#: self-hosted Infisical one day).
DEFAULT_DOMAIN = "https://eu.infisical.com"
#: The environments a server may ask for.
ENVIRONMENTS = {"dev", "prod"}
#: How long to wait for Infisical before giving up on starting.
TIMEOUT_SECONDS = 15


class InfisicalError(RuntimeError):
    """The server cannot start: its settings could not be fetched."""


def _project_id(backend_dir: Path) -> str:
    """The project, from INFISICAL_PROJECT_ID or the .infisical.json kept in
    git next to the code (an id, not a secret)."""
    if os.environ.get("INFISICAL_PROJECT_ID"):
        return os.environ["INFISICAL_PROJECT_ID"]
    try:
        return json.loads((backend_dir / ".infisical.json").read_text(encoding="utf-8"))["workspaceId"]
    except (OSError, KeyError, ValueError) as error:
        raise InfisicalError("No Infisical project: set INFISICAL_PROJECT_ID or keep backend/.infisical.json.") from error


def fetch(client_id: str, client_secret: str, project_id: str, environment: str, domain: str = DEFAULT_DOMAIN) -> dict[str, str]:
    """Every setting of `environment`, by name. Two requests: a short-lived
    token for this machine's identity, then the settings with it."""
    import requests  # only a starting server pays for it

    base = domain.rstrip("/")
    try:
        login = requests.post(
            f"{base}/api/v1/auth/universal-auth/login",
            json={"clientId": client_id, "clientSecret": client_secret},
            timeout=TIMEOUT_SECONDS,
        )
        if login.status_code != 200:
            raise InfisicalError(f"Infisical refused this machine's identity ({login.status_code}).")
        token = login.json()["accessToken"]
        answer = requests.get(
            f"{base}/api/v3/secrets/raw",
            params={"workspaceId": project_id, "environment": environment, "secretPath": "/"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT_SECONDS,
        )
        if answer.status_code != 200:
            raise InfisicalError(f"Infisical would not give the {environment!r} settings ({answer.status_code}).")
        return {s["secretKey"]: s["secretValue"] for s in answer.json()["secrets"]}
    except requests.RequestException as error:
        raise InfisicalError(f"Infisical could not be reached: {type(error).__name__}.") from error


def load_into_environment(backend_dir: Path) -> int:
    """Fetches this machine's settings into the process's environment, if
    the machine has an identity. Returns how many were set. Raises
    InfisicalError when it has one but the settings cannot be had: better
    not to start than to start on the wrong settings."""
    if os.environ.get("COSMOS_SETTINGS") == "local":
        return 0
    client_id = os.environ.get("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID")
    client_secret = os.environ.get("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        return 0
    environment = os.environ.get("COSMOS_ENV", "")
    if environment not in ENVIRONMENTS:
        raise InfisicalError('Set COSMOS_ENV to "dev" or "prod": which settings this server should run on.')
    values = fetch(client_id, client_secret, _project_id(backend_dir), environment, os.environ.get("INFISICAL_DOMAIN", DEFAULT_DOMAIN))
    set_here = 0
    for name, value in values.items():
        if name not in os.environ:  # a value set by hand wins, for one run
            os.environ[name] = value
            set_here += 1
    return set_here
