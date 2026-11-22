import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app import app
from backend.models import AccountProfile, Notebook, NotebookSharingRule
from backend.nlm_client import (
    auto_share_study_notebooks,
    batch_share_notebooks_to_accounts,
)


@pytest.mark.asyncio
async def test_auto_share_skips_opt_out_profiles_and_excluded_notebooks():
    profiles = [
        AccountProfile(id="default", displayName="Primary", email="a@gmail.com", tier="pro", isDefaultPro=True, receiveAutoShare=True, status="connected"),
        AccountProfile(id="secondary", displayName="Secondary", email="b@gmail.com", tier="pro", receiveAutoShare=True, status="connected"),
        AccountProfile(id="ishwori", displayName="Ishwori04", email="ish@gmail.com", tier="standard", receiveAutoShare=False, status="connected"),
    ]
    notebooks = [
        Notebook(id="nb-study-1", title="EX751 - Wireless Communications", profileId="default", profileName="Primary", profileEmail="a@gmail.com", is_study=True, category="study"),
        Notebook(id="nb-study-excluded", title="CT704 - Digital Signal Analysis", profileId="default", profileName="Primary", profileEmail="a@gmail.com", is_study=True, category="study"),
    ]
    rules = {
        "nb-study-excluded": NotebookSharingRule(notebook_id="nb-study-excluded", exclude_all=True),
    }

    invited_calls = []

    async def fake_run_nlm(args, timeout=25):
        if args[:2] == ["share", "status"]:
            return {"success": True, "stdout": '{"collaborators": [{"email": "a@gmail.com", "role": "owner"}]}', "stderr": ""}
        if args[:2] == ["share", "invite"]:
            invited_calls.append((args[2], args[3]))
            return {"success": True, "stdout": "ok", "stderr": ""}
        return {"success": True, "stdout": "{}", "stderr": ""}

    with patch("backend.storage.get_profiles", new_callable=AsyncMock, return_value=profiles), \
         patch("backend.storage.get_cached_notebooks", new_callable=AsyncMock, return_value=notebooks), \
         patch("backend.storage.get_sharing_rules", new_callable=AsyncMock, return_value=rules), \
         patch("backend.storage.save_cached_notebooks", new_callable=AsyncMock), \
         patch("backend.nlm_client.run_nlm_cmd", side_effect=fake_run_nlm):
        res = await auto_share_study_notebooks(notebooks=notebooks)

    assert res["shared"] == 1
    assert invited_calls == [("nb-study-1", "b@gmail.com")]


@pytest.mark.asyncio
async def test_manual_share_still_allows_opt_out_profile():
    profiles = [
        AccountProfile(id="default", displayName="Primary", email="a@gmail.com", tier="pro", isDefaultPro=True, receiveAutoShare=True, status="connected"),
        AccountProfile(id="ishwori", displayName="Ishwori04", email="ish@gmail.com", tier="standard", receiveAutoShare=False, status="connected"),
    ]
    notebooks = [
        Notebook(id="nb-other", title="Shared Research Notes", profileId="default", profileName="Primary", profileEmail="a@gmail.com", is_study=False, category="personal"),
    ]
    invited_calls = []

    async def fake_run_nlm(args, timeout=25):
        if args[:2] == ["share", "status"]:
            return {"success": True, "stdout": '{"collaborators": [{"email": "a@gmail.com", "role": "owner"}]}', "stderr": ""}
        if args[:2] == ["share", "invite"]:
            invited_calls.append((args[2], args[3]))
            return {"success": True, "stdout": "ok", "stderr": ""}
        return {"success": True, "stdout": "{}", "stderr": ""}

    with patch("backend.storage.get_profiles", new_callable=AsyncMock, return_value=profiles), \
         patch("backend.storage.get_cached_notebooks", new_callable=AsyncMock, return_value=notebooks), \
         patch("backend.storage.save_cached_notebooks", new_callable=AsyncMock), \
         patch("backend.nlm_client.run_nlm_cmd", side_effect=fake_run_nlm):
        res = await batch_share_notebooks_to_accounts(notebook_ids=["nb-other"], target_profile_ids=["ishwori"])

    assert res["shared"] == 1
    assert invited_calls == [("nb-other", "ish@gmail.com")]


def test_sharing_rules_endpoints():
    client = TestClient(app)
    rule = NotebookSharingRule(notebook_id="nb-123", exclude_all=True, exclude_profiles=["ishwori"])
    with patch("backend.app.save_notebook_sharing_rule", new_callable=AsyncMock) as mock_save, \
         patch("backend.app.get_notebook_sharing_rule", new_callable=AsyncMock, return_value=rule):
        put_res = client.put("/api/notebooks/nb-123/sharing-rules", json=rule.model_dump())
        get_res = client.get("/api/notebooks/nb-123/sharing-rules")

    assert put_res.status_code == 200
    assert put_res.json()["exclude_all"] is True
    assert get_res.status_code == 200
    assert get_res.json()["exclude_profiles"] == ["ishwori"]
    mock_save.assert_awaited_once()
