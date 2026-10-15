import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.batch_downloads import BatchDownloadRequest, BatchDownloads, destination
from backend.models import BatchScheduleRequest, ScheduledJob
from backend.nlm_client import run_nlm_cmd as execute_nlm_command
from backend.process_lease import ProcessLease
from backend.scheduler import JobScheduler
from backend.studio_service import (
    StudioCommandError,
    diagnostic,
    normalize_notebook,
    source_scope,
)

NB = "11111111-1111-4111-8111-111111111111"
AID = "22222222-2222-4222-8222-222222222222"
OLD = "33333333-3333-4333-8333-333333333333"


def test_links_and_paths(tmp_path):
    assert normalize_notebook(f"https://notebooklm.google.com/notebook/{NB}?x=1") == NB
    with pytest.raises(ValueError):
        normalize_notebook(f"https://attacker.invalid/notebook/{NB}")
    with pytest.raises(ValueError):
        destination("relative")
    from backend.config import BASE_DIR

    with pytest.raises(ValueError):
        destination(str(BASE_DIR / "downloads"))
    assert destination(str(tmp_path)) == tmp_path.resolve()


def test_cross_process_lease(tmp_path):
    first = ProcessLease(tmp_path / "lock")
    second = ProcessLease(tmp_path / "lock")
    assert first.acquire()
    assert not second.acquire()
    first.release()
    assert second.acquire()
    second.release()


@pytest.mark.asyncio
async def test_sources_validate_exclusions_and_empty_scope(monkeypatch):
    monkeypatch.setattr(
        "backend.studio_service.sources",
        AsyncMock(
            return_value=[
                {"id": "a", "title": "seed.sql"},
                {"id": "b", "title": "Guide.pdf"},
            ]
        ),
    )
    assert await source_scope(NB, "account", exclude_sources=["SEED.SQL"]) == ["b"]
    with pytest.raises(ValueError, match="do not belong"):
        await source_scope(NB, "account", ["unknown"])
    with pytest.raises(ValueError, match="empty"):
        await source_scope(NB, "account", [])


def test_diagnostics_preserve_provider_and_streams():
    details = diagnostic(
        {
            "returncode": 1,
            "stdout": '{"error":"API error (code 7): PERMISSION_DENIED"}',
            "stderr": "",
            "success": False,
        },
        "creation",
        NB,
        "account",
    )
    assert details["provider_code"] == 7
    assert details["returncode"] == 1
    assert details["upstream"]["error"].endswith("PERMISSION_DENIED")


@pytest.mark.asyncio
async def test_cli_creation_and_download_flags(monkeypatch, tmp_path):
    from backend.nlm_client import create_studio_artifact, download_studio_artifact

    command = AsyncMock(return_value={"success": True, "stdout": "{}"})
    monkeypatch.setattr("backend.nlm_client.run_nlm_cmd", command)
    await create_studio_artifact(
        "account",
        NB,
        "quiz",
        custom_prompt="Focus",
        difficulty="hard",
        source_ids=["source"],
    )
    args = command.call_args.args[0]
    assert args[args.index("--difficulty") + 1] == "5"
    assert args[args.index("--source-ids") + 1] == "source"
    assert args[args.index("--focus") + 1] == "Focus"
    await download_studio_artifact(
        "account", NB, "quiz", AID, str(tmp_path / "quiz.md")
    )
    args = command.call_args.args[0]
    assert args[:2] == ["download", "quiz"]
    assert "--profile" not in args
    assert command.call_args.kwargs["profile_id"] == "account"
    assert "--no-progress" not in args
    assert args[args.index("--format") + 1] == "markdown"


@pytest.mark.asyncio
async def test_cancellation_records_accepted_submission_for_restart(monkeypatch):
    import asyncio

    scheduler = JobScheduler()
    scheduler._ensure_owner()
    job = ScheduledJob(
        id="accepted", notebook_id=NB, notebook_title="SQL", created_at="2026-01-01"
    )
    scheduler._jobs[job.id] = job
    entered = asyncio.Event()
    finish = asyncio.Event()
    monkeypatch.setattr(
        "backend.scheduler.get_cached_notebooks", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(
        "backend.scheduler.source_scope", AsyncMock(return_value=["source"])
    )

    async def submit(**kwargs):
        entered.set()
        await finish.wait()
        return {"success": True, "stdout": json.dumps({"artifact_id": AID})}

    monkeypatch.setattr("backend.scheduler.create_studio_artifact", submit)
    task = asyncio.create_task(
        scheduler._execute_job(
            job, SimpleNamespace(id="account", email="unit@example.invalid")
        )
    )
    await entered.wait()
    task.cancel()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert job.status == "in_progress"
    assert job.artifact_id == AID
    await scheduler.stop()
    restored = JobScheduler()
    restored.load_jobs_from_disk()
    assert restored.get_job(job.id).artifact_id == AID
    assert restored.get_job(job.id).status == "in_progress"


@pytest.mark.asyncio
async def test_mcp_forwards_when_hub_owns_queue(monkeypatch):
    from mcp_server.server import create_server

    monkeypatch.setattr("backend.queue_bridge.claim_scheduler", lambda scheduler: False)
    forward = AsyncMock(return_value={"success": True, "job": {"id": "job"}})
    monkeypatch.setattr("backend.queue_bridge.forward_queue", forward)
    tool = create_server()._tool_manager._tools["run_scheduled_job_now"].fn
    assert (await tool("job"))["success"]
    forward.assert_awaited_once_with("run-now", {"job_id": "job"})


@pytest.mark.asyncio
async def test_generation_batch_idempotency_and_prompts(monkeypatch):
    monkeypatch.setattr("backend.scheduler.get_profiles", AsyncMock(return_value=[]))
    scheduler = JobScheduler()
    request = BatchScheduleRequest(
        notebook_ids=[NB, NB],
        prompts=["One {notebook_title}", "Two"],
        exclude_sources=["seed.sql"],
        request_key="request",
    )
    first = await scheduler.schedule_batch(request, {NB: "SQL"})
    second = await scheduler.schedule_batch(request, {NB: "SQL"})
    assert first.total_queued == second.total_queued == 2
    assert first.batch_id == second.batch_id
    assert first.queued_jobs[0].custom_prompt == "One SQL"
    assert all(j.exclude_sources == ["seed.sql"] for j in first.queued_jobs)
    with pytest.raises(ValueError, match="different generation"):
        await scheduler.schedule_batch(
            request.model_copy(update={"prompts": ["Changed"]}), {NB: "SQL"}
        )
    await scheduler.stop()


@pytest.mark.asyncio
async def test_exact_artifact_and_resume_without_regeneration(monkeypatch, tmp_path):
    scheduler = JobScheduler()
    scheduler._ensure_owner()
    job = ScheduledJob(
        id="job",
        notebook_id=NB,
        notebook_title="SQL",
        created_at="2026-01-01",
        artifact_id=AID,
        submitted_at="2026-01-01",
        status="in_progress",
    )
    scheduler._jobs[job.id] = job
    profile = SimpleNamespace(id="account", email="account@example.invalid")
    create = AsyncMock(side_effect=AssertionError("Must not regenerate"))
    monkeypatch.setattr("backend.scheduler.create_studio_artifact", create)
    monkeypatch.setattr(
        "backend.scheduler.artifacts",
        AsyncMock(
            return_value=[
                {"id": OLD, "type": "video", "status": "ready"},
                {"id": AID, "type": "video", "status": "ready"},
            ]
        ),
    )
    downloaded = []

    async def download(profile_id, notebook_id, kind, artifact_id, output):
        downloaded.append(artifact_id)
        Path(output).write_bytes(b"video")
        return {"success": True}

    monkeypatch.setattr("backend.scheduler.download_studio_artifact", download)
    await scheduler._execute_job(job, profile)
    assert downloaded == [AID]
    assert job.status == "completed"
    assert not create.called
    await scheduler.stop()


@pytest.mark.asyncio
async def test_failed_poll_retains_exact_id_and_diagnostics(monkeypatch):
    scheduler = JobScheduler()
    scheduler._ensure_owner()
    job = ScheduledJob(
        id="job",
        notebook_id=NB,
        notebook_title="SQL",
        created_at="2026-01-01",
        artifact_id=AID,
    )
    scheduler._jobs[job.id] = job
    details = {"stage": "studio_poll", "message": "permission denied", "returncode": 1}
    monkeypatch.setattr(
        "backend.scheduler.artifacts",
        AsyncMock(side_effect=StudioCommandError(details)),
    )
    await scheduler._execute_job(job, SimpleNamespace(id="account"))
    assert job.artifact_id == AID
    assert job.error_details == details
    assert job.attempts[-1]["error"] == details
    assert await scheduler.run_job_now(job.id)
    assert job.artifact_id == AID
    await scheduler.stop()


@pytest.mark.asyncio
async def test_mass_download_all_matching_artifacts_and_incremental_resume(
    monkeypatch, tmp_path
):
    service = BatchDownloads(tmp_path / "state")
    profile = SimpleNamespace(id="account", isDefaultPro=True)
    monkeypatch.setattr(
        "backend.batch_downloads.candidate_profiles",
        AsyncMock(return_value=([profile], [])),
    )
    listing = [
        {"id": AID, "type": "video", "title": "Video A", "status": "ready"},
        {"id": OLD, "type": "video", "title": "Video B", "status": "ready"},
    ]
    monkeypatch.setattr(
        "backend.batch_downloads.artifacts", AsyncMock(return_value=listing)
    )
    calls = []

    async def download(profile_id, notebook_id, kind, artifact_id, output):
        calls.append((profile_id, artifact_id))
        Path(output).write_bytes(b"media")
        return {"success": True}

    monkeypatch.setattr("backend.batch_downloads.download_studio_artifact", download)
    request = BatchDownloadRequest(
        notebook_ids=[NB, f"https://notebook.google.com/notebook/{NB}"],
        output_root=str(tmp_path / "output"),
        request_key="batch",
    )
    result = await service.start(request)
    await service.tasks[result["id"]]
    completed = service.get(result["id"])
    assert len(completed["notebooks"]) == 1
    assert completed["counts"] == {"downloaded": 2}
    assert completed["status"] == "completed"
    assert calls == [("account", AID), ("account", OLD)]
    assert await service.start(request) == completed
    with pytest.raises(ValueError, match="different download"):
        await service.start(request.model_copy(update={"artifact_types": ["report"]}))
    await service.resume(result["id"])
    await service.tasks[result["id"]]
    assert len(calls) == 2
    assert service.get(result["id"])["counts"] == {"skipped": 2}
    manifest = tmp_path / "output" / f"super-nlm-batch-{result['id']}.json"
    assert json.loads(manifest.read_text())["id"] == result["id"]


@pytest.mark.asyncio
async def test_download_failure_does_not_hide_success_or_waiting(monkeypatch, tmp_path):
    service = BatchDownloads(tmp_path / "state")
    profile = SimpleNamespace(id="account")
    monkeypatch.setattr(
        "backend.batch_downloads.candidate_profiles",
        AsyncMock(return_value=([profile], [])),
    )
    monkeypatch.setattr(
        "backend.batch_downloads.artifacts",
        AsyncMock(
            return_value=[
                {"id": AID, "type": "report", "status": "ready"},
                {"id": OLD, "type": "video", "status": "in_progress"},
            ]
        ),
    )
    monkeypatch.setattr(
        "backend.batch_downloads.download_studio_artifact",
        AsyncMock(
            return_value={
                "success": False,
                "returncode": 1,
                "stderr": "network disconnected",
            }
        ),
    )
    batch = await service.start(
        BatchDownloadRequest(notebook_ids=[NB], output_root=str(tmp_path / "output"))
    )
    await service.tasks[batch["id"]]
    result = service.get(batch["id"])
    assert result["counts"] == {"failed": 1, "waiting": 1}
    assert result["status"] == "partial"
    assert (
        result["notebooks"][0]["items"][0]["error"]["stderr"] == "network disconnected"
    )


@pytest.mark.asyncio
async def test_download_routing_uses_default_account_for_every_notebook(
    monkeypatch, tmp_path
):
    service = BatchDownloads(tmp_path / "state")
    nb2 = "44444444-4444-4444-8444-444444444444"
    profiles = [SimpleNamespace(id="default"), SimpleNamespace(id="second")]
    cache = [
        SimpleNamespace(id=nb, profileId=p.id, title="Notebook")
        for nb in (NB, nb2)
        for p in profiles
    ]
    monkeypatch.setattr(
        "backend.batch_downloads.candidate_profiles",
        AsyncMock(
            side_effect=lambda notebook_id, profile_id: (
                [p for p in profiles if p.id == profile_id],
                cache,
            )
        ),
    )
    monkeypatch.setattr(
        "backend.batch_downloads.artifacts",
        AsyncMock(return_value=[{"id": AID, "type": "video", "status": "ready"}]),
    )
    accounts = []

    async def download(profile_id, notebook_id, kind, artifact_id, output):
        accounts.append(profile_id)
        Path(output).write_bytes(b"media")
        return {"success": True}

    monkeypatch.setattr("backend.batch_downloads.download_studio_artifact", download)
    batch = await service.start(
        BatchDownloadRequest(
            notebook_ids=[NB, nb2], output_root=str(tmp_path / "output")
        )
    )
    await service.tasks[batch["id"]]
    assert accounts == ["default", "default"]


@pytest.mark.asyncio
async def test_rest_download_batch_and_invalid_inputs(monkeypatch, tmp_path):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from backend.fleet_api import router

    service = BatchDownloads(tmp_path / "state")
    monkeypatch.setattr("backend.fleet_api.downloads", service)
    monkeypatch.setattr(
        "backend.batch_downloads.candidate_profiles",
        AsyncMock(return_value=([SimpleNamespace(id="account")], [])),
    )
    monkeypatch.setattr(
        "backend.batch_downloads.artifacts",
        AsyncMock(return_value=[{"id": AID, "type": "video", "status": "ready"}]),
    )

    async def download(profile_id, notebook_id, kind, artifact_id, output):
        Path(output).write_bytes(b"file")
        return {"success": True}

    monkeypatch.setattr("backend.batch_downloads.download_studio_artifact", download)
    app = FastAPI()
    app.include_router(router)
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("127.0.0.1", 1234)),
        base_url="http://test",
    ) as client:
        invalid = await client.post(
            "/api/fleet/downloads/preview", json={"notebook_ids": ["invalid"]}
        )
        assert invalid.status_code == 400
        started = await client.post(
            "/api/fleet/downloads",
            json={"notebook_ids": [NB], "output_root": str(tmp_path / "output")},
        )
        assert started.status_code == 200
        batch_id = started.json()["id"]
        await service.tasks[batch_id]
        result = await client.get(f"/api/fleet/downloads/{batch_id}")
        assert result.json()["counts"] == {"downloaded": 1}


@pytest.mark.asyncio
async def test_download_profile_environment_is_isolated(monkeypatch):
    import os

    import backend.nlm_client as client

    original = execute_nlm_command
    monkeypatch.setattr(client, "run_nlm_cmd", original)
    monkeypatch.setenv("NOTEBOOKLM_COOKIES", "inherited-cookie")
    monkeypatch.setenv("NLM_PROFILE", "other")
    calls = []

    def subprocess_call(command, timeout, env):
        calls.append((command, env))
        return {"success": True}

    monkeypatch.setattr(client, "_run_subprocess_sync", subprocess_call)
    monkeypatch.setattr(client.sys, "platform", "win32")
    await original(["download", "video", NB, "--help"], profile_id="default")
    assert calls[0][1]["NLM_PROFILE"] == "default"
    assert "NOTEBOOKLM_COOKIES" not in calls[0][1]
    assert os.environ["NLM_PROFILE"] == "other"
    assert os.environ["NOTEBOOKLM_COOKIES"] == "inherited-cookie"


@pytest.mark.asyncio
@pytest.mark.parametrize("concurrency", [1, 3])
async def test_notebooks_are_sequential_with_bounded_parallel_artifacts(
    monkeypatch, tmp_path, concurrency
):
    import asyncio
    import uuid

    service = BatchDownloads(tmp_path / "state")
    nb2 = str(uuid.uuid4())
    entries = [
        {"id": str(uuid.uuid4()), "type": "report", "status": "ready"} for _ in range(3)
    ]
    monkeypatch.setattr(
        "backend.batch_downloads.candidate_profiles",
        AsyncMock(return_value=([SimpleNamespace(id="default")], [])),
    )
    monkeypatch.setattr(
        "backend.batch_downloads.artifacts", AsyncMock(return_value=entries)
    )
    active = 0
    peak = 0
    finished = []

    async def transfer(profile, notebook, kind, aid, output):
        nonlocal active, peak
        if notebook == nb2:
            assert finished.count(NB) == 3
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        Path(output).write_bytes(b"report")
        finished.append(notebook)
        active -= 1
        return {"success": True}

    monkeypatch.setattr("backend.batch_downloads.download_studio_artifact", transfer)
    batch = await service.start(
        BatchDownloadRequest(
            notebook_ids=[NB, nb2],
            output_root=str(tmp_path / "out"),
            artifact_concurrency=concurrency,
        )
    )
    await service.tasks[batch["id"]]
    assert service.get(batch["id"])["status"] == "completed"
    assert peak == concurrency
    assert finished == [NB] * 3 + [nb2] * 3
    await service.pause(batch["id"])
    await service.resume(batch["id"], artifact_concurrency=2)
    await service.tasks[batch["id"]]
    assert service.get(batch["id"])["artifact_concurrency"] == 2


def test_auto_tunes_only_from_representative_transfers_and_backs_off():
    from backend.batch_downloads import tune_downloads

    state = {"concurrency": 1}
    tune_downloads(state, 1, 1000, 0.1, 0, True)
    assert state["concurrency"] == 1
    tune_downloads(state, 1, 1048576, 2, 0, True)
    assert state["concurrency"] == 2
    tune_downloads(state, 2, 2097152, 2, 0, True)
    assert state["concurrency"] == 3
    tune_downloads(state, 3, 2097152, 2, 0, True)
    assert state["concurrency"] == 2
    tune_downloads(state, 2, 0, 2, 1, True)
    assert state["concurrency"] == 1
    tune_downloads(state, 1, 1048576, 2, 0, True)
    assert state["concurrency"] == 1
    state = {"concurrency": 6}
    tune_downloads(state, 6, 10485760, 2, 0, True)
    assert state["concurrency"] == 6


@pytest.mark.asyncio
async def test_auto_mode_measures_completed_downloads_and_increases_concurrency(
    monkeypatch, tmp_path
):
    import asyncio
    import itertools
    import uuid

    import backend.batch_downloads as module

    service = BatchDownloads(tmp_path / "state")
    entries = [
        {"id": str(uuid.uuid4()), "type": "report", "status": "ready"} for _ in range(6)
    ]
    monkeypatch.setattr(
        module,
        "candidate_profiles",
        AsyncMock(return_value=([SimpleNamespace(id="default")], [])),
    )
    monkeypatch.setattr(module, "artifacts", AsyncMock(return_value=entries))
    ticks = itertools.count(0, 2)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    active = 0
    peak = 0

    async def transfer(profile, notebook, kind, aid, output):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.001)
        Path(output).write_bytes(b"x" * 300000)
        active -= 1
        return {"success": True}

    monkeypatch.setattr(module, "download_studio_artifact", transfer)
    batch = await service.start(
        BatchDownloadRequest(
            notebook_ids=[NB], output_root=str(tmp_path / "out"), download_mode="auto"
        )
    )
    await service.tasks[batch["id"]]
    result = service.get(batch["id"])
    assert result["status"] == "completed"
    assert peak == 3
    assert result["adaptive"]["concurrency"] == 4
    assert result["adaptive"]["bytes_per_second"] == 450000


def test_clean_artifact_names_collision_and_legacy_migration(tmp_path):
    from backend.artifact_files import ArtifactCatalog

    folder = tmp_path / "media"
    folder.mkdir()
    catalog = ArtifactCatalog(folder, tmp_path / "state")
    legacy = folder / f"video_Evolution of Context_{AID}.mp4"
    legacy.write_bytes(b"video")
    output, existing = catalog.prepare(AID, "Evolution of Context", ".mp4")
    assert output.name == "Evolution of Context.mp4"
    assert existing == output and output.read_bytes() == b"video"
    assert not legacy.exists()
    second_id = "55555555-5555-4555-8555-555555555555"
    second, _ = catalog.prepare(second_id, "Evolution of Context", ".mp4")
    assert second.name == "Evolution of Context [55555555].mp4"
    fresh = ArtifactCatalog(folder, tmp_path / "state")
    assert fresh.prepare(AID, "Renamed upstream title", ".mp4")[1] == output
    unrelated = folder / "Notes.md"
    unrelated.write_bytes(b"unrelated")
    third, exists = catalog.prepare(
        "66666666-6666-4666-8666-666666666666", "Notes", ".md"
    )
    assert third.name == "Notes [66666666].md" and exists is None
    assert unrelated.read_bytes() == b"unrelated"


@pytest.mark.asyncio
async def test_owner_badge_metadata_uses_owner_role_not_query_account(monkeypatch):
    from backend.notebook_owners import enrich_notebook_owners

    entries = [
        SimpleNamespace(id=NB, profileId="secondary", ownerEmail=None),
        SimpleNamespace(id=NB, profileId="default", ownerEmail=None),
    ]
    command = AsyncMock(
        return_value={
            "success": True,
            "stdout": json.dumps(
                {
                    "collaborators": [
                        {"email": "secondary@example.invalid", "role": "editor"},
                        {"email": "creator@example.invalid", "role": "owner"},
                    ]
                }
            ),
        }
    )
    monkeypatch.setattr("backend.notebook_owners.run_nlm_cmd", command)
    await enrich_notebook_owners(entries)
    assert all(n.ownerEmail == "creator@example.invalid" for n in entries)
    assert all(n.sharedWith == [{"email": "secondary@example.invalid", "role": "editor"}] for n in entries)
    assert command.await_count == 1
    command.return_value = {"success": False}
    unknown = SimpleNamespace(id=NB, profileId="secondary", ownerEmail=None)
    await enrich_notebook_owners([unknown])
    assert unknown.ownerEmail is None
