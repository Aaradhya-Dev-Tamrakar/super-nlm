import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app import app
from backend.models import AccountProfile
from backend.nlm_client import check_profile_auth_status


@pytest.mark.asyncio
async def test_check_profile_auth_status_extracts_email():
    profile = AccountProfile(
        id="ishwori",
        displayName="Ishwori04",
        email="",
        tier="standard",
        status="checking",
    )
    mock_res = {
        "success": True,
        "stdout": (
            "Checking credentials for profile: ishwori...\n"
            "✓ Authentication valid!\n"
            "  Profile: ishwori\n"
            "  Notebooks found: 1\n"
            "  Account: ishwori.shrestha04@gmail.com\n"
        ),
        "stderr": "",
    }
    with patch("backend.nlm_client.run_nlm_cmd", new_callable=AsyncMock, return_value=mock_res):
        res = await check_profile_auth_status(profile)

    assert res["is_valid"] is True
    assert profile.status == "connected"
    assert profile.email == "ishwori.shrestha04@gmail.com"


def test_list_profiles_skips_cli_when_emails_present():
    client = TestClient(app)
    profiles = [
        AccountProfile(id="default", displayName="Primary", email="a@gmail.com", status="connected"),
        AccountProfile(id="ishwori", displayName="Ishwori04", email="b@gmail.com", status="connected"),
    ]
    with patch("backend.app.get_profiles", new_callable=AsyncMock, return_value=profiles), \
         patch("backend.app.get_cli_profiles", new_callable=AsyncMock) as mock_cli:
        res = client.get("/api/profiles")

    assert res.status_code == 200
    assert len(res.json()) == 2
    mock_cli.assert_not_awaited()


def test_create_profile_with_login_sets_checking_status():
    client = TestClient(app)
    mock_proc = MagicMock()
    mock_proc.wait.return_value = 0

    with patch("backend.app.get_profile", new_callable=AsyncMock, return_value=None), \
         patch("backend.app.save_profile", new_callable=AsyncMock), \
         patch("backend.app.launch_cli_login", return_value=mock_proc), \
         patch("backend.app._watch_cli_login", new_callable=AsyncMock):
        res = client.post(
            "/api/profiles?launch_login=true",
            json={"id": "newuser", "displayName": "New User", "tier": "standard"},
        )

    assert res.status_code == 200
    assert res.json()["status"] == "checking"


def test_frontend_parallel_load_and_auth_status_separation():
    app_js = (Path(__file__).resolve().parent.parent / "frontend" / "app.js").read_text(encoding="utf-8")
    assert "await Promise.all([loadProfiles(), loadNotebooks()])" in app_js
    assert "p.status === 'expired' || p.status === 'not_logged_in'" not in app_js
    assert "pollProfileAuthCompletion" in app_js
