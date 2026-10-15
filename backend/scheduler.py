import asyncio
import datetime
import hashlib
import json
import logging
import os
import re
import time
import uuid
from typing import Dict, List, Optional

from backend.artifact_files import ArtifactCatalog
from backend.config import DOWNLOADS_DIR, SCHEDULED_JOBS_FILE
from backend.models import (
    AccountProfile,
    BatchScheduleRequest,
    BatchScheduleResponse,
    ScheduledJob,
    SchedulerStatusResponse,
    SingleScheduleRequest,
)
from backend.nlm_client import (
    create_studio_artifact,
    download_studio_artifact,
    ensure_notebook_shared,
    is_rate_limit_or_quota_error,
)
from backend.process_lease import ProcessLease
from backend.storage import get_cached_notebooks, get_profiles
from backend.studio_service import (
    StudioCommandError,
    artifacts,
    diagnostic,
    parse_payload,
    source_scope,
)
from mcp_server.rotator import rotator

logger = logging.getLogger("super_nlm.scheduler")

def sanitize_filename(name: str) -> str:
    """Sanitizes strings for safe local file saving."""
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = re.sub(r'\s+', "_", cleaned)
    return cleaned[:100].strip("._")

class JobScheduler:
    """
    Autonomous background scheduler and batch queue manager for Super-NLM.
    Handles queueing, fleet account rotation, 5-hour rolling reset window tracking,
    auto-sharing, status polling, and streaming artifact downloads.
    """

    def __init__(self):
        self._jobs: Dict[str, ScheduledJob] = {}
        self._active_workers: Dict[str, Optional[str]] = {}  # profile_id -> job_id
        self._lock = asyncio.Lock()
        self._dispatch_lock = asyncio.Lock()
        self._execution_tasks: set[asyncio.Task] = set()
        self._worker_task: Optional[asyncio.Task] = None
        self._running: bool = False
        self.dispatch_paused = False
        self._lease = None

    def _ensure_owner(self):
        if self._lease and self._lease.handle:
            return
        lease = ProcessLease(SCHEDULED_JOBS_FILE.with_suffix(".lock"))
        if not lease.acquire():
            raise RuntimeError("Scheduler is owned by another web/MCP process; use its interface for queue mutations")
        self._lease = lease
        self.load_jobs_from_disk()

    def read_jobs(self):
        """Inspect persisted jobs without changing their generation state."""
        if not SCHEDULED_JOBS_FILE.exists():
            return []
        data = json.loads(SCHEDULED_JOBS_FILE.read_text(encoding="utf-8"))
        result = []
        for item in data:
            try:
                result.append(ScheduledJob(**item))
            except ValueError:
                continue
        return result

    def load_jobs_from_disk(self):
        """Loads persisted jobs from data/scheduled_jobs.json."""
        self._jobs.clear()
        if not SCHEDULED_JOBS_FILE.exists():
            return
        try:
            with open(SCHEDULED_JOBS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    for item in data:
                        try:
                            job = ScheduledJob(**item)
                            # A persisted artifact ID allows polling to resume without regeneration.
                            # Legacy running records without an ID need an explicit operator retry.
                            if job.status == "in_progress" and not job.artifact_id:
                                job.status = "failed"
                                job.error_message = "Submission state unknown after restart; inspect Studio before explicitly retrying"
                                job.error_details = {"stage": "restart_recovery", "message": job.error_message}
                            self._jobs[job.id] = job
                        except Exception as parse_err:
                            logger.warning(f"Skipping corrupted job record: {parse_err}")
            logger.info(f"Loaded {len(self._jobs)} scheduled jobs from disk.")
        except Exception as e:
            logger.error(f"Error loading scheduled jobs: {e}")

    def save_jobs_to_disk(self):
        """Persists jobs to data/scheduled_jobs.json."""
        if not self._lease or not self._lease.handle:
            return
        try:
            data = [job.model_dump() for job in self._jobs.values()]
            tmp_path = str(SCHEDULED_JOBS_FILE) + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, SCHEDULED_JOBS_FILE)
        except Exception as e:
            logger.error(f"Error saving scheduled jobs: {e}")
            try:
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass

    async def start(self):
        """Starts the background worker daemon."""
        async with self._lock:
            if self._running:
                return
            self._ensure_owner()
            self._running = True
            self._worker_task = asyncio.create_task(self._worker_loop())
            logger.info("Super-NLM JobScheduler background worker started.")

    async def stop(self):
        """Gracefully stops the background worker daemon."""
        async with self._lock:
            if not self._lease or not self._lease.handle:
                return
            self._running = False
            if self._worker_task:
                self._worker_task.cancel()
                try:
                    await self._worker_task
                except asyncio.CancelledError:
                    pass
            tasks = list(self._execution_tasks)
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            self._active_workers.clear()
            self.save_jobs_to_disk()
            if self._lease:
                self._lease.release()
            logger.info("Super-NLM JobScheduler stopped.")

    async def schedule_job(self, req: SingleScheduleRequest, notebook_title: str) -> ScheduledJob:
        """Schedules a single creation job."""
        self._ensure_owner()
        fingerprint = hashlib.sha256(json.dumps(req.model_dump(exclude={"request_key", "batch_id"}), sort_keys=True).encode()).hexdigest()
        if req.request_key:
            existing = next((j for j in self._jobs.values() if j.request_key == req.request_key), None)
            if existing:
                if existing.request_fingerprint != fingerprint:
                    raise ValueError("request_key already belongs to a different generation request")
                return existing
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        job_id = str(uuid.uuid4())
        
        status = "queued"
        scheduled_time = req.scheduled_time or now_iso
        if req.trigger_type == "custom_time" and req.scheduled_time:
            status = "scheduled"

        job = ScheduledJob(
            id=job_id,
            notebook_id=req.notebook_id,
            notebook_title=notebook_title,
            assigned_profile_id=req.preferred_profile_id,
            preferred_profile_id=req.preferred_profile_id,
            artifact_type=req.artifact_type,
            format_option=req.format_option,
            style=req.style,
            custom_prompt=req.custom_prompt,
            source_ids=req.source_ids,
            exclude_sources=req.exclude_sources,
            batch_id=req.batch_id,
            request_key=req.request_key,
            request_fingerprint=fingerprint,
            quantity=req.quantity,
            difficulty=req.difficulty,
            status=status,
            trigger_type=req.trigger_type,
            scheduled_time=scheduled_time,
            created_at=now_iso,
            rotation_wave=1
        )

        async with self._lock:
            self._jobs[job_id] = job
            self.save_jobs_to_disk()

        logger.info(f"Scheduled new job {job_id} ({job.artifact_type}) for notebook '{notebook_title}'")
        return job

    async def schedule_batch(self, req: BatchScheduleRequest, notebooks_map: Dict[str, str]) -> BatchScheduleResponse:
        """
        Schedules a batch of creation jobs across multiple notebooks.
        Assigns initial rotation waves based on active fleet size.
        """
        self._ensure_owner()
        fingerprint = hashlib.sha256(json.dumps(req.model_dump(exclude={"request_key", "batch_id"}), sort_keys=True).encode()).hexdigest()
        if req.request_key:
            existing = [j for j in self._jobs.values() if j.request_key and j.request_key.startswith(req.request_key + ":")]
            if existing:
                if any(j.request_fingerprint != fingerprint for j in existing):
                    raise ValueError("request_key already belongs to a different generation request")
                return BatchScheduleResponse(batch_id=existing[0].batch_id, total_queued=len(existing), queued_jobs=existing, message="Existing batch reused")
        batch_id = req.batch_id or str(uuid.uuid4())
        expanded = [(nb, prompt) for nb in dict.fromkeys(req.notebook_ids) for prompt in (req.prompts or [req.custom_prompt])]
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        profiles = await get_profiles()
        fleet_size = max(1, len([p for p in profiles if p.status != "expired"]))

        queued_jobs: List[ScheduledJob] = []
        async with self._lock:
            for idx, (nb_id, prompt) in enumerate(expanded):
                job_id = str(uuid.uuid4())
                nb_title = notebooks_map.get(nb_id, f"Notebook {nb_id[:8]}")
                wave = (idx // fleet_size) + 1

                job = ScheduledJob(
                    id=job_id,
                    notebook_id=nb_id,
                    notebook_title=nb_title,
                    assigned_profile_id=req.preferred_profile_id,
                    preferred_profile_id=req.preferred_profile_id,
                    artifact_type=req.artifact_type,
                    format_option=req.format_option,
                    style=req.style,
                    custom_prompt=prompt.replace("{notebook_title}", nb_title) if prompt else None,
                    source_ids=req.source_ids_by_notebook.get(nb_id, req.source_ids),
                    exclude_sources=req.exclude_sources,
                    batch_id=batch_id,
                    request_key=f"{req.request_key}:{idx}" if req.request_key else None,
                    request_fingerprint=fingerprint,
                    quantity=req.quantity,
                    difficulty=req.difficulty,
                    status="queued",
                    trigger_type=req.trigger_type,
                    scheduled_time=req.scheduled_time or now_iso,
                    created_at=now_iso,
                    rotation_wave=wave
                )
                self._jobs[job_id] = job
                queued_jobs.append(job)

            self.save_jobs_to_disk()

        msg = f"Queued {len(queued_jobs)} {req.artifact_type} generation(s) across {fleet_size} account(s) in {(len(queued_jobs) + fleet_size - 1) // fleet_size} rotation wave(s)."
        logger.info(f"[Batch Schedule] {msg}")

        return BatchScheduleResponse(
            success=True,
            batch_id=batch_id,
            total_queued=len(queued_jobs),
            queued_jobs=queued_jobs,
            active_profiles=[p.id for p in profiles],
            message=msg
        )

    def get_jobs(self, status_filter: Optional[str] = None) -> List[ScheduledJob]:
        """Returns sorted list of jobs (newest created first)."""
        jobs = list(self._jobs.values()) if self._lease and self._lease.handle else self.read_jobs()
        if status_filter:
            jobs = [j for j in jobs if j.status == status_filter]
        jobs.sort(key=lambda x: x.created_at, reverse=True)
        return jobs

    def get_job(self, job_id: str) -> Optional[ScheduledJob]:
        return self._jobs.get(job_id)

    async def cancel_job(self, job_id: str) -> bool:
        """Cancels a queued or scheduled job."""
        self._ensure_owner()
        async with self._lock:
            if job_id in self._jobs and self._jobs[job_id].status in ("queued", "scheduled"):
                self._jobs[job_id].status = "cancelled"
                self.save_jobs_to_disk()
                logger.info(f"Cancelled job {job_id}")
                return True
        return False

    async def delete_job(self, job_id: str) -> bool:
        """Deletes a job from history."""
        self._ensure_owner()
        async with self._lock:
            if job_id in self._jobs and self._jobs[job_id].status != "in_progress" and job_id not in self._active_workers.values():
                del self._jobs[job_id]
                self.save_jobs_to_disk()
                return True
        return False

    async def run_job_now(self, job_id: str) -> bool:
        """Forces a queued, scheduled, cancelled, failed, or download-failed job to run immediately."""
        self._ensure_owner()
        async with self._lock:
            if job_id in self._jobs and self._jobs[job_id].status in (
                "queued", "scheduled", "failed", "download_failed", "cancelled"
            ):
                now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                self._jobs[job_id].status = "queued"
                self._jobs[job_id].scheduled_time = now_iso
                self._jobs[job_id].trigger_type = "immediate"
                self._jobs[job_id].error_message = None
                if not self._jobs[job_id].artifact_id:
                    self._jobs[job_id].assigned_profile_id = self._jobs[job_id].preferred_profile_id
                if self._jobs[job_id].error_details and self._jobs[job_id].error_details.get("stage") == "generation":
                    self._jobs[job_id].artifact_id = None
                    self._jobs[job_id].submitted_at = None
                elif self._jobs[job_id].submitted_at and not self._jobs[job_id].artifact_id:
                    self._jobs[job_id].submitted_at = None
                self.save_jobs_to_disk()
                logger.info(f"Forced immediate execution for job {job_id}")
                return True
        return False

    def get_status(self) -> SchedulerStatusResponse:
        """Returns fleet queue summary and active worker state."""
        jobs = list(self._jobs.values()) if self._lease and self._lease.handle else self.read_jobs()
        queued = sum(1 for j in jobs if j.status in ("queued", "scheduled"))
        in_prog = sum(1 for j in jobs if j.status == "in_progress")
        comp = sum(1 for j in jobs if j.status == "completed")
        failed = sum(1 for j in jobs if j.status == "failed")
        download_failed = sum(1 for j in jobs if j.status == "download_failed")

        return SchedulerStatusResponse(
            total_jobs=len(jobs),
            queued_count=queued,
            in_progress_count=in_prog,
            completed_count=comp,
            failed_count=failed,
            download_failed_count=download_failed,
            active_workers=dict(self._active_workers),
            jobs=sorted(jobs, key=lambda job: job.created_at, reverse=True)
        )

    def get_status_summary(self) -> SchedulerStatusResponse:
        return self.get_status()

    # ----------------- ROTATING WORKER LOOP -----------------

    async def _worker_loop(self):
        """
        Main worker tick. Inspects queue, manages multi-account availability,
        and triggers generation tasks concurrently across fleet accounts.
        """
        while self._running:
            try:
                await self._process_queue_tick()
            except Exception as e:
                logger.error(f"[cheduler Worker] Unexpected error in tick: {e}", exc_info=True)
            await asyncio.sleep(12)

    async def _process_queue_tick(self):
        # Explicit run-now requests can overlap the periodic worker tick.
        async with self._dispatch_lock:
            await self._dispatch_due_jobs()

    async def _dispatch_due_jobs(self):
        if self.dispatch_paused:
            return
        now = datetime.datetime.now(datetime.timezone.utc)
        now_iso = now.isoformat()

        # Find pending jobs that are due
        pending_jobs: List[ScheduledJob] = []
        for job in self._jobs.values():
            if job.id in self._active_workers.values():
                continue
            if job.status in ("queued", "scheduled", "in_progress"):
                if not job.scheduled_time or job.scheduled_time <= now_iso:
                    pending_jobs.append(job)

        if not pending_jobs:
            return

        # Sort pending by creation time (FIFO)
        pending_jobs.sort(key=lambda j: j.created_at)

        # Get active connected profiles
        profiles = await rotator.get_active_profiles()
        if not profiles:
            return

        # Check which profiles are free (not running an active generation)
        free_profiles = [p for p in profiles if not self._active_workers.get(p.id)]

        for profile in free_profiles:
            if not pending_jobs:
                break

            # Check if this profile is currently cooling down
            cooldown_info = rotator._cooldowns.get(profile.id)
            if cooldown_info and time.time() < cooldown_info["expires_at"]:
                continue

            # Find matching job: prefer job assigned specifically to this profile, or first unassigned/flexible job
            matched_job_idx = None
            for idx, job in enumerate(pending_jobs):
                if job.preferred_profile_id and job.preferred_profile_id != profile.id:
                    continue
                if job.assigned_profile_id == profile.id:
                    matched_job_idx = idx
                    break
                elif not job.assigned_profile_id:
                    matched_job_idx = idx
                    break
                else:
                    # If job prefers another profile, check if that preferred profile is available
                    pref = next((p for p in free_profiles if p.id == job.assigned_profile_id), None)
                    if not pref or (pref.id in rotator._cooldowns and time.time() < rotator._cooldowns[pref.id]["expires_at"]):
                        matched_job_idx = idx
                        break

            if matched_job_idx is None:
                continue

            job = pending_jobs.pop(matched_job_idx)

            # Mark worker busy and dispatch execution task
            self._active_workers[profile.id] = job.id
            task = asyncio.create_task(self._execute_job(job, profile))
            self._execution_tasks.add(task)
            task.add_done_callback(self._execution_tasks.discard)

    @property
    def running(self) -> bool:
        return self._running and self._worker_task is not None and not self._worker_task.done()

    async def dispatch_now(self):
        """Start the daemon if necessary and dispatch due jobs within fleet capacity."""
        await self.start()
        await self._process_queue_tick()
        # Let reserved execution tasks update their durable job state.
        await asyncio.sleep(0)

    async def _execute_job(self, job: ScheduledJob, profile: AccountProfile):
        """Submit once, poll the exact artifact, and preserve every failure attempt."""
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        job.status = "in_progress"
        job.assigned_profile_id = profile.id
        job.started_at = job.started_at or now_iso
        job.error_message = None
        job.error_details = None
        attempt = {"at": now_iso, "profile_id": profile.id, "artifact_id": job.artifact_id}
        job.attempts.append(attempt)
        self.save_jobs_to_disk()
        stage = "preflight"
        try:
            if not job.artifact_id:
                if job.submitted_at:
                    raise ValueError("A submission was accepted without an artifact ID; inspect Studio before retrying")
                cached = await get_cached_notebooks()
                associated = [n.profileId for n in cached if n.id == job.notebook_id]
                stage = "source_lookup"
                try:
                    job.source_ids = await source_scope(job.notebook_id, profile.id, job.source_ids, job.exclude_sources)
                except StudioCommandError as access_error:
                    if profile.id in associated or not associated:
                        raise
                    attempt["initial_access_error"] = access_error.details
                    stage = "sharing"
                    if not await ensure_notebook_shared(job.notebook_id, associated[0], profile.email):
                        raise ValueError("Invitation did not confirm access; inspect sharing status before generation")
                    stage = "source_lookup"
                    job.source_ids = await source_scope(job.notebook_id, profile.id, job.source_ids, job.exclude_sources)
                stage = "creation"
                submission = asyncio.create_task(create_studio_artifact(
                    profile_id=profile.id, notebook_id=job.notebook_id,
                    artifact_type=job.artifact_type, format_option=job.format_option,
                    style=job.style, custom_prompt=job.custom_prompt,
                    quantity=job.quantity, difficulty=job.difficulty, source_ids=job.source_ids,
                ))
                interrupted = False
                try:
                    result = await asyncio.shield(submission)
                except asyncio.CancelledError:
                    # Finish recording the remote response before yielding ownership.
                    result = await submission
                    interrupted = True
                payload = parse_payload(result.get("stdout", ""))
                if not result.get("success") or (isinstance(payload, dict) and payload.get("status") == "error"):
                    details = diagnostic(result, stage, job.notebook_id, "default")
                    if is_rate_limit_or_quota_error(str(details["message"])):
                        rotator.record_rate_limit(profile.id, str(details["message"]))
                        job.retry_count += 1
                        if not job.preferred_profile_id:
                            job.assigned_profile_id = None
                        job.status = "queued" if job.retry_count <= 3 else "failed"
                        job.error_message = str(details["message"])
                        job.error_details = details
                        attempt.update(status=job.status, error=details)
                        return
                    raise StudioCommandError(details)
                job.submitted_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
                job.artifact_id = (payload.get("artifact_id") or payload.get("id") or payload.get("mind_map_id")) if isinstance(payload, dict) else None
                attempt["artifact_id"] = job.artifact_id
                self.save_jobs_to_disk()
                if not job.artifact_id:
                    raise StudioCommandError({**diagnostic(result, stage, job.notebook_id, profile.id),
                                              "message": "Submission returned no artifact ID; automatic regeneration is blocked"})
                if interrupted:
                    raise asyncio.CancelledError()
            stage = "studio_poll"
            found = None
            for _ in range(240):
                current = await artifacts(job.notebook_id, profile.id)
                found = next((a for a in current if a.get("id") == job.artifact_id), None)
                if found and found.get("status") == "failed":
                    raise StudioCommandError({"stage": "generation", "notebook_id": job.notebook_id,
                        "profile_id": profile.id, "artifact_id": job.artifact_id,
                        "message": found.get("error_reason") or "NotebookLM reported a failed artifact without a cause"})
                if found and found.get("status") in ("completed", "ready", "done", "success"):
                    break
                await asyncio.sleep(15)
            else:
                raise ValueError("Polling timed out; retry this job to resume checking the same artifact")
            stage = "download"
            extension = {"video": ".mp4", "audio": ".m4a", "report": ".md", "slides": ".pdf",
                         "infographic": ".png", "mindmap": ".json", "quiz": ".md",
                         "flashcards": ".md", "data-table": ".csv"}[job.artifact_type]
            DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
            name_lease = ProcessLease(DOWNLOADS_DIR / ".super-nlm.lock")
            while not name_lease.acquire():
                await asyncio.sleep(1)
            try:
                catalog = ArtifactCatalog(DOWNLOADS_DIR, SCHEDULED_JOBS_FILE.parent)
                output, _ = catalog.prepare(job.artifact_id, found.get("title") or job.notebook_title, extension, job.local_filepath)
                filename = output.name
                if not output.exists() or not output.stat().st_size:
                    temporary = output.with_name(output.stem + ".partial" + output.suffix)
                    result = await download_studio_artifact("default", job.notebook_id, job.artifact_type,
                                                           job.artifact_id, str(temporary))
                    if not result.get("success") or not temporary.exists() or not temporary.stat().st_size:
                        details = diagnostic(result, stage, job.notebook_id, "default")
                        if result.get("success"):
                            details["message"] = "Download returned success without a nonempty output file"
                        raise StudioCommandError(details)
                    temporary.replace(output)
                job.local_filepath = str(output)
                job.download_filename = filename
            finally:
                name_lease.release()
            job.completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            job.status = "completed"
            attempt["status"] = "completed"
        except asyncio.CancelledError:
            job.status = "in_progress" if job.artifact_id else "failed" if job.submitted_at else "queued"
            if job.status == "queued":
                job.started_at = None
                job.retry_count += 1
            attempt["status"] = "interrupted"
            raise
        except Exception as error:
            details = getattr(error, "details", {"stage": stage, "profile_id": profile.id,
                              "notebook_id": job.notebook_id, "message": str(error)})
            job.status = "download_failed" if stage == "download" else "failed"
            job.error_message = str(error)
            job.error_details = details
            job.completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            attempt.update(status=job.status, error=details)
            logger.error("Job %s failed at %s: %s", job.id, stage, error)
        finally:
            if profile.id in self._active_workers:
                self._active_workers[profile.id] = None
            self.save_jobs_to_disk()

scheduler = JobScheduler()
