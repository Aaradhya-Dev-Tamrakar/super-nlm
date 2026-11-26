import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.config import load_user_catalog


class AccountProfile(BaseModel):
    id: str = Field(..., description="Unique profile identifier e.g. default, work, college")
    displayName: str = Field(..., description="User-friendly name e.g. Work / Acme")
    email: str = Field(default="", description="Google account email")
    tier: Literal["pro", "standard"] = Field(default="standard", description="Account tier: pro or standard")
    color: str = Field(default="#6366f1", description="Hex badge color")
    icon: str = Field(default="book-open", description="Lucide icon name")
    isDefaultPro: bool = Field(default=False, description="Whether this profile acts as the primary Pro AI engine")
    receiveAutoShare: bool = Field(default=True, description="Whether this profile automatically receives auto-shared study/course notebooks")
    status: Literal["connected", "expired", "not_logged_in", "checking"] = "checking"
    notebookCount: int = Field(default=0, description="Total notebooks found in this account")
    lastError: str | None = Field(default=None, description="Last error encountered when syncing or querying this account")
    lastAuthCheck: str | None = Field(default=None, description="ISO timestamp of last authentication check")

class ProfileCreateRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_\-\s]+$', description="Alphanumeric slug or name")
    displayName: str
    email: str | None = ""
    tier: Literal["pro", "standard"] = "standard"
    color: str | None = "#6366f1"
    icon: str | None = "book-open"
    isDefaultPro: bool | None = False
    receiveAutoShare: bool | None = True

class ProfileUpdateRequest(BaseModel):
    newId: str | None = None
    displayName: str | None = None
    email: str | None = None
    tier: Literal["pro", "standard"] | None = None
    color: str | None = None
    icon: str | None = None
    isDefaultPro: bool | None = None
    receiveAutoShare: bool | None = None

class NotebookSharingRule(BaseModel):
    notebook_id: str
    exclude_all: bool = Field(default=False, description="Skip automatic study-course sharing for this notebook across all accounts")
    exclude_profiles: list[str] = Field(default_factory=list, description="Profile IDs excluded from automatic sharing for this notebook")

_USER_CATALOG = load_user_catalog()
_PROJECT_NOTEBOOKS = _USER_CATALOG.get("project_notebooks", {})

# Known explicit course notebook IDs (loaded from user-local data/user_catalog.json)
COURSE_NOTEBOOK_IDS = set(_USER_CATALOG.get("course_notebook_ids", []))

# Canonical primary project notebook IDs (optional local overrides)
BIASAPERTURE_NOTEBOOK_ID = _PROJECT_NOTEBOOKS.get("biasaperture", "")
SPARK_NOTEBOOK_ID = _PROJECT_NOTEBOOKS.get("spark", "")
PERSONAL_NOTEBOOK_ID = _PROJECT_NOTEBOOKS.get("personal", "")
AERO_NOTEBOOK_ID = _PROJECT_NOTEBOOKS.get("aero", "")
ELECTIVE_I_NOTEBOOK_ID = _PROJECT_NOTEBOOKS.get("elective_i", "")

# Canonical default course notebook mapping (Course Code / Acronym -> Canonical Notebook ID)
DEFAULT_COURSE_NOTEBOOK_MAP = dict(_USER_CATALOG.get("default_course_notebook_map", {}))

# Regex pattern matching academic semester course codes e.g. "CT653", "EX751", "ME708", "EX725 04", "CT704"
COURSE_CODE_REGEX = re.compile(r'^([A-Z]{2,4}\s*\d{3}(?:\s*\d{2})?)\s*[-:]\s*(.+)', re.IGNORECASE)

def detect_course_info(title: str, notebook_id: str):
    """
    Detects if a notebook is a study course notebook and extracts its course code.
    Returns (is_study: bool, course_code: Optional[str], category: str).
    """
    if notebook_id in COURSE_NOTEBOOK_IDS:
        match = COURSE_CODE_REGEX.match(title.strip())
        code = match.group(1).upper() if match else title.split("-")[0].strip()
        return True, code, "study"

    match = COURSE_CODE_REGEX.match(title.strip())
    if match:
        return True, match.group(1).upper(), "study"

    return False, None, "general"

class Notebook(BaseModel):
    ownerEmail: str | None = None
    sharedWith: list[dict[str, Any]] | None = None
    id: str
    title: str
    source_count: int = 0
    updated_at: str | None = None
    profileId: str
    profileName: str
    profileEmail: str
    tier: str = "standard"
    color: str = "#6366f1"
    category: str | None = "general"
    is_study: bool | None = False
    course_code: str | None = None

    def model_post_init(self, __context):
        if not self.is_study or not self.course_code:
            is_study, course_code, cat = detect_course_info(self.title, self.id)
            if is_study:
                self.is_study = True
                self.course_code = course_code
                self.category = cat

class QueryRequest(BaseModel):
    notebookId: str
    profileId: str
    question: str
    conversationId: str | None = None

class NotebookRef(BaseModel):
    notebookId: str
    profileId: str
    title: str | None = None

class CrossQueryRequest(BaseModel):
    notebooks: list[NotebookRef]
    question: str
    synthesizerProfileId: str | None = None

class StudioRequest(BaseModel):
    notebookId: str
    profileId: str
    artifactType: Literal["audio", "video", "slides", "mindmap", "report", "quiz", "flashcards"]

class BatchShareRequest(BaseModel):
    notebookIds: list[str] = Field(..., min_length=1, description="List of notebook UUIDs to share")
    targetProfileIds: list[str] | None = Field(default=None, description="Target profile IDs. If omitted, shares with all other registered accounts.")
    role: Literal["editor", "viewer"] = Field(default="editor", description="Permission role to grant")
    autoSync: bool = Field(default=True, description="Whether to trigger notebook cache sync after sharing")

# ----------------- CALENDAR MODELS -----------------

class MatchedNotebookSummary(BaseModel):
    id: str
    title: str
    profile_id: str
    course_code: str | None = None
    color: str = "#6366f1"
    match_reason: str | None = None

class CalendarAgendaEvent(BaseModel):
    id: str
    summary: str
    start: str
    end: str
    all_day: bool = False
    location: str | None = ""
    description: str | None = ""
    is_today: bool = False
    is_upcoming: bool = False
    days_until: int = 0
    time_label: str = ""
    date_label: str = ""
    event_type: Literal["exam", "lab", "class", "general"] = "general"
    matched_notebook: MatchedNotebookSummary | None = None

class CalendarAgendaResponse(BaseModel):
    configured: bool
    calendar_email: str | None = ""
    last_synced: str | None = None
    today_count: int = 0
    upcoming_count: int = 0
    matched_count: int = 0
    today_events: list[CalendarAgendaEvent] = []
    upcoming_events: list[CalendarAgendaEvent] = []

# ----------------- USAGE & QUOTA LIMITS MODELS -----------------

class UsageWindow(BaseModel):
    window: str = Field(..., description="'rolling' or 'weekly'")
    percent_used: float = Field(default=0.0)
    percent_remaining: float = Field(default=100.0)
    resets_at: str | None = Field(default=None, description="ISO-8601 UTC reset timestamp")

class ProfileUsage(BaseModel):
    profile_id: str
    display_name: str
    email: str
    tier: str = "pro"
    color: str = "#81c995"
    is_default_pro: bool = False
    status: Literal["connected", "error", "expired"] = "connected"
    windows: list[UsageWindow] = []
    error: str | None = None
    fetched_at: str | None = None

class FleetUsageResponse(BaseModel):
    total_accounts: int = 0
    connected_accounts: int = 0
    average_rolling_used: float = 0.0
    healthy_count: int = 0
    warning_count: int = 0
    critical_count: int = 0
    profiles: list[ProfileUsage] = []
    fetched_at: str

# ----------------- SCHEDULED CREATION & QUEUE MODELS -----------------

class ScheduledJob(BaseModel):
    id: str = Field(..., description="Unique job UUID")
    notebook_id: str
    notebook_title: str
    assigned_profile_id: str | None = None
    preferred_profile_id: str | None = None
    artifact_type: Literal["video", "audio", "report", "quiz", "flashcards", "mindmap", "slides", "infographic", "data-table"] = "video"
    format_option: str | None = "cinematic"
    style: str | None = "auto_select"
    custom_prompt: str | None = None
    source_ids: list[str] | None = None
    exclude_sources: list[str] = Field(default_factory=list)
    batch_id: str | None = None
    request_key: str | None = None
    request_fingerprint: str | None = None
    submitted_at: str | None = None
    error_details: dict[str, Any] | None = None
    attempts: list[dict[str, Any]] = Field(default_factory=list)
    quantity: int | None = None
    difficulty: str | None = None
    status: Literal["queued", "scheduled", "in_progress", "completed", "failed", "download_failed", "cancelled"] = "queued"
    trigger_type: Literal["immediate", "next_reset_window", "custom_time", "calendar_event"] = "immediate"
    scheduled_time: str | None = None
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    artifact_id: str | None = None
    local_filepath: str | None = None
    download_filename: str | None = None
    error_message: str | None = None
    retry_count: int = 0
    rotation_wave: int | None = 1

class BatchScheduleRequest(BaseModel):
    notebook_ids: list[str] = Field(..., min_length=1, description="Target notebook IDs")
    artifact_type: Literal["video", "audio", "report", "quiz", "flashcards", "mindmap", "slides", "infographic", "data-table"] = "video"
    format_option: str | None = None
    style: str | None = "auto_select"
    custom_prompt: str | None = None
    source_ids: list[str] | None = None
    source_ids_by_notebook: dict[str, list[str]] = Field(default_factory=dict)
    exclude_sources: list[str] = Field(default_factory=list)
    prompts: list[str] = Field(default_factory=list)
    batch_id: str | None = None
    request_key: str | None = None
    quantity: int | None = None
    difficulty: str | None = None
    preferred_profile_id: str | None = None
    scheduled_time: str | None = None
    trigger_type: Literal["immediate", "next_reset_window", "custom_time", "calendar_event"] = "immediate"

class SingleScheduleRequest(BaseModel):
    notebook_id: str
    artifact_type: Literal["video", "audio", "report", "quiz", "flashcards", "mindmap", "slides", "infographic", "data-table"] = "video"
    format_option: str | None = None
    style: str | None = "auto_select"
    custom_prompt: str | None = None
    source_ids: list[str] | None = None
    exclude_sources: list[str] = Field(default_factory=list)
    batch_id: str | None = None
    request_key: str | None = None
    quantity: int | None = None
    difficulty: str | None = None
    preferred_profile_id: str | None = None
    scheduled_time: str | None = None
    trigger_type: Literal["immediate", "next_reset_window", "custom_time", "calendar_event"] = "immediate"

class BatchScheduleResponse(BaseModel):
    success: bool = True
    batch_id: str | None = None
    total_queued: int = 0
    queued_jobs: list[ScheduledJob] = []
    active_profiles: list[str] = []
    message: str = ""

class SchedulerStatusResponse(BaseModel):
    total_jobs: int = 0
    queued_count: int = 0
    in_progress_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    download_failed_count: int = 0
    active_workers: dict[str, str | None] = {}
    jobs: list[ScheduledJob] = []

# ----------------- HYBRID FOLDER MAPPING MODELS -----------------

class FolderMapping(BaseModel):
    notebook_id: str
    folder_type: Literal["local_folder", "drive_web"] = "local_folder"
    target_path: str = Field(..., description="Local path or Google Drive Web Folder URL/ID")
    display_name: str | None = ""
    last_scanned: str | None = None
    auto_sync: bool = False
    recursive: bool = False

class FolderFileItem(BaseModel):
    name: str
    path_or_id: str
    extension: str
    size_bytes: int | None = 0
    modified_at: str | None = None
    status: Literal["ingested", "new", "stale", "unsupported"] = "new"
    category: Literal["document", "media", "code", "spreadsheet", "unsupported"] = "document"
    source_id: str | None = None
    requires_code_adapter: bool = False
    detail: str | None = ""

class FolderMappingCreateRequest(BaseModel):
    target_path: str
    folder_type: Literal["local_folder", "drive_web"] | None = None
    display_name: str | None = ""
    auto_sync: bool | None = False
    recursive: bool | None = False

class FolderStatusResponse(BaseModel):
    notebook_id: str
    notebook_title: str
    profile_id: str
    tier: str = "pro"
    max_capacity: int = 300
    current_source_count: int = 0
    capacity_percent: float = 0.0
    mapping: FolderMapping | None = None
    files: list[FolderFileItem] = []
    new_count: int = 0
    ingested_count: int = 0
    stale_count: int = 0
    unsupported_count: int = 0

class FolderSyncRequest(BaseModel):
    action: Literal["ingest_new", "sync_stale", "full_sync"] = "ingest_new"
    selected_files: list[str] | None = None

class FolderSyncResponse(BaseModel):
    success: bool = True
    notebook_id: str
    ingested_count: int = 0
    stale_synced_count: int = 0
    failed_count: int = 0
    results: list[dict[str, Any]] = []
    message: str = ""
