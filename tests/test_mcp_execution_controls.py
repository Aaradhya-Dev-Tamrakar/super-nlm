"""MCP execution regressions using isolated storage and mocked Google calls."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.models import ScheduledJob
from backend.scheduler import JobScheduler
from mcp_server.server import create_server, scheduler_lifespan


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    import backend.scheduler as module
    scheduler = JobScheduler()
    monkeypatch.setattr(module, "scheduler", scheduler)
    monkeypatch.setattr(module, "SCHEDULED_JOBS_FILE", tmp_path / "jobs.json")
    scheduler._ensure_owner()
    return scheduler


def tool(name):
    return create_server()._tool_manager._tools[name].fn


@pytest.mark.asyncio
async def test_worker_start_dispatch_and_shutdown(isolated, monkeypatch):
    profiles = [SimpleNamespace(id="account")]
    monkeypatch.setattr("backend.scheduler.rotator.get_active_profiles", AsyncMock(return_value=profiles))
    monkeypatch.setattr("backend.scheduler.rotator._cooldowns", {})
    isolated._jobs["job"] = ScheduledJob(id="job", notebook_id="notebook", notebook_title="Test", created_at="2026-01-01")
    isolated.save_jobs_to_disk()
    started = asyncio.Event()

    async def execute(job, profile):
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(isolated, "_execute_job", execute)
    async with scheduler_lifespan(None):
        result = await tool("start_scheduler")()
        await started.wait()
        assert result["scheduler_running"]
        await asyncio.gather(isolated._process_queue_tick(), isolated._process_queue_tick())
        assert len(isolated._execution_tasks) == 1
        assert isolated._active_workers == {"account": "job"}
    assert not isolated.running
    assert not isolated._execution_tasks


@pytest.mark.asyncio
async def test_run_now_reuses_job(isolated, monkeypatch):
    monkeypatch.setattr("backend.scheduler.rotator.get_active_profiles", AsyncMock(return_value=[]))
    isolated._jobs["job"] = ScheduledJob(id="job", notebook_id="notebook", notebook_title="Test", created_at="2026-01-01", status="cancelled")
    isolated.save_jobs_to_disk()
    result = await tool("run_scheduled_job_now")("job")
    assert result["success"]
    assert result["job"]["status"] == "queued"
    assert len(isolated._jobs) == 1
    assert not (await tool("run_scheduled_job_now")("missing"))["success"]
    await tool("stop_scheduler")()


@pytest.mark.asyncio
async def test_direct_video_uses_existing_account(monkeypatch, isolated):
    monkeypatch.setattr("mcp_server.tools.get_cached_notebooks", AsyncMock(return_value=[SimpleNamespace(id="notebook", profileId="account")]))
    monkeypatch.setattr("mcp_server.tools.rotator.get_active_profiles", AsyncMock(return_value=[SimpleNamespace(id="account")]))
    create = AsyncMock(return_value={"success": True, "stdout": '{"artifact_id":"artifact"}'})
    monkeypatch.setattr("backend.nlm_client.create_studio_artifact", create)
    monkeypatch.setattr("backend.studio_service.source_scope", AsyncMock(return_value=["source"]))
    result = await tool("create_video_now")("notebook", custom_prompt="Explain SQL")
    assert result["success"]
    create.assert_awaited_once_with(profile_id="account", notebook_id="notebook", artifact_type="video", format_option="explainer", style="auto_select", custom_prompt="Explain SQL", source_ids=["source"])
    assert not isolated._jobs
    assert not (await tool("create_video_now")("missing"))["success"]
    with pytest.raises(ValueError):
        await tool("create_video_now")("notebook", format_option="unsupported")


@pytest.mark.asyncio
async def test_status_exposes_stopped_worker(isolated):
    result = await tool("get_scheduled_queue")()
    assert result["scheduler_running"] is False
