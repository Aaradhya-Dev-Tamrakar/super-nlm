import logging
import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from backend.config import FRONTEND_DIR, NLM_EXECUTABLE, DOWNLOADS_DIR
from backend.models import (
    AccountProfile, ProfileCreateRequest, ProfileUpdateRequest,
    Notebook, QueryRequest, CrossQueryRequest, detect_course_info,
    BatchShareRequest, CalendarAgendaResponse,
    FleetUsageResponse, ProfileUsage,
    ScheduledJob, SingleScheduleRequest, BatchScheduleRequest,
    BatchScheduleResponse, SchedulerStatusResponse,
    FolderMapping, FolderMappingCreateRequest, FolderStatusResponse,
    FolderSyncRequest, FolderSyncResponse
)
from backend.calendar_service import calendar_service
from backend.storage import (
    get_profiles, get_profile, save_profile, delete_profile,
    get_cached_notebooks, save_cached_notebooks, delete_cached_notebook,
    get_folder_mappings, get_folder_mapping, save_folder_mapping, delete_folder_mapping
)
from backend.drive_sync_service import drive_sync_service, normalize_folder_target
from backend.nlm_client import (
    get_cli_profiles, fetch_all_notebooks_concurrently,
    fetch_notebooks_for_profile, query_notebook,
    query_notebook_with_pro_fallback,
    synthesize_cross_notebook, launch_cli_login, delete_cli_profile,
    rename_cli_profile,
    run_nlm_cmd, ensure_notebook_shared, batch_share_notebooks_to_accounts,
    auto_share_study_notebooks,
    fetch_profile_usage, fetch_fleet_usage,
    check_profile_auth_status
)
from mcp_server.rotator import rotator
from backend.scheduler import scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("super_nlm")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Super-NLM Hub...")
    # Sync profiles with CLI profile state
    try:
        cli_profiles = await get_cli_profiles()
        profiles = await get_profiles()
        for p in profiles:
            if not p.email and p.id in cli_profiles and cli_profiles[p.id]:
                p.email = cli_profiles[p.id]
                p.status = "connected"
                await save_profile(p)
        # Background initial sync of notebooks and auto-share study courses
        asyncio.create_task(sync_all_notebooks(auto_share_study=True))
        # Start the background job scheduler daemon
        await scheduler.start()
    except Exception as e:
        logger.error(f"Error during startup sync: {e}")
    yield
    logger.info("Shutting down Super-NLM Hub...")
    await scheduler.stop()

app = FastAPI(title="Super-Gemini Notebook", lifespan=lifespan)

import re

def validate_profile_id(pid: str) -> str:
    cleaned = pid.strip().lower().replace(" ", "-")
    if not re.match(r'^[a-zA-Z0-9_\-]{1,64}$', cleaned):
        raise HTTPException(status_code=400, detail=f"Invalid profile ID '{pid}'. Must be 1-64 alphanumeric characters, dashes, or underscores.")
    return cleaned

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def sync_all_notebooks(auto_share_study: bool = True) -> List[Notebook]:
    """Helper to sync all notebooks across all profiles concurrently and auto-share study courses."""
    profiles = await get_profiles()
    cached = await get_cached_notebooks()
    result = await fetch_all_notebooks_concurrently(profiles, fallback_cached=cached)
    notebooks = result["notebooks"]
    for n in notebooks:
        is_study, course_code, cat = detect_course_info(n.title, n.id)
        n.is_study = is_study
        n.course_code = course_code
        n.category = cat
    for p in profiles:
        await save_profile(p)
    await save_cached_notebooks(notebooks)

    if auto_share_study:
        try:
            # Asynchronously auto-share all detected study course notebooks across all profiles
            asyncio.create_task(auto_share_study_notebooks(notebooks))
        except Exception as e:
            logger.warning(f"Could not trigger background auto-share of study notebooks: {e}")

    return notebooks

# ----------------- PROFILES API -----------------

@app.get("/api/profiles", response_model=List[AccountProfile])
async def list_profiles():
    cli_profiles = await get_cli_profiles()
    profiles = await get_profiles()
    for p in profiles:
        if not p.email and p.id in cli_profiles and cli_profiles[p.id]:
            p.email = cli_profiles[p.id]
    return profiles

@app.post("/api/profiles", response_model=AccountProfile)
async def create_profile(req: ProfileCreateRequest, launch_login: bool = True):
    clean_id = validate_profile_id(req.id)
    existing = await get_profile(clean_id)
    if existing:
        raise HTTPException(status_code=400, detail=f"Profile '{clean_id}' already exists")

    profile = AccountProfile(
        id=clean_id,
        displayName=req.displayName.strip(),
        email=req.email.strip() if req.email else "",
        tier=req.tier,
        color=req.color or "#6366f1",
        icon=req.icon or "book-open",
        isDefaultPro=bool(req.isDefaultPro),
        status="not_logged_in"
    )
    await save_profile(profile)

    if launch_login:
        launch_cli_login(profile.id, clear=True)

    return profile

@app.put("/api/profiles/{profile_id}", response_model=AccountProfile)
async def update_profile(profile_id: str, req: ProfileUpdateRequest):
    clean_id = validate_profile_id(profile_id)
    profile = await get_profile(clean_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    target_id = clean_id
    if req.newId and req.newId.strip():
        new_clean_id = validate_profile_id(req.newId)
        if new_clean_id != clean_id:
            existing_target = await get_profile(new_clean_id)
            if existing_target:
                raise HTTPException(status_code=400, detail=f"Profile key '{new_clean_id}' already exists")

            # 1. Rename CLI profile if supported
            try:
                await rename_cli_profile(clean_id, new_clean_id)
            except Exception as e:
                logger.warning(f"Failed to rename CLI profile {clean_id} -> {new_clean_id}: {e}")

            # 2. Rename physical directory in ~/.notebooklm-mcp-cli/profiles if it exists
            try:
                p_dir = Path.home() / ".notebooklm-mcp-cli" / "profiles"
                old_dir = p_dir / clean_id
                new_dir = p_dir / new_clean_id
                if old_dir.exists() and not new_dir.exists():
                    old_dir.rename(new_dir)
            except Exception as e:
                logger.warning(f"Failed to rename profile directory {clean_id} -> {new_clean_id}: {e}")

            profile.id = new_clean_id
            target_id = new_clean_id

    if req.displayName is not None:
        profile.displayName = req.displayName.strip()
    if req.email is not None:
        profile.email = req.email.strip()
    if req.tier is not None:
        profile.tier = req.tier
        if req.tier == "standard" and req.isDefaultPro is None and profile.isDefaultPro:
            profile.isDefaultPro = False
    if req.color is not None:
        profile.color = req.color
    if req.icon is not None:
        profile.icon = req.icon
    if req.isDefaultPro is not None:
        profile.isDefaultPro = req.isDefaultPro
        if req.isDefaultPro:
            profile.tier = "pro"

    await save_profile(profile, old_id=clean_id if target_id != clean_id else None)

    # Synchronize cached notebooks metadata with updated profile
    try:
        cached_notebooks = await get_cached_notebooks()
        updated_any = False
        for n in cached_notebooks:
            if n.profileId == clean_id:
                n.profileId = target_id
                n.profileName = profile.displayName
                n.profileEmail = profile.email
                n.tier = profile.tier
                n.color = profile.color
                updated_any = True
        if updated_any:
            await save_cached_notebooks(cached_notebooks)
    except Exception as e:
        logger.warning(f"Failed to update cached notebook metadata for profile {clean_id}: {e}")

    return profile

@app.delete("/api/profiles/{profile_id}")
async def remove_profile(profile_id: str):
    clean_id = validate_profile_id(profile_id)
    profile = await get_profile(clean_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    await delete_profile(clean_id)
    try:
        await delete_cli_profile(clean_id)
    except Exception as e:
        logger.warning(f"Failed to delete CLI profile: {e}")

    # Remove cached notebooks belonging to this profile
    notebooks = await get_cached_notebooks()
    filtered = [n for n in notebooks if n.profileId != clean_id]
    await save_cached_notebooks(filtered)

    return {"success": True, "message": f"Profile '{clean_id}' removed"}

@app.post("/api/profiles/{profile_id}/login")
async def trigger_profile_login(profile_id: str, clear: bool = True):
    clean_id = validate_profile_id(profile_id)
    profile = await get_profile(clean_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    launch_cli_login(profile.id, clear=clear)
    return {"success": True, "message": f"Login window launched for '{profile.id}'"}

@app.get("/api/profiles/health")
async def get_profiles_health():
    """
    Returns summary of authentication and connectivity health across all account profiles.
    """
    profiles = await get_profiles()
    expired = [p for p in profiles if p.status in ("expired", "not_logged_in")]
    connected = [p for p in profiles if p.status == "connected"]
    
    return {
        "healthy": len(expired) == 0,
        "totalProfiles": len(profiles),
        "connectedCount": len(connected),
        "expiredCount": len(expired),
        "expiredProfiles": [
            {
                "id": p.id,
                "displayName": p.displayName,
                "email": p.email,
                "status": p.status,
                "lastError": p.lastError,
                "lastAuthCheck": p.lastAuthCheck
            }
            for p in expired
        ],
        "profiles": profiles
    }

@app.post("/api/profiles/{profile_id}/check-auth")
async def check_single_profile_auth(profile_id: str):
    """
    Probes authentication status for a specific profile, updates storage, and returns diagnostic results.
    """
    clean_id = validate_profile_id(profile_id)
    profile = await get_profile(clean_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{clean_id}' not found")

    res = await check_profile_auth_status(profile)
    await save_profile(profile)
    return res

# ----------------- USAGE & QUOTA LIMITS API -----------------

import time
from typing import Dict, Any

_fleet_usage_cache: Dict[str, Any] = {
    "data": None,
    "timestamp": 0.0
}
FLEET_USAGE_CACHE_TTL = 60.0  # seconds

@app.get("/api/usage", response_model=FleetUsageResponse)
async def get_fleet_usage(force_refresh: bool = Query(False, description="Force bypass cache and query nlm directly")):
    """
    Returns plan usage and quota limits across all registered Google accounts.
    Uses an in-memory 60s cache unless force_refresh is True.
    """
    now = time.time()
    if not force_refresh and _fleet_usage_cache["data"] and (now - _fleet_usage_cache["timestamp"] < FLEET_USAGE_CACHE_TTL):
        return _fleet_usage_cache["data"]

    profiles = await get_profiles()
    fleet_response = await fetch_fleet_usage(profiles)
    _fleet_usage_cache["data"] = fleet_response
    _fleet_usage_cache["timestamp"] = now
    return fleet_response

@app.get("/api/profiles/{profile_id}/usage", response_model=ProfileUsage)
async def get_single_profile_usage(profile_id: str):
    """
    Fetches real-time usage limits for a specific Google account profile.
    Also updates the profile in the cached fleet summary if present.
    """
    clean_id = validate_profile_id(profile_id)
    profile = await get_profile(clean_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{clean_id}' not found")

    usage = await fetch_profile_usage(profile)

    if _fleet_usage_cache["data"] and hasattr(_fleet_usage_cache["data"], "profiles"):
        updated_profiles = []
        for p in _fleet_usage_cache["data"].profiles:
            if p.profile_id == clean_id:
                updated_profiles.append(usage)
            else:
                updated_profiles.append(p)
        _fleet_usage_cache["data"].profiles = updated_profiles

    return usage

# ----------------- NOTEBOOKS API -----------------

@app.get("/api/notebooks", response_model=List[Notebook])
async def list_notebooks(
    search: Optional[str] = Query(None),
    profile_id: Optional[str] = Query(None),
    tier: Optional[str] = Query(None),
    category: Optional[str] = Query(None)
):
    notebooks = await get_cached_notebooks()

    # Enrich notebooks with study/course metadata
    for n in notebooks:
        is_study, course_code, cat = detect_course_info(n.title, n.id)
        n.is_study = is_study
        n.course_code = course_code
        n.category = cat

    if category and category.lower() != "all":
        cat_lower = category.lower().strip()
        if cat_lower in ("study", "courses", "course"):
            notebooks = [n for n in notebooks if n.is_study]
        elif cat_lower in ("projects", "project", "other"):
            notebooks = [n for n in notebooks if not n.is_study]

    if profile_id and profile_id != "all":
        notebooks = [n for n in notebooks if n.profileId == profile_id]

    if tier and tier != "all":
        notebooks = [n for n in notebooks if n.tier == tier]

    if search:
        s = search.lower().strip()
        notebooks = [
            n for n in notebooks
            if s in n.title.lower() or s in n.profileName.lower() or s in n.profileEmail.lower() or (n.course_code and s in n.course_code.lower())
        ]

    return notebooks

@app.post("/api/notebooks/sync", response_model=List[Notebook])
async def sync_notebooks():
    notebooks = await sync_all_notebooks()
    return notebooks

@app.post("/api/notebooks/batch-share")
async def batch_share_endpoint(req: BatchShareRequest, background_tasks: BackgroundTasks):
    """
    Batch shares multiple notebooks across target Google accounts.
    If targetProfileIds is omitted, shares with all other registered accounts.
    """
    res = await batch_share_notebooks_to_accounts(
        notebook_ids=req.notebookIds,
        target_profile_ids=req.targetProfileIds,
        role=req.role
    )
    if req.autoSync:
        background_tasks.add_task(sync_all_notebooks, False)
    return res

@app.post("/api/notebooks/auto-share-study")
async def auto_share_study_endpoint(background_tasks: BackgroundTasks, role: str = Query("editor", description="Role to grant: editor or viewer")):
    """
    Automatically detects all Study / Course notebooks and shares them
    across all configured Google accounts as editor/viewer.
    """
    cached = await get_cached_notebooks()
    res = await auto_share_study_notebooks(cached, role=role)
    background_tasks.add_task(sync_all_notebooks, False)
    return res

@app.delete("/api/notebooks/{notebook_id}")
async def delete_notebook_from_cache(notebook_id: str):
    """
    Deletes/purges a notebook from the local fleet cache across all profiles.
    """
    removed_count = await delete_cached_notebook(notebook_id)
    return {
        "success": True,
        "notebook_id": notebook_id,
        "removed_count": removed_count,
        "message": f"Successfully deleted notebook {notebook_id} from local cache ({removed_count} profile instances removed)."
    }

# ----------------- HYBRID FOLDER MAPPING & SYNC API -----------------

@app.get("/api/folders/mappings", response_model=Dict[str, FolderMapping])
async def list_all_folder_mappings():
    """Returns all active folder-to-notebook mappings for dashboard badge rendering."""
    return await get_folder_mappings()

@app.get("/api/notebooks/{notebook_id}/folder", response_model=FolderStatusResponse)
async def get_notebook_folder_status(notebook_id: str):
    """
    Returns the mapped folder status, diffed file list (ingested, new, stale, unsupported),
    and NotebookLM 300-source Pro capacity gauge.
    """
    return await drive_sync_service.get_folder_status(notebook_id)

@app.post("/api/notebooks/{notebook_id}/folder", response_model=FolderStatusResponse)
async def set_notebook_folder_mapping(notebook_id: str, req: FolderMappingCreateRequest):
    """
    Maps a local directory or Google Drive Web Folder URL/ID to a notebook.
    Automatically identifies folder type and performs initial status scan.
    """
    folder_type, target = normalize_folder_target(req.target_path)
    if req.folder_type:
        folder_type = req.folder_type

    mapping = FolderMapping(
        notebook_id=notebook_id,
        folder_type=folder_type,
        target_path=target,
        display_name=req.display_name.strip() if req.display_name else Path(target).name,
        auto_sync=bool(req.auto_sync),
        recursive=bool(req.recursive),
        last_scanned=datetime.now().isoformat()
    )
    await save_folder_mapping(mapping)
    return await drive_sync_service.get_folder_status(notebook_id)

@app.delete("/api/notebooks/{notebook_id}/folder")
async def remove_notebook_folder_mapping(notebook_id: str):
    """Unlinks the mapped folder from the specified notebook."""
    deleted = await delete_folder_mapping(notebook_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="No folder mapping found for this notebook.")
    return {"success": True, "notebook_id": notebook_id, "message": "Folder unlinked successfully."}

@app.post("/api/notebooks/{notebook_id}/folder/sync", response_model=FolderSyncResponse)
async def sync_notebook_folder(notebook_id: str, req: FolderSyncRequest):
    """
    Executes sequential ingestion of new folder files and refreshes stale Drive sources.
    Uses 1.5s delay between file uploads to protect against quota bursts.
    """
    return await drive_sync_service.sync_folder(
        notebook_id=notebook_id,
        action=req.action,
        selected_files=req.selected_files
    )

# ----------------- QUERY & SYNTHESIS API -----------------

@app.post("/api/query")
async def ask_notebook(req: QueryRequest):
    profile = await get_profile(req.profileId)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{req.profileId}' not found")

    # Locate the active default Pro profile for fallback
    pro_profile_id = None
    pro_email = None
    profiles = await get_profiles()
    for p in profiles:
        if p.isDefaultPro:
            pro_profile_id = p.id
            pro_email = p.email
            break

    # If the executing profile is not among the profiles known to have this notebook, auto-share
    cached_notebooks = await get_cached_notebooks()
    accessible_profiles = [n.profileId for n in cached_notebooks if n.id == req.notebookId]
    if accessible_profiles and req.profileId not in accessible_profiles:
        source_profile_id = accessible_profiles[0]
        if profile.email:
            try:
                logger.info(f"Auto-sharing notebook {req.notebookId} from '{source_profile_id}' with '{profile.email}' for query execution")
                await ensure_notebook_shared(req.notebookId, source_profile_id, profile.email)
            except Exception as e:
                logger.warning(f"Failed to auto-share notebook {req.notebookId} with {profile.email}: {e}")

    res = await query_notebook_with_pro_fallback(
        profile_id=req.profileId,
        notebook_id=req.notebookId,
        question=req.question,
        conversation_id=req.conversationId,
        pro_profile_id=pro_profile_id,
        pro_email=pro_email
    )
    res["executedProfileId"] = req.profileId
    return res

@app.post("/api/cross-query")
async def ask_cross_notebook(req: CrossQueryRequest):
    if not req.notebooks:
        raise HTTPException(status_code=400, detail="At least one notebook must be selected")

    # Determine synthesizer profile (default to the pro profile)
    synthesizer = req.synthesizerProfileId
    if not synthesizer:
        profiles = await get_profiles()
        for p in profiles:
            if p.isDefaultPro:
                synthesizer = p.id
                break
        if not synthesizer and profiles:
            synthesizer = profiles[0].id

    res = await synthesize_cross_notebook(req.notebooks, req.question, synthesizer)
    return res

@app.get("/api/rotation/status")
async def get_rotation_diagnostics():
    """Returns current query counter, per-profile statistics, and cooldown status."""
    return await rotator.get_status()

@app.get("/api/fleet/health")
async def get_fleet_health():
    """Returns proactive health, auth verification, and cooldown diagnostics across all fleet nodes."""
    return await rotator.check_all_profiles_health()

@app.get("/api/fleet/metrics")
async def get_fleet_metrics():
    """Returns real-time fleet utilization, in-flight concurrency, and Pro capacity metrics."""
    status = await rotator.get_status()
    total_nodes = status.get("total_profiles_in_pool", 0)
    total_inflight = status.get("total_inflight_queries", 0)
    max_concurrent_capacity = total_nodes * 2  # Recommended safe concurrency = 2 per node
    utilization_pct = round((total_inflight / max(1, max_concurrent_capacity)) * 100.0, 1)

    return {
        "total_nodes": total_nodes,
        "pro_fleet_size": status.get("pro_fleet_size", 0),
        "total_inflight_queries": total_inflight,
        "max_recommended_concurrent_capacity": max_concurrent_capacity,
        "fleet_utilization_percent": min(100.0, utilization_pct),
        "active_cooldowns_count": len(status.get("active_cooldowns", {})),
        "global_queries_served": status.get("global_query_counter", 0),
        "profiles": status.get("profiles", [])
    }

@app.post("/api/query/rotated")
async def ask_notebook_rotated(
    notebook_id: str = Query(..., description="Target notebook UUID"),
    question: str = Query(..., description="Question to ask"),
    conversation_id: Optional[str] = Query(None, description="Optional conversation ID for multi-turn chat"),
    source_ids: Optional[str] = Query(None, description="Optional comma-separated source IDs"),
    timeout: int = Query(120, description="Query timeout in seconds"),
    new_conversation: bool = Query(False, description="Start fresh conversation"),
    use_pro: Optional[bool] = Query(None, description="Directly route to Pro account without rotation")
):
    """
    Queries a notebook with automatic multi-account round-robin rotation, auto-sharing,
    and automatic cooldown fallback if rate-limited. If use_pro is True (or if query mentions 'pro'),
    bypasses rotation and routes directly to the primary Pro AI account.
    """
    return await rotator.execute_query_rotated(
        notebook_id=notebook_id,
        question=question,
        conversation_id=conversation_id,
        source_ids=source_ids,
        timeout=timeout,
        new_conversation=new_conversation,
        require_pro=use_pro
    )

# ----------------- CALENDAR & AGENDA API -----------------

@app.get("/api/calendar/agenda", response_model=CalendarAgendaResponse)
async def get_calendar_agenda(days: int = Query(7, ge=1, le=30, description="Days ahead to retrieve events")):
    """
    Returns today's and upcoming events from Google Calendar iCal feed,
    with smart automatic matching against user course and study notebooks.
    """
    notebooks = await get_cached_notebooks()
    return await calendar_service.get_agenda(notebooks, days=days, force_refresh=False)

@app.post("/api/calendar/refresh", response_model=CalendarAgendaResponse)
async def refresh_calendar_agenda(days: int = Query(7, ge=1, le=30, description="Days ahead to retrieve events")):
    """
    Forces a cache bypass and fetches the latest Google Calendar iCal feed.
    """
    notebooks = await get_cached_notebooks()
    return await calendar_service.get_agenda(notebooks, days=days, force_refresh=True)

# ----------------- SCHEDULED CREATION & BATCH QUEUE API -----------------

@app.post("/api/scheduler/batch", response_model=BatchScheduleResponse)
async def schedule_batch_creation(req: BatchScheduleRequest):
    """
    Schedules a batch of studio creations (e.g. cinematic videos, audio overviews, study guides)
    across multiple notebooks. Jobs are queued and executed round-robin across connected fleet accounts.
    """
    cached = await get_cached_notebooks()
    nb_map = {n.id: n.title for n in cached}
    return await scheduler.schedule_batch(req, nb_map)

@app.post("/api/scheduler/job", response_model=ScheduledJob)
async def schedule_single_creation(req: SingleScheduleRequest):
    """
    Schedules a single creation job (immediately, off-peak, or at a custom time).
    """
    cached = await get_cached_notebooks()
    nb_title = next((n.title for n in cached if n.id == req.notebook_id), f"Notebook {req.notebook_id[:8]}")
    return await scheduler.schedule_job(req, nb_title)

@app.get("/api/scheduler/jobs", response_model=List[ScheduledJob])
async def list_scheduled_jobs(status: Optional[str] = Query(None, description="Filter by status (queued, scheduled, in_progress, completed, failed, download_failed, cancelled)")):
    """
    Lists all creation jobs with optional status filter.
    """
    return scheduler.get_jobs(status_filter=status)

@app.get("/api/scheduler/status", response_model=SchedulerStatusResponse)
async def get_scheduler_status():
    """
    Returns live summary of the rotating fleet queue, active workers, and job counts.
    """
    return scheduler.get_status()

@app.post("/api/scheduler/jobs/{job_id}/run-now")
async def run_job_now(job_id: str):
    """
    Forces a queued/scheduled/failed/download_failed job to execute immediately.
    """
    success = await scheduler.run_job_now(job_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found or cannot be triggered immediately.")
    return {"success": True, "message": f"Job '{job_id}' marked for immediate execution."}

@app.post("/api/scheduler/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """
    Cancels a pending queued or scheduled creation job.
    """
    success = await scheduler.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Job '{job_id}' cannot be cancelled.")
    return {"success": True, "message": f"Job '{job_id}' cancelled."}

@app.delete("/api/scheduler/jobs/{job_id}")
async def delete_job(job_id: str):
    """
    Deletes a job from history.
    """
    success = await scheduler.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return {"success": True, "message": f"Job '{job_id}' deleted."}

@app.get("/api/scheduler/downloads/{filename}")
async def download_file(filename: str):
    """
    Serves a downloaded studio artifact file from the local downloads/ directory.
    """
    file_path = DOWNLOADS_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found in downloads.")
    return FileResponse(file_path, filename=filename)

# ----------------- STATIC FRONTEND -----------------

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        # Standard HTTP 204 No Content with strictly empty body
        return Response(status_code=204)

    @app.get("/")
    async def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")
