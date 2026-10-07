"""
The server reads its settings from Infisical as it starts
(TECHNICAL_REQUIREMENTS.md section 41). Infisical itself is faked here: these
tests are about what the server asks for and what it does with the answer.
"""

import json

import pytest

from app.core import infisical

IDENTITY = {"INFISICAL_UNIVERSAL_AUTH_CLIENT_ID": "id", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET": "secret"}


@pytest.fixture
def machine(monkeypatch, tmp_path):
    """A machine with an identity, outside the tests' own switch-off, with
    the project file next to the code and nothing else set."""
    monkeypatch.delenv("COSMOS_SETTINGS", raising=False)
    for name in ("COSMOS_ENV", "INFISICAL_PROJECT_ID", "INFISICAL_DOMAIN", "SOME_SETTING", "ALREADY_SET"):
        monkeypatch.delenv(name, raising=False)
    for name, value in IDENTITY.items():
        monkeypatch.setenv(name, value)
    (tmp_path / ".infisical.json").write_text(json.dumps({"workspaceId": "project-1"}), encoding="utf-8")
    return tmp_path


@pytest.fixture
def infisical_answers(monkeypatch):
    """Infisical, faked: remembers what it was asked."""
    import requests

    asked = []

    class Answer:
        def __init__(self, status, body):
            self.status_code, self._body = status, body

        def json(self):
            return self._body

    def post(url, json=None, timeout=None):
        asked.append(("login", url, json))
        ok = json == {"clientId": "id", "clientSecret": "secret"}
        return Answer(200 if ok else 401, {"accessToken": "token-1"})

    def get(url, params=None, headers=None, timeout=None):
        asked.append(("secrets", url, params, headers))
        return Answer(200, {"secrets": [
            {"secretKey": "SOME_SETTING", "secretValue": f"from-{params['environment']}"},
            {"secretKey": "ALREADY_SET", "secretValue": "from-infisical"},
        ]})

    monkeypatch.setattr(requests, "post", post)
    monkeypatch.setattr(requests, "get", get)
    return asked


def test_it_reads_the_environment_it_is_told(machine, infisical_answers, monkeypatch):
    import os

    monkeypatch.setenv("COSMOS_ENV", "dev")
    assert infisical.load_into_environment(machine) == 2
    assert os.environ["SOME_SETTING"] == "from-dev"
    login, secrets = infisical_answers
    assert login[1] == "https://eu.infisical.com/api/v1/auth/universal-auth/login"
    assert secrets[2] == {"workspaceId": "project-1", "environment": "dev", "secretPath": "/"}
    assert secrets[3] == {"Authorization": "Bearer token-1"}


def test_production_reads_production(machine, infisical_answers, monkeypatch):
    import os

    monkeypatch.setenv("COSMOS_ENV", "prod")
    infisical.load_into_environment(machine)
    assert os.environ["SOME_SETTING"] == "from-prod"


def test_a_value_set_by_hand_wins_for_that_run(machine, infisical_answers, monkeypatch):
    import os

    monkeypatch.setenv("COSMOS_ENV", "dev")
    monkeypatch.setenv("ALREADY_SET", "by-hand")
    assert infisical.load_into_environment(machine) == 1
    assert os.environ["ALREADY_SET"] == "by-hand"


def test_without_saying_which_environment_it_will_not_start(machine, infisical_answers):
    """No default on purpose: a server that forgot would run on the other
    environment's settings."""
    with pytest.raises(infisical.InfisicalError, match="COSMOS_ENV"):
        infisical.load_into_environment(machine)
    assert infisical_answers == []


def test_a_refused_identity_stops_the_start(machine, infisical_answers, monkeypatch):
    monkeypatch.setenv("COSMOS_ENV", "dev")
    monkeypatch.setenv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "wrong")
    with pytest.raises(infisical.InfisicalError, match="refused"):
        infisical.load_into_environment(machine)


def test_without_an_identity_it_does_nothing(machine, infisical_answers, monkeypatch):
    for name in IDENTITY:
        monkeypatch.delenv(name)
    assert infisical.load_into_environment(machine) == 0
    assert infisical_answers == []


def test_the_tests_never_use_the_real_settings(machine, infisical_answers, monkeypatch):
    monkeypatch.setenv("COSMOS_SETTINGS", "local")
    monkeypatch.setenv("COSMOS_ENV", "dev")
    assert infisical.load_into_environment(machine) == 0
    assert infisical_answers == []
