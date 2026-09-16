import asyncio
import json
from pathlib import Path

import backend.scheduler as scheduler_module
from backend.models import ScheduledJob, SingleScheduleRequest
from backend.scheduler import JobScheduler


def _job(job_id: str, status: str = "queued") -> ScheduledJob:
    return ScheduledJob(
        id=job_id,
        notebook_id="nb-1",
        notebook_title="Notebook",
        status=status,
        created_at="2026-01-01T00:00:00+00:00",
    )


def test_corrupt_state_skips_bad_records_and_keeps_valid_jobs(tmp_path, monkeypatch):
    state = tmp_path / "scheduled.json"
    state.write_text(json.dumps([_job("valid").model_dump(), {"status": "not-a-job"}]))
    monkeypatch.setattr(scheduler_module, "SCHEDULED_JOBS_FILE", state)

    scheduler = JobScheduler()
    scheduler.load_jobs_from_disk()

    assert list(scheduler._jobs) == ["valid"]


def test_restart_requeues_in_progress_jobs(tmp_path, monkeypatch):
    state = tmp_path / "scheduled.json"
    state.write_text(json.dumps([_job("restart", "in_progress").model_dump()]))
    monkeypatch.setattr(scheduler_module, "SCHEDULED_JOBS_FILE", state)

    scheduler = JobScheduler()
    scheduler.load_jobs_from_disk()

    assert scheduler.get_job("restart").status == "queued"
    assert scheduler.get_job("restart").started_at is None


def test_concurrent_schedule_and_cancel_operations_are_serialized(tmp_path, monkeypatch):
    async def run():
        monkeypatch.setattr(scheduler_module, "SCHEDULED_JOBS_FILE", tmp_path / "jobs.json")
        scheduler = JobScheduler()
        request = SingleScheduleRequest(notebook_id="nb-1")
        jobs = await asyncio.gather(*[
            scheduler.schedule_job(request, f"Notebook {index}") for index in range(20)
        ])
        cancelled = await asyncio.gather(*[
            scheduler.cancel_job(job.id) for job in jobs[:10]
        ])
        assert all(cancelled)
        assert len(scheduler.get_jobs()) == 20
        assert sum(job.status == "cancelled" for job in scheduler.get_jobs()) == 10
    asyncio.run(run())


def test_interrupted_execution_requeues_job_and_releases_profile(monkeypatch):
    async def run():
        scheduler = JobScheduler()
        job = _job("interrupted")
        profile = type("Profile", (), {"id": "profile-1", "email": "profile@example.com"})()
        scheduler._active_workers[profile.id] = job.id
        entered = asyncio.Event()

        async def block(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(scheduler_module, "ensure_notebook_shared", block)
        task = asyncio.create_task(scheduler._execute_job(job, profile))
        await entered.wait()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        assert job.status == "queued"
        assert job.started_at is None
        assert job.retry_count == 1
        assert scheduler._active_workers[profile.id] is None
    asyncio.run(run())


def test_generated_artifact_with_failed_download_is_retryable(tmp_path, monkeypatch):
    async def run():
        scheduler = JobScheduler()
        job = _job("partial")
        profile = type("Profile", (), {"id": "profile-1", "email": ""})()
        original_sleep = asyncio.sleep
        monkeypatch.setattr(scheduler_module, "DOWNLOADS_DIR", tmp_path)
        monkeypatch.setattr(scheduler_module, "create_studio_artifact", lambda **kwargs: original_sleep(0, result={"success": True}))
        monkeypatch.setattr(scheduler_module, "get_studio_status", lambda *args: original_sleep(
            0, result=[{"id": "artifact-1", "type": "video", "status": "ready"}]
        ))
        monkeypatch.setattr(scheduler_module, "download_studio_artifact", lambda **kwargs: original_sleep(
            0, result={"success": True}
        ))
        monkeypatch.setattr(scheduler_module.asyncio, "sleep", lambda *_: original_sleep(0))

        await scheduler._execute_job(job, profile)

        assert job.status == "download_failed"
        assert job.artifact_id == "artifact-1"
        assert await scheduler.run_job_now(job.id) is False
        scheduler._jobs[job.id] = job
        assert await scheduler.run_job_now(job.id) is True
        assert job.status == "queued"
    asyncio.run(run())
