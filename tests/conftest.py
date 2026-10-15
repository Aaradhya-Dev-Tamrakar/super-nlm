"""Tests must never write to the user's queue or invoke the authenticated CLI."""

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_runtime(tmp_path, monkeypatch):
    import backend.notebook_owners as owners
    import backend.nlm_client as client
    import backend.scheduler as scheduler_module
    import backend.studio_service as studio
    from backend import storage
    from backend.process_lease import ProcessLease

    monkeypatch.setattr(scheduler_module, "SCHEDULED_JOBS_FILE", tmp_path / "jobs.json")
    monkeypatch.setattr(scheduler_module, "DOWNLOADS_DIR", tmp_path / "generated")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))
    monkeypatch.setattr(
        storage,
        "DEFAULT_SEED_PROFILES",
        [
            {
                "id": "default",
                "displayName": "Test",
                "email": "test@example.invalid",
                "tier": "pro",
                "status": "connected",
                "isDefaultPro": True,
            }
        ],
    )
    for name in ("PROFILES_FILE", "CACHE_FILE", "FOLDER_MAPPINGS_FILE"):
        monkeypatch.setattr(storage, name, tmp_path / f"{name}.json")
    leases = []
    original = ProcessLease.acquire

    def acquire(lease):
        result = original(lease)
        if result and lease not in leases:
            leases.append(lease)
        return result

    monkeypatch.setattr(ProcessLease, "acquire", acquire)

    async def forbid(*args, **kwargs):
        raise AssertionError("Unmocked NotebookLM CLI call in tests")

    monkeypatch.setattr(client, "run_nlm_cmd", forbid)
    monkeypatch.setattr(studio, "run_nlm_cmd", forbid)
    monkeypatch.setattr(owners, "run_nlm_cmd", forbid)
    yield
    for lease in reversed(leases):
        lease.release()
