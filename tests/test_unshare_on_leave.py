import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app import app
from backend.models import AccountProfile, Notebook, NotebookSharingRule
from backend.nlm_client import (
    remove_notebook_collaborator,
    unshare_account_from_fleet,
)


@pytest.mark.asyncio
async def test_unshare_account_from_fleet_revokes_collaborator_and_skips_owned():
    profiles = [
        AccountProfile(id="default", displayName="Primary", email="owner@gmail.com", tier="pro", isDefaultPro=True, status="connected"),
        AccountProfile(id="leaving", displayName="Leaving", email="leaving@gmail.com", tier="standard", status="connected"),
    ]
    notebooks = [
        Notebook(id="nb-shared", title="Shared Course", profileId="default", profileName="Primary", profileEmail="owner@gmail.com", ownerEmail="owner@gmail.com"),
        Notebook(id="nb-shared", title="Shared Course", profileId="leaving", profileName="Leaving", profileEmail="leaving@gmail.com", ownerEmail="owner@gmail.com"),
        Notebook(id="nb-owned", title="Owned By Leaving", profileId="leaving", profileName="Leaving", profileEmail="leaving@gmail.com", ownerEmail="leaving@gmail.com"),
        Notebook(id="nb-not-shared", title="Already Unshared", profileId="default", profileName="Primary", profileEmail="owner@gmail.com", sharedWith=[{"email": "leaving@gmail.com", "role": "editor"}]),
        Notebook(id="nb-fail", title="Failing Status", profileId="leaving", profileName="Leaving", profileEmail="leaving@gmail.com", ownerEmail="owner@gmail.com"),
    ]

    async def fake_run_nlm(args, timeout=25):
        nb_id = args[2]
        if nb_id == "nb-shared":
            return {
                "success": True,
                "stdout": json.dumps({"collaborators": [
                    {"email": "owner@gmail.com", "role": "owner"},
                    {"email": "leaving@gmail.com", "role": "editor"},
                ]}),
                "stderr": "",
            }
        if nb_id == "nb-not-shared":
            return {
                "success": True,
                "stdout": json.dumps({"collaborators": [{"email": "owner@gmail.com", "role": "owner"}]}),
                "stderr": "",
            }
        if nb_id == "nb-fail":
            return {"success": False, "stdout": "", "stderr": "Auth expired"}
        return {"success": True, "stdout": "{}", "stderr": ""}

    with patch("backend.storage.get_profiles", new_callable=AsyncMock, return_value=profiles), \
         patch("backend.storage.get_cached_notebooks", new_callable=AsyncMock, return_value=notebooks), \
         patch("backend.nlm_client.run_nlm_cmd", side_effect=fake_run_nlm), \
         patch("backend.nlm_client.remove_notebook_collaborator", new_callable=AsyncMock, return_value={"success": True}) as mock_remove:
        summary = await unshare_account_from_fleet("leaving", "leaving@gmail.com")

    assert summary["unshared"] == 1
    assert summary["skippedOwner"] == 1
    assert summary["skippedNotShared"] == 1
    assert summary["failed"] == 1
    assert summary["success"] is False
    mock_remove.assert_awaited_once_with("nb-shared", "default", "leaving@gmail.com")


@pytest.mark.asyncio
async def test_remove_notebook_collaborator_uses_argv_and_handles_missing_runtime():
    with patch("backend.nlm_client._resolve_nlm_python", return_value=None):
        res_missing = await remove_notebook_collaborator("nb-1", "default", "user@gmail.com")
    assert res_missing["success"] is False
    assert "not found" in res_missing["error"]

    captured = {}

    async def fake_exec(cmd, timeout=25, env=None):
        captured["cmd"] = cmd
        captured["env"] = env
        return {"success": True, "returncode": 0, "stdout": "", "stderr": ""}

    with patch("backend.nlm_client._resolve_nlm_python", return_value="C:/fake/python.exe"), \
         patch("backend.nlm_client._exec_subprocess", side_effect=fake_exec), \
         patch.dict("os.environ", {"NOTEBOOKLM_COOKIES": "stale"}):
        res_ok = await remove_notebook_collaborator("nb-1", "default", "user@gmail.com")

    assert res_ok == {"success": True}
    assert captured["cmd"][0] == "C:/fake/python.exe"
    assert captured["cmd"][1] == "-c"
    assert captured["cmd"][3:] == ["default", "nb-1", "user@gmail.com"]
    assert captured["env"]["NLM_PROFILE"] == "default"
    assert "NOTEBOOKLM_COOKIES" not in captured["env"]


def test_delete_profile_auto_unshares_and_cleans_cache_and_rules():
    client = TestClient(app)
    leaving_profile = AccountProfile(
        id="leaving", displayName="Leaving", email="leaving@gmail.com", tier="standard", status="connected"
    )
    remaining_nb = Notebook(
        id="nb-1",
        title="Course 1",
        profileId="default",
        profileName="Primary",
        profileEmail="owner@gmail.com",
        sharedWith=[
            {"email": "leaving@gmail.com", "role": "editor"},
            {"email": "other@gmail.com", "role": "viewer"},
        ],
    )
    leaving_nb = Notebook(
        id="nb-1",
        title="Course 1",
        profileId="leaving",
        profileName="Leaving",
        profileEmail="leaving@gmail.com",
    )
    saved_notebooks = []

    async def fake_save_notebooks(nbs):
        saved_notebooks.clear()
        saved_notebooks.extend(nbs)

    unshare_summary = {
        "success": True,
        "profileId": "leaving",
        "targetEmail": "leaving@gmail.com",
        "unshared": 1,
        "skippedOwner": 0,
        "skippedNotShared": 0,
        "failed": 0,
        "results": [{"notebookId": "nb-1", "status": "unshared"}],
    }

    with patch("backend.app.get_profile", new_callable=AsyncMock, return_value=leaving_profile), \
         patch("backend.app.unshare_account_from_fleet", new_callable=AsyncMock, return_value=unshare_summary) as mock_unshare, \
         patch("backend.app.delete_profile", new_callable=AsyncMock, return_value=True), \
         patch("backend.app.delete_cli_profile", new_callable=AsyncMock, return_value=True), \
         patch("backend.app.remove_profile_from_sharing_rules", new_callable=AsyncMock, return_value=1) as mock_rules, \
         patch("backend.app.get_cached_notebooks", new_callable=AsyncMock, return_value=[remaining_nb, leaving_nb]), \
         patch("backend.app.save_cached_notebooks", side_effect=fake_save_notebooks):
        res = client.delete("/api/profiles/leaving")

    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["unshareSummary"]["unshared"] == 1
    mock_unshare.assert_awaited_once_with("leaving", "leaving@gmail.com")
    mock_rules.assert_awaited_once_with("leaving")
    assert len(saved_notebooks) == 1
    assert saved_notebooks[0].profileId == "default"
    assert saved_notebooks[0].sharedWith == [{"email": "other@gmail.com", "role": "viewer"}]


def test_delete_profile_can_skip_unshare():
    client = TestClient(app)
    leaving_profile = AccountProfile(
        id="leaving", displayName="Leaving", email="leaving@gmail.com", tier="standard", status="connected"
    )
    with patch("backend.app.get_profile", new_callable=AsyncMock, return_value=leaving_profile), \
         patch("backend.app.unshare_account_from_fleet", new_callable=AsyncMock) as mock_unshare, \
         patch("backend.app.delete_profile", new_callable=AsyncMock, return_value=True), \
         patch("backend.app.delete_cli_profile", new_callable=AsyncMock, return_value=True), \
         patch("backend.app.remove_profile_from_sharing_rules", new_callable=AsyncMock, return_value=0), \
         patch("backend.app.get_cached_notebooks", new_callable=AsyncMock, return_value=[]), \
         patch("backend.app.save_cached_notebooks", new_callable=AsyncMock):
        res = client.delete("/api/profiles/leaving?unshare=false")

    assert res.status_code == 200
    assert res.json()["unshareSummary"]["unshared"] == 0
    mock_unshare.assert_not_awaited()


@pytest.mark.asyncio
async def test_remove_profile_from_sharing_rules_prunes_empty_entries():
    from backend.storage import remove_profile_from_sharing_rules

    rules = {
        "nb-1": NotebookSharingRule(notebook_id="nb-1", exclude_all=False, exclude_profiles=["leaving"]),
        "nb-2": NotebookSharingRule(notebook_id="nb-2", exclude_all=True, exclude_profiles=["leaving", "keep"]),
    }
    saved = {}

    def fake_save(new_rules):
        saved.clear()
        saved.update(new_rules)

    with patch("backend.storage._load_sharing_rules_sync", return_value=rules), \
         patch("backend.storage._save_sharing_rules_sync", side_effect=fake_save):
        updated = await remove_profile_from_sharing_rules("leaving")

    assert updated == 2
    assert "nb-1" not in saved
    assert saved["nb-2"].exclude_profiles == ["keep"]
