import logging
import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from backend.config import FRONTEND_DIR, NLM_EXECUTABLE
from backend.models import (
    AccountProfile, ProfileCreateRequest, ProfileUpdateRequest,
    Notebook, QueryRequest, CrossQueryRequest
)
from backend.storage import (
    get_profiles, get_profile, save_profile, delete_profile,
    get_cached_notebooks, save_cached_notebooks
)
from backend.nlm_client import (
    get_cli_profiles, fetch_all_notebooks_concurrently,
    fetch_notebooks_for_profile, query_notebook,
    query_notebook_with_pro_fallback,
    synthesize_cross_notebook, launch_cli_login, delete_cli_profile,
    run_nlm_cmd
)

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
            if p.id in cli_profiles and cli_profiles[p.id]:
                p.email = cli_profiles[p.id]
                p.status = "connected"
                await save_profile(p)
        # Background initial sync of notebooks
        asyncio.create_task(sync_all_notebooks())
    except Exception as e:
        logger.error(f"Error during startup sync: {e}")
    yield
    logger.info("Shutting down Super-NLM Hub...")

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


async def sync_all_notebooks() -> List[Notebook]:
    """Helper to sync all notebooks across all profiles concurrently."""
    profiles = await get_profiles()
    cached = await get_cached_notebooks()
    result = await fetch_all_notebooks_concurrently(profiles, fallback_cached=cached)
    notebooks = result["notebooks"]
    for p in profiles:
        await save_profile(p)
    await save_cached_notebooks(notebooks)
    return notebooks

# ----------------- PROFILES API -----------------

@app.get("/api/profiles", response_model=List[AccountProfile])
async def list_profiles():
    cli_profiles = await get_cli_profiles()
    profiles = await get_profiles()
    for p in profiles:
        if p.id in cli_profiles and cli_profiles[p.id]:
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

    if req.displayName is not None:
        profile.displayName = req.displayName.strip()
    if req.email is not None:
        profile.email = req.email.strip()
    if req.tier is not None:
        profile.tier = req.tier
    if req.color is not None:
        profile.color = req.color
    if req.icon is not None:
        profile.icon = req.icon
    if req.isDefaultPro is not None:
        profile.isDefaultPro = req.isDefaultPro

    await save_profile(profile)

    # Synchronize cached notebooks metadata with updated profile
    try:
        cached_notebooks = await get_cached_notebooks()
        updated_any = False
        for n in cached_notebooks:
            if n.profileId == clean_id:
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

# ----------------- NOTEBOOKS API -----------------

@app.get("/api/notebooks", response_model=List[Notebook])
async def list_notebooks(
    search: Optional[str] = Query(None),
    profile_id: Optional[str] = Query(None),
    tier: Optional[str] = Query(None)
):
    notebooks = await get_cached_notebooks()

    if profile_id and profile_id != "all":
        notebooks = [n for n in notebooks if n.profileId == profile_id]

    if tier and tier != "all":
        notebooks = [n for n in notebooks if n.tier == tier]

    if search:
        s = search.lower().strip()
        notebooks = [n for n in notebooks if s in n.title.lower() or s in n.profileName.lower() or s in n.profileEmail.lower()]

    return notebooks

@app.post("/api/notebooks/sync", response_model=List[Notebook])
async def sync_notebooks():
    notebooks = await sync_all_notebooks()
    return notebooks

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

    res = await query_notebook_with_pro_fallback(
        profile_id=req.profileId,
        notebook_id=req.notebookId,
        question=req.question,
        conversation_id=req.conversationId,
        pro_profile_id=pro_profile_id,
        pro_email=pro_email
    )
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
