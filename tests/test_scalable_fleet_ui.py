import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.models import AccountProfile
from backend.nlm_client import _is_missing_profile_error, check_profile_auth_status
from tests.frontend_helpers import (
    check_all_frontend_js_syntax,
    read_frontend_js_sources,
)

ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = ROOT / "frontend" / "index.html"


@pytest.mark.parametrize(
    "msg,expected",
    [
        ("Profile not found: agy-user0", True),
        ("Error: User is not logged in", True),
        ("No credentials found; create a profile first", True),
        ("Credentials have expired", False),
    ],
)
def test_is_missing_profile_error_classification(msg, expected):
    assert _is_missing_profile_error(msg) is expected


@pytest.mark.asyncio
async def test_check_profile_auth_status_distinguishes_not_logged_in_vs_expired():
    pending = AccountProfile(id="agy-user0", displayName="Agy User 0", email="u0@gmail.com", status="checking")
    expired = AccountProfile(id="games", displayName="Games", email="g@gmail.com", status="connected")

    with patch(
        "backend.nlm_client.run_nlm_cmd",
        new_callable=AsyncMock,
        return_value={"success": False, "stdout": "", "stderr": "Profile not found: agy-user0"},
    ):
        res_pending = await check_profile_auth_status(pending)

    assert res_pending["status"] == "not_logged_in"
    assert pending.status == "not_logged_in"
    assert pending.lastError is None

    with patch(
        "backend.nlm_client.run_nlm_cmd",
        new_callable=AsyncMock,
        return_value={"success": False, "stdout": "", "stderr": "Credentials have expired"},
    ):
        res_expired = await check_profile_auth_status(expired)

    assert res_expired["status"] == "expired"
    assert expired.status == "expired"
    assert expired.lastError == "Credentials have expired"


def test_scalable_fleet_ui_controls_present_and_valid():
    app_src = read_frontend_js_sources()
    html_src = INDEX_HTML.read_text(encoding="utf-8")

    assert "Manage Expired" in app_src
    assert "showPendingAccountPills" in app_src
    assert "showPendingSidebarAccounts" in app_src
    assert "accountsModalFilter" in app_src
    assert "maxDots = 12" in app_src

    assert 'id="accounts-modal-search"' in html_src
    assert 'id="accounts-modal-filters"' in html_src
    assert 'id="sidebar-quota-dots" class="flex items-center flex-wrap' in html_src

    check_all_frontend_js_syntax()
