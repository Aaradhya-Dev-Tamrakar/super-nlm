import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app import app
from backend.models import AccountProfile, Notebook, NotebookSharingRule
from backend.storage import (
    deduplicate_profiles,
    deduplicate_stored_profiles,
    get_cached_notebooks,
    get_notebook_sharing_rule,
    get_profiles,
    normalize_email_key,
    save_cached_notebooks,
    save_notebook_sharing_rule,
    save_profile,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Aaradhya.Dev+nlm@gmail.com", "aaradhyadev@gmail.com"),
        ("  first.last@googlemail.com ", "firstlast@gmail.com"),
        ("user.name@custom-domain.edu", "user.name@custom-domain.edu"),
        ("", ""),
        ("invalid-email", ""),
    ],
)
def test_normalize_email_key(raw, expected):
    assert normalize_email_key(raw) == expected


def test_deduplicate_profiles_priority_and_enrichment():
    profiles = [
        AccountProfile(id="main", displayName="", email="Aaradhya.Dev@gmail.com", tier="standard", status="connected", notebookCount=5),
        AccountProfile(id="default", displayName="Primary", email="aaradhyadev@gmail.com", tier="pro", isDefaultPro=True, status="connected", notebookCount=10),
        AccountProfile(id="dtmr", displayName="DTMR", email="aaradhyadtmr@gmail.com", tier="standard", status="expired"),
        AccountProfile(id="tertiary", displayName="Tertiary", email="aaradhya.dtmr+2@googlemail.com", tier="standard", status="connected"),
        AccountProfile(id="blank1", displayName="Unlinked 1", email="", status="not_logged_in"),
        AccountProfile(id="blank2", displayName="Unlinked 2", email="", status="not_logged_in"),
    ]

    deduped, merged = deduplicate_profiles(profiles)
    ids = [p.id for p in deduped]
    assert ids == ["default", "tertiary", "blank1", "blank2"]
    assert len(merged) == 2
    assert {(m["removedId"], m["keptId"]) for m in merged} == {("main", "default"), ("dtmr", "tertiary")}


@pytest.mark.asyncio
async def test_deduplicate_stored_profiles_remaps_cache_and_rules_without_unshare():
    await save_profile(AccountProfile(id="default", displayName="Primary", email="u@gmail.com", tier="pro", isDefaultPro=True, status="connected"))
    await save_profile(AccountProfile(id="main", displayName="Dup", email="u+dup@googlemail.com", tier="standard", status="connected"))
    await save_cached_notebooks([
        Notebook(id="nb-1", title="Shared NB", profileId="default", profileName="Primary", profileEmail="u@gmail.com"),
        Notebook(id="nb-1", title="Shared NB", profileId="main", profileName="Dup", profileEmail="u+dup@googlemail.com"),
        Notebook(id="nb-2", title="Only On Main", profileId="main", profileName="Dup", profileEmail="u+dup@googlemail.com"),
    ])
    await save_notebook_sharing_rule(NotebookSharingRule(notebook_id="nb-2", exclude_profiles=["main", "other"]))

    with patch("backend.app.unshare_account_from_fleet", new_callable=AsyncMock) as mock_unshare:
        summary = await deduplicate_stored_profiles()

    mock_unshare.assert_not_awaited()
    assert summary["changed"] is True
    assert summary["removedCount"] == 1
    assert summary["totalAfter"] == 1
    profiles = await get_profiles()
    assert [p.id for p in profiles] == ["default"]

    cached = await get_cached_notebooks()
    assert [(n.id, n.profileId) for n in cached] == [("nb-1", "default"), ("nb-2", "default")]

    rule = await get_notebook_sharing_rule("nb-2")
    assert rule.exclude_profiles == ["other"]


def test_api_blocks_duplicate_gmail_on_create_and_update():
    client = TestClient(app)
    r1 = client.post("/api/profiles?launch_login=false", json={
        "id": "acct1",
        "displayName": "Account 1",
        "email": "test.user@gmail.com",
        "tier": "standard",
    })
    assert r1.status_code == 200

    r_dup = client.post("/api/profiles?launch_login=false", json={
        "id": "acct2",
        "displayName": "Account 2",
        "email": "testuser+alias@googlemail.com",
        "tier": "standard",
    })
    assert r_dup.status_code == 409

    r2 = client.post("/api/profiles?launch_login=false", json={
        "id": "acct2",
        "displayName": "Account 2",
        "email": "different@gmail.com",
        "tier": "standard",
    })
    assert r2.status_code == 200

    r_upd_dup = client.put("/api/profiles/acct2", json={"email": "test.user@gmail.com"})
    assert r_upd_dup.status_code == 409


def test_reconcile_skips_duplicate_cli_profile_by_gmail():
    client = TestClient(app)
    existing = AccountProfile(id="default", displayName="Primary", email="owner.name@gmail.com", tier="pro", isDefaultPro=True, status="connected")

    with patch("backend.app.get_cli_profiles", new_callable=AsyncMock, return_value={"default": "owner.name@gmail.com", "main": "ownername+1@googlemail.com"}), \
         patch("backend.app.get_profiles", new_callable=AsyncMock, return_value=[existing]), \
         patch("backend.app.save_profile", new_callable=AsyncMock) as mock_save, \
         patch("backend.app.deduplicate_stored_profiles", new_callable=AsyncMock, return_value={"changed": False, "removedCount": 0, "merged": []}), \
         patch("backend.app.sync_profile_notebooks", new_callable=AsyncMock) as mock_sync:
        res = client.post("/api/profiles/reconcile")

    assert res.status_code == 200
    data = res.json()
    assert data["newly_connected"] == []
    mock_save.assert_not_awaited()
    mock_sync.assert_not_awaited()
