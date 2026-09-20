import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import backend.auth as auth


def make_request(host="203.0.113.10", headers=()):
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/profiles",
        "headers": [(key.lower().encode(), value.encode()) for key, value in headers],
        "client": (host, 1234),
        "scheme": "http",
        "query_string": b"",
        "server": ("testserver", 80),
    })


def test_loopback_bypass(monkeypatch):
    monkeypatch.setattr(auth, "SUPER_NLM_API_KEY", "secret")
    monkeypatch.setattr(auth, "SUPER_NLM_REQUIRE_AUTH_LOCAL", False)
    assert asyncio.run(auth.verify_api_access(make_request("127.0.0.1"))) is True


def test_remote_request_requires_configured_key(monkeypatch):
    monkeypatch.setattr(auth, "SUPER_NLM_API_KEY", "")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.verify_api_access(make_request()))
    assert exc.value.status_code == 401


@pytest.mark.parametrize("header", [("Authorization", "Bearer secret"), ("X-API-Key", "secret")])
def test_valid_remote_api_key(monkeypatch, header):
    monkeypatch.setattr(auth, "SUPER_NLM_API_KEY", "secret")
    assert asyncio.run(auth.verify_api_access(make_request(headers=[header]))) is True


def test_api_endpoints_remote_auth_enforcement(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app import app

    monkeypatch.setattr(auth, "SUPER_NLM_API_KEY", "secret")
    monkeypatch.setattr(auth, "SUPER_NLM_REQUIRE_AUTH_LOCAL", True)

    client = TestClient(app)

    # Remote/enforced unauthenticated call should be 401
    res_unauth = client.get("/api/profiles")
    assert res_unauth.status_code == 401

    # Call with valid Bearer token should succeed (200)
    res_auth = client.get("/api/profiles", headers={"Authorization": "Bearer secret"})
    assert res_auth.status_code == 200

    # Call with invalid token should be 401
    res_bad = client.get("/api/profiles", headers={"Authorization": "Bearer wrong"})
    assert res_bad.status_code == 401

