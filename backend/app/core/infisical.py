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
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

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


def cache_file(backend_dir: Path, environment: str) -> Path:
    """The last settings Infisical gave this machine, kept beside the code
    (outside git, like .env)."""
    return backend_dir / f".settings-cache.{environment}.json"


def _keep(backend_dir: Path, environment: str, values: dict[str, str]) -> None:
    """Saves what Infisical just gave, replacing the last copy whole — written
    beside it first, so a crash halfway never leaves half a file."""
    target = cache_file(backend_dir, environment)
    fresh = target.with_suffix(".tmp")
    fresh.write_text(json.dumps(values, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    try:
        os.chmod(fresh, 0o600)  # only this user may read it, where the system honours it
    except OSError:
        pass
    os.replace(fresh, target)


def _kept(backend_dir: Path, environment: str) -> dict[str, str] | None:
    try:
        return json.loads(cache_file(backend_dir, environment).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def load_into_environment(backend_dir: Path) -> int:
    """Fetches this machine's settings into the process's environment, if
    the machine has an identity, and keeps a copy of them. Returns how many
    were set.

    When Infisical cannot be had — down, unreachable, refusing the identity,
    or one day closed to us — the server still starts (the owner's decision,
    section 41: a server that is up and says so loudly beats one that is
    down): on the copy kept from the last time Infisical answered, or, with
    no copy yet, on whatever this machine has locally (.env, variables set
    by hand). Either way a warning says which. A copy is what keeps the
    settings from being lost if Infisical ever closes the door on us.

    Not saying which environment (COSMOS_ENV) still stops the start: that
    is not Infisical failing but the machine not knowing what it is."""
    if os.environ.get("COSMOS_SETTINGS") == "local":
        return 0
    client_id = os.environ.get("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID")
    client_secret = os.environ.get("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        return 0
    environment = os.environ.get("COSMOS_ENV", "")
    if environment not in ENVIRONMENTS:
        raise InfisicalError('Set COSMOS_ENV to "dev" or "prod": which settings this server should run on.')
    try:
        values = fetch(client_id, client_secret, _project_id(backend_dir), environment, os.environ.get("INFISICAL_DOMAIN", DEFAULT_DOMAIN))
    except InfisicalError as error:
        values = _kept(backend_dir, environment)
        if values is None:
            log.warning("SETTINGS: %s No copy kept yet: starting on this machine's local settings (.env).", error)
            return 0
        log.warning("SETTINGS: %s Starting on the copy kept from the last time Infisical answered.", error)
    else:
        try:
            _keep(backend_dir, environment, values)
        except OSError:
            log.warning("SETTINGS: read from Infisical, but the local copy could not be saved.")
    set_here = 0
    for name, value in values.items():
        if name not in os.environ:  # a value set by hand wins, for one run
            os.environ[name] = value
            set_here += 1
    return set_here
