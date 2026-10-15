"""REST fleet controls using the same services as MCP."""

import asyncio
import os
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

from backend.auth import is_loopback_client, verify_api_access
from backend.batch_downloads import EXTENSIONS, BatchDownloadRequest, downloads
from backend.models import BatchScheduleRequest
from backend.scheduler import scheduler
from backend.storage import get_cached_notebooks
from backend.studio_service import (
    StudioCommandError,
    get_share_status,
    normalize_notebook,
    sources,
)
from mcp_server.fleet_tools import download_generation_batch


class FleetRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def checked(request):
            try:
                return await handler(request)
            except StudioCommandError as error:
                raise HTTPException(422, detail=error.details) from error
            except (ValueError, RuntimeError, OSError) as error:
                raise HTTPException(400, detail=str(error)) from error

        return checked


router = APIRouter(
    prefix="/api/fleet",
    route_class=FleetRoute,
    dependencies=[Depends(verify_api_access)],
)


async def call(awaitable):
    try:
        return await awaitable
    except StudioCommandError as error:
        raise HTTPException(422, detail=error.details) from error
    except (ValueError, RuntimeError, OSError) as error:
        raise HTTPException(400, detail=str(error)) from error


@router.get("/downloads/defaults")
async def defaults():
    return {
        "output_root": str(Path.home() / "Downloads" / "Super-NLM"),
        "artifact_types": list(EXTENSIONS),
    }


@router.post("/downloads/preview")
async def preview(request: BatchDownloadRequest):
    return await call(downloads.plan(request))


@router.post("/downloads")
async def start(request: BatchDownloadRequest):
    return await call(downloads.start(request))


@router.get("/downloads")
async def list_batches():
    return downloads.list()


@router.get("/downloads/{batch_id}")
async def get_batch(batch_id: str):
    try:
        return downloads.get(batch_id)
    except ValueError as error:
        raise HTTPException(404, detail=str(error)) from error


class ResumeDownloads(BaseModel):
    download_mode: Literal["manual", "auto"] | None = None
    artifact_concurrency: int | None = Field(default=None, ge=1, le=6)


@router.post("/downloads/{batch_id}/resume")
async def resume(batch_id: str, options: ResumeDownloads | None = None):
    return await call(
        downloads.resume(
            batch_id,
            options.artifact_concurrency if options else None,
            options.download_mode if options else None,
        )
    )


@router.post("/downloads/{batch_id}/pause")
async def pause(batch_id: str):
    return await call(downloads.pause(batch_id))


@router.post("/downloads/{batch_id}/open-folder")
async def open_folder(batch_id: str, request: Request):
    if not is_loopback_client(request):
        raise HTTPException(400, "Open folder is available on the local Super-NLM host")
    batch = downloads.get(batch_id)
    path = Path(batch["output_root"])
    if not path.is_dir():
        raise HTTPException(400, "The download folder has not been created yet")
    if os.name == "nt":
        os.startfile(str(path))
    else:
        await asyncio.to_thread(
            subprocess.Popen,
            ["open" if os.sys.platform == "darwin" else "xdg-open", str(path)],
        )
    return {"success": True}


@router.post("/folder-picker")
async def folder_picker(request: Request):
    if not is_loopback_client(request):
        raise HTTPException(
            400, "Enter a folder path on the server when using remote access"
        )

    def choose():
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        try:
            return filedialog.askdirectory(
                title="Choose Super-NLM batch download folder", parent=root
            )
        finally:
            root.destroy()

    try:
        return {"path": await asyncio.to_thread(choose)}
    except Exception as error:
        raise HTTPException(
            400, "Native folder picker is unavailable; enter the full folder path"
        ) from error


@router.get("/notebooks/{notebook_id}/share-status")
async def sharing(notebook_id: str, profile_id: str | None = None):
    return await call(get_share_status(normalize_notebook(notebook_id), profile_id))


@router.get("/notebooks/{notebook_id}/sources")
async def source_list(notebook_id: str, profile_id: str):
    return await call(sources(normalize_notebook(notebook_id), profile_id))


@router.post("/generation/preflight")
async def preflight(request: BatchScheduleRequest):
    from backend.studio_service import candidate_profiles, source_scope

    rows = []
    for value in dict.fromkeys(request.notebook_ids):
        notebook_id = normalize_notebook(value)
        profiles, _ = await candidate_profiles(
            notebook_id, request.preferred_profile_id
        )
        errors = []
        for profile in profiles:
            try:
                selected = await source_scope(
                    notebook_id,
                    profile.id,
                    request.source_ids_by_notebook.get(notebook_id, request.source_ids),
                    request.exclude_sources,
                )
                rows.append(
                    {
                        "notebook_id": notebook_id,
                        "profile_id": profile.id,
                        "source_ids": selected,
                        "ready": True,
                        "attempts": errors,
                    }
                )
                break
            except (StudioCommandError, ValueError) as error:
                errors.append(getattr(error, "details", {"message": str(error)}))
        else:
            rows.append(
                {"notebook_id": notebook_id, "ready": False, "attempts": errors}
            )
    return {"notebooks": rows}


@router.post("/generation")
async def generation(request: BatchScheduleRequest):
    request.notebook_ids = [normalize_notebook(n) for n in request.notebook_ids]
    cache = await get_cached_notebooks()
    result = await call(
        scheduler.schedule_batch(request, {n.id: n.title for n in cache})
    )
    await call(scheduler.dispatch_now())
    return result.model_dump()


@router.post("/generation/{batch_id}/downloads")
async def generated_downloads(batch_id: str, request: dict):
    return await call(download_generation_batch(batch_id, request.get("output_root")))


@router.post("/scheduler/{action}")
async def scheduler_action(action: str, payload: dict | None = None):
    try:
        scheduler._ensure_owner()
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    payload = payload or {}
    if action == "status":
        return {
            **scheduler.get_status().model_dump(),
            "scheduler_running": scheduler.running,
            "dispatch_paused": scheduler.dispatch_paused,
        }
    if action == "schedule":
        request = BatchScheduleRequest(**payload)
        request.notebook_ids = [normalize_notebook(n) for n in request.notebook_ids]
        cache = await get_cached_notebooks()
        return (
            await call(
                scheduler.schedule_batch(request, {n.id: n.title for n in cache})
            )
        ).model_dump()
    if action == "run-now":
        job_id = payload.get("job_id", "")
        job = scheduler.get_job(job_id)
        if job is None:
            raise HTTPException(404, "Job not found")
        success = await scheduler.run_job_now(job_id)
        if success:
            await call(scheduler.dispatch_now())
        return {
            "success": success,
            "job": job.model_dump(),
            "scheduler_running": scheduler.running,
        }
    if action == "stop":
        await scheduler.stop()
        return {"success": True, "scheduler_running": False}
    if action == "cancel":
        return {"success": await scheduler.cancel_job(payload.get("job_id", ""))}
    if action == "cleanup":
        statuses = set(payload.get("statuses") or ["failed", "cancelled"])
        if statuses - {"failed", "cancelled", "completed", "download_failed"}:
            raise HTTPException(400, "Only terminal job history can be deleted")
        removed = []
        for job in list(scheduler.get_jobs()):
            if (
                job.status in statuses
                and (not payload.get("batch_id") or payload["batch_id"] == job.batch_id)
                and await scheduler.delete_job(job.id)
            ):
                removed.append(job.id)
        return {"removed": removed}
    if action in {"pause", "resume"}:
        scheduler.dispatch_paused = action == "pause"
        if action == "resume":
            await call(scheduler.dispatch_now())
        return {
            **scheduler.get_status().model_dump(),
            "dispatch_paused": scheduler.dispatch_paused,
            "scheduler_running": scheduler.running,
        }
    if action == "retry-failed":
        retried = []
        for job in list(scheduler.get_jobs()):
            if (
                job.status in {"failed", "download_failed"}
                and job.notebook_id != "nb-1"
                and await scheduler.run_job_now(job.id)
            ):
                retried.append(job.id)
        await call(scheduler.dispatch_now())
        return {"retried": retried}
    if action == "clear-failed-history":
        removed = []
        for job in list(scheduler.get_jobs()):
            if job.status in {"failed", "cancelled"} and await scheduler.delete_job(
                job.id
            ):
                removed.append(job.id)
        return {"removed": removed}
    raise HTTPException(404, "Unknown scheduler action")
