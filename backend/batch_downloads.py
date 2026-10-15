"""Persistent bulk downloads used by both REST and MCP."""

import asyncio
import datetime as dt
import hashlib
import json
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from backend.artifact_files import ArtifactCatalog
from backend.config import BASE_DIR, DATA_DIR
from backend.nlm_client import download_studio_artifact
from backend.process_lease import ProcessLease
from backend.studio_service import (
    READY,
    TYPE_ALIASES,
    StudioCommandError,
    artifacts,
    candidate_profiles,
    diagnostic,
    normalize_notebook,
)

EXTENSIONS = {
    "video": ".mp4",
    "audio": ".m4a",
    "slides": ".pdf",
    "report": ".md",
    "quiz": ".md",
    "flashcards": ".md",
    "mindmap": ".json",
    "infographic": ".png",
    "data-table": ".csv",
}


class BatchDownloadRequest(BaseModel):
    notebook_ids: list[str] = Field(min_length=1, max_length=1000)
    artifact_types: list[str] | None = None
    output_root: str | None = None
    notebook_folders: dict[str, str] = Field(default_factory=dict)
    skip_existing: bool = True
    request_key: str | None = None
    generation_batch_id: str | None = None
    artifact_concurrency: int = Field(default=1, ge=1, le=6)
    download_mode: Literal["manual", "auto"] = "manual"


def tune_downloads(state, limit, transferred, elapsed, failures, complete_sample):
    """Heuristic based on completed transfer windows, including CLI/server overhead."""
    rate = transferred / max(elapsed, 0.001)
    state.update(bytes_per_second=round(rate), measured_at=now())
    if failures:
        state.update(
            concurrency=max(1, limit // 2),
            best_rate=0,
            cooldown=3,
            reason="Transfer failed; reducing parallel downloads",
        )
        return
    if not complete_sample or transferred < 262144 or elapsed < 1:
        state["reason"] = "Waiting for a representative transfer sample"
        return
    if state.get("cooldown", 0):
        state.update(
            best_rate=rate,
            best_concurrency=limit,
            cooldown=state["cooldown"] - 1,
            reason="Holding concurrency while measuring throughput",
        )
        return
    best = state.get("best_rate", 0)
    if not best or rate > best * 1.1:
        state.update(
            best_rate=rate,
            best_concurrency=limit,
            concurrency=min(6, limit + 1),
            cooldown=0,
            reason="Throughput improved; trying more parallel downloads"
            if limit < 6
            else "Maximum parallel downloads reached",
        )
    elif limit > state.get("best_concurrency", 1):
        state.update(
            concurrency=state["best_concurrency"],
            cooldown=3,
            reason="Extra downloads did not improve throughput; returning to the better setting",
        )
    elif rate < best * 0.7:
        state.update(
            concurrency=max(1, limit // 2),
            best_rate=0,
            cooldown=3,
            reason="Throughput dropped; reducing parallel downloads",
        )
    elif state.get("cooldown", 0):
        state["cooldown"] -= 1
        state["reason"] = "Holding concurrency while measuring throughput"
    else:
        state.update(
            concurrency=min(6, limit + 1),
            reason="Checking whether more parallel downloads help",
        )


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def safe_name(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")[:90]
    if value.split(".")[0].upper() in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        value = "_" + value
    return value or "Notebook"


def destination(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError(
            "Download destinations must be absolute paths on the Super-NLM host"
        )
    path = path.resolve()
    if path == BASE_DIR.resolve() or BASE_DIR.resolve() in path.parents:
        raise ValueError("Choose a download folder outside the repository")
    return path


def atomic_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    temporary.replace(path)


class BatchDownloads:
    def __init__(self, state_dir: Path | None = None):
        self.state_dir = state_dir or DATA_DIR / "download_batches"
        self.tasks: dict[str, asyncio.Task] = {}

    def get(self, batch_id: str) -> dict:
        batch_id = str(uuid.UUID(batch_id))
        path = self.state_dir / f"{batch_id}.json"
        if not path.exists():
            raise ValueError("Download batch not found")
        batch = json.loads(path.read_text(encoding="utf-8"))
        lease = ProcessLease(self.state_dir / f"{batch_id}.lock")
        inactive = lease.acquire()
        if inactive:
            lease.release()
        batch["worker_active"] = not inactive
        if inactive and batch["status"] == "running":
            batch["status"] = "interrupted"
        return batch

    def list(self) -> list[dict]:
        if not self.state_dir.exists():
            return []
        batches = [self.get(p.stem) for p in self.state_dir.glob("*.json")]
        return sorted(batches, key=lambda b: b["created_at"], reverse=True)

    def save(self, batch: dict):
        batch.pop("worker_active", None)
        batch["updated_at"] = now()
        counts = {}
        for notebook in batch["notebooks"]:
            for item in notebook.get("items", []):
                counts[item["status"]] = counts.get(item["status"], 0) + 1
        batch["counts"] = counts
        atomic_json(self.state_dir / f"{batch['id']}.json", batch)

    async def plan(self, request: BatchDownloadRequest, inspect: bool = True) -> dict:
        root = destination(
            request.output_root or str(Path.home() / "Downloads" / "Super-NLM")
        )
        types = (
            None
            if request.artifact_types is None
            else {TYPE_ALIASES.get(t, t) for t in request.artifact_types}
        )
        if types is not None and (not types or types - EXTENSIONS.keys()):
            raise ValueError(
                "Select at least one supported artifact type, or omit types for all"
            )
        ids = list(dict.fromkeys(normalize_notebook(n) for n in request.notebook_ids))
        limit = asyncio.Semaphore(3)

        async def resolve(notebook_id):
            async with limit:
                profiles, cache = await candidate_profiles(notebook_id, "default")
                title = next(
                    (n.title for n in cache if n.id == notebook_id),
                    f"Notebook {notebook_id[:8]}",
                )
                folder = destination(
                    request.notebook_folders.get(notebook_id)
                    or str(root / f"{safe_name(title)}_{notebook_id[:8]}")
                )
                attempts = []
                if not inspect:
                    return {
                        "notebook_id": notebook_id,
                        "title": title,
                        "folder": str(folder),
                        "profile_id": None,
                        "artifact_count": 0,
                        "ready_count": 0,
                        "attempts": [],
                        "items": [],
                    }
                for profile in profiles:
                    try:
                        items = await artifacts(notebook_id, profile.id)
                        items = [
                            a
                            for a in items
                            if a.get("id")
                            and a["type"] in EXTENSIONS
                            and (types is None or a["type"] in types)
                        ]
                        return {
                            "notebook_id": notebook_id,
                            "title": title,
                            "folder": str(folder),
                            "profile_id": profile.id,
                            "artifact_count": len(items),
                            "ready_count": sum(a.get("status") in READY for a in items),
                            "attempts": attempts,
                            "items": [],
                        }
                    except StudioCommandError as error:
                        attempts.append(error.details)
                return {
                    "notebook_id": notebook_id,
                    "title": title,
                    "folder": str(folder),
                    "profile_id": None,
                    "artifact_count": 0,
                    "ready_count": 0,
                    "attempts": attempts,
                    "error": "The default account could not inspect this notebook",
                    "items": [],
                }

        notebooks = await asyncio.gather(*(resolve(n) for n in ids))
        return {
            "output_root": str(root),
            "notebooks": notebooks,
            "artifact_types": sorted(types) if types else None,
        }

    async def start(self, request: BatchDownloadRequest) -> dict:
        creation_lock = ProcessLease(self.state_dir / "create.lock")
        if not creation_lock.acquire():
            raise ValueError(
                "Another batch request is being recorded; retry this request"
            )
        try:
            if request.request_key:
                existing = next(
                    (
                        b
                        for b in self.list()
                        if b["request"].get("request_key") == request.request_key
                    ),
                    None,
                )
                if existing:
                    if (
                        BatchDownloadRequest(**existing["request"]).model_dump()
                        != request.model_dump()
                    ):
                        raise ValueError(
                            "This request_key already belongs to a different download request"
                        )
                    return existing
            plan = await self.plan(request, inspect=False)
            batch = {
                "id": str(uuid.uuid4()),
                "status": "queued",
                "created_at": now(),
                "request": request.model_dump(),
                "output_root": plan["output_root"],
                "notebooks": plan["notebooks"],
                "attempts": [],
            }
            self.save(batch)
        finally:
            creation_lock.release()
        return await self.resume(batch["id"])

    async def resume(
        self,
        batch_id: str,
        artifact_concurrency: int | None = None,
        download_mode: Literal["manual", "auto"] | None = None,
    ) -> dict:
        batch = self.get(batch_id)
        if artifact_concurrency is not None or download_mode is not None:
            validated = BatchDownloadRequest(
                **{
                    **batch["request"],
                    "artifact_concurrency": artifact_concurrency
                    if artifact_concurrency is not None
                    else batch.get("artifact_concurrency", 1),
                    "download_mode": download_mode
                    if download_mode is not None
                    else batch.get(
                        "download_mode", batch["request"].get("download_mode", "manual")
                    ),
                }
            )
            lease = ProcessLease(self.state_dir / f"{batch_id}.lock")
            if not lease.acquire():
                raise ValueError(
                    "Pause this batch before changing download concurrency"
                )
            try:
                batch["artifact_concurrency"] = validated.artifact_concurrency
                batch["download_mode"] = validated.download_mode
                self.save(batch)
            finally:
                lease.release()
        if batch_id not in self.tasks or self.tasks[batch_id].done():
            task = asyncio.create_task(self.run(batch_id))
            self.tasks[batch_id] = task
        return batch

    async def pause(self, batch_id: str) -> dict:
        # Only the process owning this task can pause it; do not cancel a different host's worker.
        task = self.tasks.get(batch_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        else:
            batch = self.get(batch_id)
            lease = ProcessLease(self.state_dir / f"{batch_id}.lock")
            if not lease.acquire():
                raise ValueError(
                    "This batch is running in another process; pause it in its owning interface"
                )
            try:
                batch["status"] = "paused"
                self.save(batch)
            finally:
                lease.release()
        return self.get(batch_id)

    async def shutdown(self):
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)

    async def run(self, batch_id: str):
        lease = ProcessLease(self.state_dir / f"{batch_id}.lock")
        if not lease.acquire():
            return
        try:
            await self.run_owned(batch_id)
        finally:
            lease.release()

    async def run_owned(self, batch_id: str):
        batch = self.get(batch_id)
        request = BatchDownloadRequest(
            **{
                **batch["request"],
                "download_mode": batch.get(
                    "download_mode", batch["request"].get("download_mode", "manual")
                ),
                "artifact_concurrency": batch.get(
                    "artifact_concurrency",
                    batch["request"].get("artifact_concurrency", 1),
                ),
            }
        )
        batch["run_number"] = batch.get("run_number", 0) + 1
        batch["status"] = "running"
        if request.download_mode == "auto":
            batch["adaptive"] = {
                "concurrency": 1,
                "reason": "Starting with one transfer to measure throughput",
            }
        self.save(batch)
        try:
            for notebook in batch["notebooks"]:
                try:
                    await self.download_notebook(batch, notebook, request)
                except (StudioCommandError, ValueError, OSError) as error:
                    notebook["error"] = getattr(
                        error, "details", {"stage": "download", "message": str(error)}
                    )
                    self.save(batch)
            has_errors = any(n.get("error") for n in batch["notebooks"]) or any(
                i["status"] == "failed" for n in batch["notebooks"] for i in n["items"]
            )
            waiting = any(
                n.get("pending_generations") for n in batch["notebooks"]
            ) or any(
                i["status"] == "waiting" for n in batch["notebooks"] for i in n["items"]
            )
            batch["status"] = (
                "partial" if has_errors else "waiting" if waiting else "completed"
            )
        except asyncio.CancelledError:
            batch["status"] = "paused"
            raise
        except Exception as error:
            logging.getLogger(__name__).exception("Download batch %s failed", batch_id)
            batch["status"] = "failed"
            batch["attempts"].append(
                {"at": now(), "stage": "batch", "message": str(error)}
            )
        finally:
            self.save(batch)
            try:
                root = destination(batch["output_root"])
                atomic_json(root / f"super-nlm-batch-{batch_id}.json", batch)
            except OSError as error:
                logging.getLogger(__name__).error(
                    "Could not export batch manifest: %s", error
                )

    async def download_notebook(self, batch, notebook, request):
        profiles, _ = await candidate_profiles(notebook["notebook_id"], "default")
        items = None
        for profile in profiles:
            try:
                items = await artifacts(notebook["notebook_id"], profile.id)
                notebook["profile_id"] = profile.id
                notebook.pop("error", None)
                break
            except StudioCommandError as error:
                notebook["attempts"].append(error.details)
        if items is None:
            raise ValueError(
                "The default account could not inspect the notebook; see its attempt diagnostics"
            )
        profile_id = notebook["profile_id"]
        profile_lease = ProcessLease(
            self.state_dir
            / f"profile-{hashlib.sha256(profile_id.encode()).hexdigest()[:16]}.lock"
        )
        folder = destination(notebook["folder"])
        folder_lease = ProcessLease(folder / ".super-nlm.lock")
        while not profile_lease.acquire():
            await asyncio.sleep(1)
        try:
            folder.mkdir(parents=True, exist_ok=True)
            while not folder_lease.acquire():
                await asyncio.sleep(1)
            catalog = ArtifactCatalog(folder, self.state_dir)
            allowed = None
            if request.generation_batch_id:
                from backend.scheduler import scheduler

                jobs = (
                    scheduler.get_jobs() if scheduler.running else scheduler.read_jobs()
                )
                jobs = [
                    j
                    for j in jobs
                    if j.batch_id == request.generation_batch_id
                    and j.notebook_id == notebook["notebook_id"]
                ]
                allowed = {j.artifact_id for j in jobs if j.artifact_id}
                notebook["pending_generations"] = 0
                if any(not j.artifact_id for j in jobs):
                    notebook["pending_generations"] = sum(
                        not j.artifact_id for j in jobs
                    )
            types = (
                {TYPE_ALIASES.get(t, t) for t in request.artifact_types}
                if request.artifact_types
                else None
            )
            old = {i["id"]: i for i in notebook["items"]}

            async def download_one(artifact):
                kind, aid = artifact["type"], artifact.get("id")
                if (
                    not aid
                    or kind not in EXTENSIONS
                    or (types and kind not in types)
                    or (allowed is not None and aid not in allowed)
                ):
                    return
                # UUID validation prevents artifact identifiers becoming paths or glob patterns.
                aid = str(uuid.UUID(aid))
                item = old.get(aid) or {
                    "id": aid,
                    "type": kind,
                    "title": artifact.get("title", kind),
                    "attempts": [],
                }
                if aid not in old:
                    notebook["items"].append(item)
                if artifact.get("status") not in READY:
                    item["status"] = (
                        "failed" if artifact.get("status") == "failed" else "waiting"
                    )
                    item["error"] = artifact.get("error_reason")
                    self.save(batch)
                    return
                output, existing = catalog.prepare(
                    aid, item["title"], EXTENSIONS[kind], item.get("path")
                )
                if request.skip_existing and existing:
                    item.update(status="skipped", path=str(existing))
                    self.save(batch)
                    return
                item["status"] = "downloading"
                self.save(batch)
                temporary = output.with_name(output.stem + ".partial" + output.suffix)
                try:
                    result = await download_studio_artifact(
                        profile_id, notebook["notebook_id"], kind, aid, str(temporary)
                    )
                except asyncio.CancelledError:
                    item["status"] = "interrupted"
                    self.save(batch)
                    raise
                if (
                    result.get("success")
                    and temporary.exists()
                    and temporary.stat().st_size
                ):
                    temporary.replace(output)
                    item.update(
                        status="downloaded",
                        path=str(output),
                        bytes=output.stat().st_size,
                    )
                    item.pop("error", None)
                else:
                    details = diagnostic(
                        result, "download", notebook["notebook_id"], profile_id
                    )
                    if result.get("success"):
                        details["message"] = (
                            "CLI reported success but produced no nonempty file"
                        )
                    item.update(status="failed", error=details)
                    item["attempts"].append({"at": now(), **details})
                self.save(batch)

                return {
                    "bytes": item.get("bytes", 0)
                    if item["status"] == "downloaded"
                    else 0,
                    "failed": item["status"] == "failed",
                }

            if request.download_mode == "auto":
                index = 0
                while index < len(items):
                    state = batch["adaptive"]
                    limit = state["concurrency"]
                    window = items[index : index + limit]
                    started = time.monotonic()
                    async with asyncio.TaskGroup() as group:
                        tasks = [
                            group.create_task(download_one(artifact))
                            for artifact in window
                        ]
                    results = [
                        task.result() for task in tasks if task.result() is not None
                    ]
                    elapsed = time.monotonic() - started
                    if results:
                        tune_downloads(
                            state,
                            limit,
                            sum(r["bytes"] for r in results),
                            elapsed,
                            sum(r["failed"] for r in results),
                            len(results) == limit,
                        )
                        self.save(batch)
                    index += len(window)
            else:
                semaphore = asyncio.Semaphore(request.artifact_concurrency)

                async def limited(artifact):
                    async with semaphore:
                        await download_one(artifact)

                # Await cancelled transfers before releasing destination locks.
                async with asyncio.TaskGroup() as group:
                    for artifact in items:
                        group.create_task(limited(artifact))
        finally:
            folder_lease.release()
            profile_lease.release()


downloads = BatchDownloads()
