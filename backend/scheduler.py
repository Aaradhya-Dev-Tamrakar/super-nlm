import asyncio
import datetime
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from backend.config import SCHEDULED_JOBS_FILE, DOWNLOADS_DIR
from backend.models import (
    ScheduledJob, BatchScheduleRequest, SingleScheduleRequest,
    BatchScheduleResponse, SchedulerStatusResponse, AccountProfile
)
from backend.storage import get_profiles, get_cached_notebooks
from backend.nlm_client import (
    create_studio_artifact, get_studio_status, download_studio_artifact,
    ensure_notebook_shared, fetch_fleet_usage, is_rate_limit_or_quota_error,
    classify_quota_error
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
        self._worker_task: Optional[asyncio.Task] = None
        self._running: bool = False

    def load_jobs_from_disk(self):
        """Loads persisted jobs from data/scheduled_jobs.json."""
        if not SCHEDULED_JOBS_FILE.exists():
            return
        try:
            with open(SCHEDULED_JOBS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    for item in data:
                        try:
                            job = ScheduledJob(**item)
                            # If server restarted while in_progress, reset to queued so it retries
                            if job.status == "in_progress":
                                job.status = "queued"
                                job.started_at = None
                            self._jobs[job.id] = job
                        except Exception as parse_err:
                            logger.warning(f"Skipping corrupted job record: {parse_err}")
            logger.info(f"Loaded {len(self._jobs)} scheduled jobs from disk.")
        except Exception as e:
            logger.error(f"Error loading scheduled jobs: {e}")

    def save_jobs_to_disk(self):
        """Persists jobs to data/scheduled_jobs.json."""
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
            self.load_jobs_from_disk()
            self._running = True
            self._worker_task = asyncio.create_task(self._worker_loop())
            logger.info("Super-NLM JobScheduler background worker started.")

    async def stop(self):
        """Gracefully stops the background worker daemon."""
        async with self._lock:
            self._running = False
            if self._worker_task:
                self._worker_task.cancel()
                try:
                    await self._worker_task
                except asyncio.CancelledError:
                    pass
            self.save_jobs_to_disk()
            logger.info("Super-NLM JobScheduler stopped.")

    async def schedule_job(self, req: SingleScheduleRequest, notebook_title: str) -> ScheduledJob:
        """Schedules a single creation job."""
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
            artifact_type=req.artifact_type,
            format_option=req.format_option,
            style=req.style,
            custom_prompt=req.custom_prompt,
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
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        profiles = await get_profiles()
        fleet_size = max(1, len([p for p in profiles if p.status != "expired"]))

        queued_jobs: List[ScheduledJob] = []
        async with self._lock:
            for idx, nb_id in enumerate(req.notebook_ids):
                job_id = str(uuid.uuid4())
                nb_title = notebooks_map.get(nb_id, f"Notebook {nb_id[:8]}")
                wave = (idx // fleet_size) + 1

                job = ScheduledJob(
                    id=job_id,
                    notebook_id=nb_id,
                    notebook_title=nb_title,
                    assigned_profile_id=req.preferred_profile_id,
                    artifact_type=req.artifact_type,
                    format_option=req.format_option,
                    style=req.style,
                    custom_prompt=req.custom_prompt,
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

        msg = f"Queued {len(queued_jobs)} {req.artifact_type} generation(s) across {fleet_size} account(s) in {len(queued_jobs) // fleet_size + 1} rotation wave(s)."
        logger.info(f"[Batch Schedule] {msg}")

        return BatchScheduleResponse(
            success=True,
            total_queued=len(queued_jobs),
            queued_jobs=queued_jobs,
            active_profiles=[p.id for p in profiles],
            message=msg
        )

    def get_jobs(self, status_filter: Optional[str] = None) -> List[ScheduledJob]:
        """Returns sorted list of jobs (newest created first)."""
        jobs = list(self._jobs.values())
        if status_filter:
            jobs = [j for j in jobs if j.status == status_filter]
        jobs.sort(key=lambda x: x.created_at, reverse=True)
        return jobs

    def get_job(self, job_id: str) -> Optional[ScheduledJob]:
        return self._jobs.get(job_id)

    async def cancel_job(self, job_id: str) -> bool:
        """Cancels a queued or scheduled job."""
        async with self._lock:
            if job_id in self._jobs and self._jobs[job_id].status in ("queued", "scheduled"):
                self._jobs[job_id].status = "cancelled"
                self.save_jobs_to_disk()
                logger.info(f"Cancelled job {job_id}")
                return True
        return False

    async def delete_job(self, job_id: str) -> bool:
        """Deletes a job from history."""
        async with self._lock:
            if job_id in self._jobs:
                del self._jobs[job_id]
                self.save_jobs_to_disk()
                return True
        return False

    async def run_job_now(self, job_id: str) -> bool:
        """Forces a queued, scheduled, cancelled, failed, or download-failed job to run immediately."""
        async with self._lock:
            if job_id in self._jobs and self._jobs[job_id].status in (
                "queued", "scheduled", "failed", "download_failed", "cancelled"
            ):
                now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                self._jobs[job_id].status = "queued"
                self._jobs[job_id].scheduled_time = now_iso
                self._jobs[job_id].trigger_type = "immediate"
                self._jobs[job_id].error_message = None
                self.save_jobs_to_disk()
                logger.info(f"Forced immediate execution for job {job_id}")
                return True
        return False

    def get_status(self) -> SchedulerStatusResponse:
        """Returns fleet queue summary and active worker state."""
        jobs = list(self._jobs.values())
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
            jobs=self.get_jobs()
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
        now = datetime.datetime.now(datetime.timezone.utc)
        now_iso = now.isoformat()

        # Find pending jobs that are due
        pending_jobs: List[ScheduledJob] = []
        for job in self._jobs.values():
            if job.status in ("queued", "scheduled"):
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
            asyncio.create_task(self._execute_job(job, profile))

    async def _execute_job(self, job: ScheduledJob, profile: AccountProfile):
        """
        Executes a studio artifact creation job on a specific profile.
        Handles auto-sharing, CLI invocation, status polling, and automatic downloading.
        """
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        job.status = "in_progress"
        job.assigned_profile_id = profile.id
        job.started_at = now_iso
        job.error_message = None
        self.save_jobs_to_disk()

        logger.info(f"[Scheduler Executing] Job {job.id} ({job.artifact_type}) on profile '{profile.id}' ({profile.email})")

        try:
            # 1. Ensure notebook is shared with this profile if it was created on another account
            if profile.email:
                try:
                    await ensure_notebook_shared(job.notebook_id, profile.email)
                except Exception as share_err:
                    logger.debug(f"Auto-share check on '{job.notebook_id}': {share_err}")

            # 2. Dispatch creation command
            res = await create_studio_artifact(
                profile_id=profile.id,
                notebook_id=job.notebook_id,
                artifact_type=job.artifact_type,
                format_option=job.format_option,
                style=job.style,
                custom_prompt=job.custom_prompt,
                quantity=job.quantity,
                difficulty=job.difficulty
            )

            # 3. Check for immediate rate limit or failure
            if not res.get("success"):
                err_text = (res.get("stderr") or "") + " " + (res.get("stdout") or "")
                if is_rate_limit_or_quota_error(err_text):
                    logger.warning(f"[Scheduler Quota Hit] Profile '{profile.id}' hit quota: {err_text}")
                    rotator.record_rate_limit(profile.id, err_text)
                    # note job remains queued
                    job.status = "queued"
                    job.started_at = None
                    job.retry_count += 1
                    self.save_jobs_to_disk()
                    return
                else:
                    raise RuntimeError(f"Creation command failed: {err_text}")

            # 4. Background Polling for Artifact Readiness
            max_poll_seconds = 600
            poll_interval = 15
            elapsed = 0
            artifact_found = None

            while elapsed < max_poll_seconds:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

                artifacts = await get_studio_status(profile.id, job.notebook_id)
                for art in artifacts:
                    art_type = str(art.get("type", "")).lower()
                    art_status = str(art.get("status", "")).lower()
                    
                    if job.artifact_type in art_type or art_type in job.artifact_type:
                        if art_status in ("completed", "ready", "done", "success"):
                            artifact_found = art
                            break

                if artifact_found:
                    break

            # 5. Determine Artifact ID for Download
            art_id = artifact_found.get("id") if artifact_found else None
            ext_map = {
                "video": ".mp4",
                "audio": ".m4a",
                "report": ".md",
                "slides": ".pdf",
                "infographic": ".png",
                "mindmap": ".json",
                "quiz": ".md",
                "flashcards": ".md",
                "data-table": ".csv"
            }
            ext = ext_map.get(job.artifact_type, ".bin")
            safe_title = sanitize_filename(job.notebook_title)
            filename = f"{job.artifact_type}_{safe_title}_{job.id[:6]}{ext}"
            output_filepath = str(DOWNLOADS_DIR / filename)

            # 6. Stream Download the artifact
            download_ok = False
            try:
                dl_res = await download_studio_artifact(
                    profile_id=profile.id,
                    notebook_id=job.notebook_id,
                    artifact_type=job.artifact_type,
                    artifact_id=art_id,
                    output_filepath=output_filepath
                )
                if dl_res.get("success") and os.path.exists(output_filepath):
                    job.local_filepath = output_filepath
                    job.download_filename = filename
                    download_ok = True
            except Exception as dl_err:
                logger.warning(f"[Scheduler Download Error] Could not download {filename}: {dl_err}")

            # 7. Mark Job based on actual download outcome
            job.artifact_id = art_id
            job.completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            if download_ok:
                job.status = "completed"
                logger.info(f"[Scheduler Success] Job {job.id} ({job.artifact_type}) finished on '{profile.id}'!")
                try:
                    import winsound
                    winsound.MessageBeep(winsound.MB_ICONASTERISK)
                except Exception:
                    pass
            else:
                job.status = "download_failed"
                job.error_message = f"Artifact {art_id} generated but download did not complete successfully"
                logger.warning(f"[Scheduler Partial] Job {job.id}: artifact created but download failed on '{profile.id}'")

        except asyncio.CancelledError:
            # Cancellation is an interruption, not a terminal job failure. Leave
            # the durable queue in a retryable state before propagating cancellation.
            job.status = "queued"
            job.started_at = None
            job.retry_count += 1
            raise
        except Exception as e:
            logger.error(f"[Scheduler Job Error] Job {job.id} failed: {e}")
            job.status = "failed"
            job.error_message = str(e)
            job.completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        finally:
            # Free worker profile
            if profile.id in self._active_workers:
                self._active_workers[profile.id] = None
            self.save_jobs_to_disk()

scheduler = JobScheduler()
