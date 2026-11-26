import asyncio
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import storage
from backend.app import app
from backend.calendar_service import CalendarService
from backend.drive_sync_service import DriveSyncService
from backend.http_pool import close_http_clients, get_http_client
from backend.models import AccountProfile, FolderMapping, Notebook
from tests.frontend_helpers import (
    check_all_frontend_js_syntax,
    read_frontend_js_sources,
)

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.asyncio
async def test_storage_orjson_cache_hits_and_invalidates_on_write():
    storage.invalidate_storage_cache()
    profile = AccountProfile(id="p1", displayName="Primary", email="p1@gmail.com", tier="pro")
    await storage.save_profile(profile)

    first = await storage.get_profiles()
    p1 = next(p for p in first if p.id == "p1")
    assert p1.displayName == "Primary"

    # Mutating returned instance must not pollute cache
    p1.displayName = "Mutated In Caller"

    with patch("backend.storage.orjson.loads", side_effect=AssertionError("Expected cache hit without orjson.loads")):
        second = await storage.get_profiles()
    assert next(p for p in second if p.id == "p1").displayName == "Primary"

    # Writing invalidates cache so updated data is observed
    updated = AccountProfile(id="p1", displayName="Primary Updated", email="p1@gmail.com", tier="pro")
    await storage.save_profile(updated)
    third = await storage.get_profiles()
    assert next(p for p in third if p.id == "p1").displayName == "Primary Updated"


@pytest.mark.asyncio
async def test_drive_get_folder_status_runs_checks_concurrently():
    with tempfile.TemporaryDirectory() as tmpdir:
        folder = Path(tmpdir)
        (folder / "lecture_01.pdf").write_bytes(b"%PDF-1.4\n")
        (folder / "notes.md").write_text("# Notes", encoding="utf-8")

        nb = Notebook(id="nb-1", title="CT653 - AI", profileId="default", profileName="Default", profileEmail="u@gmail.com")
        await storage.save_cached_notebooks([nb])
        await storage.save_folder_mapping(FolderMapping(notebook_id="nb-1", folder_type="local_folder", target_path=str(folder), recursive=False))

        service = DriveSyncService()
        active_calls = 0
        max_concurrent = 0

        async def fake_sources(*_args, **_kwargs):
            nonlocal active_calls, max_concurrent
            active_calls += 1
            max_concurrent = max(max_concurrent, active_calls)
            await asyncio.sleep(0.05)
            active_calls -= 1
            return [{"id": "src-1", "title": "notes.md"}]

        async def fake_stale(*_args, **_kwargs):
            nonlocal active_calls, max_concurrent
            active_calls += 1
            max_concurrent = max(max_concurrent, active_calls)
            await asyncio.sleep(0.05)
            active_calls -= 1
            return []

        with (
            patch.object(service, "get_notebook_sources", side_effect=fake_sources),
            patch.object(service, "get_stale_drive_sources", side_effect=fake_stale),
        ):
            status = await service.get_folder_status("nb-1")

        assert max_concurrent == 2
        assert status.ingested_count == 1
        assert status.new_count == 1


@pytest.mark.asyncio
async def test_calendar_agenda_offloads_and_caches_parsed_ics():
    today_str = datetime.now(timezone.utc).strftime("%Y%m%dT100000Z")
    end_str = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y%m%dT110000Z")
    sample_ics = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//Super-NLM//Test//EN\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:evt-1\r\n"
        f"DTSTART:{today_str}\r\n"
        f"DTEND:{end_str}\r\n"
        "SUMMARY:CT653 Lecture\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )

    svc = CalendarService()
    parse_calls = 0
    import icalendar

    orig_from_ical = icalendar.Calendar.from_ical

    def wrapped_from_ical(data, *args, **kwargs):
        nonlocal parse_calls
        parse_calls += 1
        return orig_from_ical(data, *args, **kwargs)

    notebooks = [Notebook(id="nb-ai", title="CT653 - Artificial Intelligence", profileId="main", profileName="Main", profileEmail="u@gmail.com")]

    with (
        patch.object(svc, "is_configured", return_value=True),
        patch.object(svc, "fetch_raw_ics", new_callable=AsyncMock, return_value=sample_ics),
        patch("backend.calendar_service.icalendar.Calendar.from_ical", side_effect=wrapped_from_ical),
    ):
        res1 = await svc.get_agenda(notebooks=notebooks, days=7)
        res2 = await svc.get_agenda(notebooks=notebooks, days=7)

    assert parse_calls == 1
    assert res1.configured is True
    assert res1.today_count + res1.upcoming_count >= 1
    assert res2.today_count == res1.today_count


def test_http_pool_loop_isolation_and_shutdown():
    async def acquire_and_close() -> tuple[int, bool]:
        client1 = await get_http_client()
        client2 = await get_http_client()
        assert client1 is client2
        await close_http_clients()
        return id(client1), client1.is_closed

    id1, closed1 = asyncio.run(acquire_and_close())
    id2, closed2 = asyncio.run(acquire_and_close())
    assert closed1 is True
    assert closed2 is True
    assert id1 != id2


def test_app_uses_orjson_response_and_gzip_middleware():
    assert app.router.default_response_class is ORJSONResponse
    assert any(mw.cls is GZipMiddleware for mw in app.user_middleware)


def test_frontend_gpu_css_and_perf_js_patterns():
    css = (ROOT / "frontend" / "style.css").read_text(encoding="utf-8")
    assert "content-visibility: auto;" in css
    assert "contain-intrinsic-size: auto 180px;" in css
    assert "will-change: transform" in css
    assert "@media (prefers-reduced-motion: reduce)" in css
    assert "transition: all" not in css

    js = read_frontend_js_sources()
    assert "function scheduleNotebooksGridRender(" in js
    assert "requestAnimationFrame(" in js
    assert "function refreshIcons(" in js
    assert "searchDebounceTimer" in js

    check_all_frontend_js_syntax()
