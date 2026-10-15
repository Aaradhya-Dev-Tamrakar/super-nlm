"""Fleet bulk operations sharing the REST service implementation."""

from typing import Literal

from backend.batch_downloads import BatchDownloadRequest, downloads
from backend.queue_bridge import claim_scheduler, forward_queue
from backend.scheduler import scheduler
from backend.studio_service import (
    StudioCommandError,
    candidate_profiles,
    get_share_status,
    normalize_notebook,
    source_scope,
    sources,
)


async def download_generation_batch(batch_id: str, output_root=None):
    jobs = scheduler.get_jobs() if scheduler.running else scheduler.read_jobs()
    notebooks = list(
        dict.fromkeys(j.notebook_id for j in jobs if j.batch_id == batch_id)
    )
    if not notebooks:
        raise ValueError("Generation batch not found")
    return await downloads.start(
        BatchDownloadRequest(
            notebook_ids=notebooks,
            output_root=output_root,
            generation_batch_id=batch_id,
        )
    )


def register_fleet_tools(server):
    @server.tool()
    async def pause_scheduler_dispatch() -> dict:
        """Pause new generation submissions while existing execution/polling tasks finish."""
        if not claim_scheduler(scheduler):
            return await forward_queue("pause")
        scheduler.dispatch_paused = True
        return {"dispatch_paused": True}

    @server.tool()
    async def resume_scheduler_dispatch() -> dict:
        """Resume generation dispatch within fleet capacity and account cooldowns."""
        if not claim_scheduler(scheduler):
            return await forward_queue("resume")
        scheduler.dispatch_paused = False
        await scheduler.dispatch_now()
        return {"dispatch_paused": False}

    @server.tool()
    async def get_notebook_share_status(
        notebook_id: str, profile_id: str | None = None
    ) -> dict:
        """Read live collaborators, roles and pending invitations; does not send invitations.

        An unlisted account is unknown, not proven denied. profile_id can select the owner explicitly.
        """
        return await get_share_status(normalize_notebook(notebook_id), profile_id)

    @server.tool()
    async def list_notebook_sources(
        notebook_id: str, profile_id: str | None = None
    ) -> dict:
        """List source IDs and titles for optional Studio source selection. Read-only."""
        notebook_id = normalize_notebook(notebook_id)
        profiles, _ = await candidate_profiles(notebook_id, profile_id)
        errors = []
        for profile in profiles:
            try:
                return {
                    "notebook_id": notebook_id,
                    "profile_id": profile.id,
                    "sources": await sources(notebook_id, profile.id),
                    "attempts": errors,
                }
            except (StudioCommandError, ValueError, OSError) as error:
                errors.append(getattr(error, "details", {"message": str(error)}))
        return {"success": False, "attempts": errors}

    @server.tool()
    async def preflight_studio_generation(
        notebook_ids: list[str], exclude_sources: list[str] | None = None
    ) -> dict:
        """Check sources/access before a fleet run, without sharing or generation side effects."""
        rows = []
        for value in dict.fromkeys(notebook_ids):
            notebook_id = normalize_notebook(value)
            profiles, _ = await candidate_profiles(notebook_id)
            attempts = []
            for profile in profiles:
                try:
                    selected = await source_scope(
                        notebook_id, profile.id, exclude_sources=exclude_sources
                    )
                    rows.append(
                        {
                            "notebook_id": notebook_id,
                            "profile_id": profile.id,
                            "ready": True,
                            "source_ids": selected,
                            "attempts": attempts,
                        }
                    )
                    break
                except (StudioCommandError, ValueError, OSError) as error:
                    attempts.append(
                        getattr(
                            error,
                            "details",
                            {"message": str(error), "profile_id": profile.id},
                        )
                    )
            else:
                rows.append(
                    {"notebook_id": notebook_id, "ready": False, "attempts": attempts}
                )
        return {"notebooks": rows}

    @server.tool()
    async def batch_download_artifacts(
        notebook_ids: list[str],
        artifact_types: list[str] | None = None,
        output_root: str | None = None,
        notebook_folders: dict[str, str] | None = None,
        skip_existing: bool = True,
        artifact_concurrency: int = 1,
        download_mode: Literal["manual", "auto"] = "manual",
        request_key: str | None = None,
    ) -> dict:
        """Start persistent downloads across notebook UUIDs/links. Omit types for every supported type.

        Returns a batch ID immediately after access preview. Downloads all matching artifacts by ID,
        organizes external notebook folders, skips existing files and retains per-artifact diagnostics.
        Paths refer to the Super-NLM host. Inspect progress with get_download_batch.
        """
        return await downloads.start(
            BatchDownloadRequest(
                notebook_ids=notebook_ids,
                artifact_types=artifact_types,
                output_root=output_root,
                notebook_folders=notebook_folders or {},
                skip_existing=skip_existing,
                artifact_concurrency=artifact_concurrency,
                download_mode=download_mode,
                request_key=request_key,
            )
        )

    @server.tool()
    async def get_download_batch(batch_id: str) -> dict:
        """Read persistent bulk-download progress, notebook folders, artifact results and errors."""
        return downloads.get(batch_id)

    @server.tool()
    async def list_download_batches() -> list[dict]:
        """List saved fleet download batches, including paused/interrupted runs."""
        return downloads.list()

    @server.tool()
    async def resume_download_batch(
        batch_id: str,
        artifact_concurrency: int | None = None,
        download_mode: Literal["manual", "auto"] | None = None,
    ) -> dict:
        """Resume/re-scan a batch, download newly ready files and retry failures without regenerating."""
        return await downloads.resume(batch_id, artifact_concurrency, download_mode)

    @server.tool()
    async def pause_download_batch(batch_id: str) -> dict:
        """Pause a locally owned download batch, preserving its manifest and successful files."""
        return await downloads.pause(batch_id)

    @server.tool()
    async def download_batch_results(
        batch_id: str, output_root: str | None = None
    ) -> dict:
        """Download exact artifacts associated with a generation batch; excludes unrelated artifacts."""
        return await download_generation_batch(batch_id, output_root)

    @server.tool()
    async def cleanup_scheduled_jobs(
        statuses: list[str] | None = None, batch_id: str | None = None
    ) -> dict:
        """Delete selected terminal job-history records, preserving queued and running generations."""
        selected = set(statuses or ["failed", "cancelled"])
        if selected - {"failed", "cancelled", "completed", "download_failed"}:
            raise ValueError("Cleanup accepts terminal statuses only")
        if not claim_scheduler(scheduler):
            return await forward_queue(
                "cleanup", {"statuses": sorted(selected), "batch_id": batch_id}
            )
        removed = []
        for job in list(scheduler.get_jobs()):
            if (
                job.status in selected
                and (batch_id is None or job.batch_id == batch_id)
                and await scheduler.delete_job(job.id)
            ):
                removed.append(job.id)
        return {"removed": removed}
