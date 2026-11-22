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
    assert "reconcileProfilesOnFocus" in app_js
    assert "initLoginReconcileListeners" in app_js
    assert "/api/profiles/${encodeURIComponent(profileId)}/sync" in app_js


def test_single_profile_sync_merges_cache_and_invalidates_usage():
    from backend import app as app_mod
    from backend.models import Notebook

    client = TestClient(app)
    profile = AccountProfile(id="work", displayName="Work", email="work@gmail.com", status="expired")
    existing_other = Notebook(id="nb-other", title="Other NB", profileId="default", profileName="Default", profileEmail="default@gmail.com")
    fetched_work = [Notebook(id="nb-work-1", title="Work NB", profileId="work", profileName="Work", profileEmail="work@gmail.com")]

    app_mod._fleet_usage_cache["data"] = {"stale": True}
    app_mod._fleet_usage_cache["timestamp"] = 9999999999.0

    saved_cache = []

    async def fake_save_cache(nbs):
        saved_cache.clear()
        saved_cache.extend(nbs)

    with patch("backend.app.get_profile", new_callable=AsyncMock, return_value=profile), \
         patch("backend.app.fetch_notebooks_for_profile", new_callable=AsyncMock, return_value=fetched_work), \
         patch("backend.app.save_profile", new_callable=AsyncMock), \
         patch("backend.app.get_cached_notebooks", new_callable=AsyncMock, return_value=[existing_other]), \
         patch("backend.app.enrich_notebook_owners", new_callable=AsyncMock, side_effect=lambda m, c: m), \
         patch("backend.app.save_cached_notebooks", side_effect=fake_save_cache), \
         patch("backend.app.auto_share_study_notebooks", new_callable=AsyncMock):
        res = client.post("/api/profiles/work/sync")

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["notebook_count"] == 1
    assert {n.id for n in saved_cache} == {"nb-other", "nb-work-1"}
    assert app_mod._fleet_usage_cache["data"] is None
    assert app_mod._fleet_usage_cache["timestamp"] == 0.0


def test_reconcile_profiles_promotes_expired_and_discovers_new_cli_profile():
    client = TestClient(app)
    expired_p = AccountProfile(id="dev83", displayName="Dev83", email="", status="expired")
    saved_profiles = []

    async def fake_save_profile(p, old_id=None):
        saved_profiles.append(p.id)

    async def fake_check_auth(p, timeout=20):
        p.status = "connected"
        p.email = f"{p.id}@gmail.com"
        return {"profile_id": p.id, "status": "connected", "is_valid": True}

    with patch("backend.app.get_cli_profiles", new_callable=AsyncMock, return_value={"dev83": "dev83@gmail.com", "fresh": "fresh@gmail.com"}), \
         patch("backend.app.get_profiles", new_callable=AsyncMock, side_effect=[[expired_p], [expired_p, AccountProfile(id="fresh", displayName="fresh", email="fresh@gmail.com", status="connected")]]), \
         patch("backend.app.check_profile_auth_status", side_effect=fake_check_auth), \
         patch("backend.app.save_profile", side_effect=fake_save_profile), \
         patch("backend.app.sync_profile_notebooks", new_callable=AsyncMock, return_value=[]) as mock_sync:
        res = client.post("/api/profiles/reconcile")

    assert res.status_code == 200
    data = res.json()
    assert data["changed"] is True
    assert set(data["newly_connected"]) == {"dev83", "fresh"}
    assert mock_sync.await_count == 2


@pytest.mark.asyncio
async def test_watch_cli_login_invalidates_usage_and_syncs_notebooks():
    from backend import app as app_mod

    profile = AccountProfile(id="dev83", displayName="Dev83", email="", status="checking")
    mock_proc = MagicMock()
    mock_proc.wait.return_value = 0

    app_mod._fleet_usage_cache["data"] = {"stale": True}
    app_mod._fleet_usage_cache["timestamp"] = 9999999999.0

    async def fake_check_auth(p, timeout=20):
        p.status = "connected"
        p.email = "dev83@gmail.com"
        return {"is_valid": True}

    with patch("backend.app.get_profile", new_callable=AsyncMock, return_value=profile), \
         patch("backend.app.check_profile_auth_status", side_effect=fake_check_auth), \
         patch("backend.app.save_profile", new_callable=AsyncMock), \
         patch("backend.app.sync_profile_notebooks", new_callable=AsyncMock) as mock_sync:
        await app_mod._watch_cli_login("dev83", mock_proc)

    assert app_mod._fleet_usage_cache["data"] is None
    mock_sync.assert_awaited_once_with(profile, auto_share_study=True)
