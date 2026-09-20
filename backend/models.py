from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any

class AccountProfile(BaseModel):
    id: str = Field(..., description="Unique profile identifier e.g. default, work, college")
    displayName: str = Field(..., description="User-friendly name e.g. Work / Acme")
    email: str = Field(default="", description="Google account email")
    tier: Literal["pro", "standard"] = Field(default="standard", description="Account tier: pro or standard")
    color: str = Field(default="#6366f1", description="Hex badge color")
    icon: str = Field(default="book-open", description="Lucide icon name")
    isDefaultPro: bool = Field(default=False, description="Whether this profile acts as the primary Pro AI engine")
    status: Literal["connected", "expired", "not_logged_in", "checking"] = "checking"
    notebookCount: int = Field(default=0, description="Total notebooks found in this account")
    lastError: Optional[str] = Field(default=None, description="Last error encountered when syncing or querying this account")
    lastAuthCheck: Optional[str] = Field(default=None, description="ISO timestamp of last authentication check")

class ProfileCreateRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_\-\s]+$', description="Alphanumeric slug or name")
    displayName: str
    email: Optional[str] = ""
    tier: Literal["pro", "standard"] = "standard"
    color: Optional[str] = "#6366f1"
    icon: Optional[str] = "book-open"
    isDefaultPro: Optional[bool] = False

class ProfileUpdateRequest(BaseModel):
    newId: Optional[str] = None
    displayName: Optional[str] = None
    email: Optional[str] = None
    tier: Optional[Literal["pro", "standard"]] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    isDefaultPro: Optional[bool] = None

import re

# Known explicit course notebook IDs
COURSE_NOTEBOOK_IDS = {
    "96a12a04-073e-43ca-9f6d-ca0048d63486",  # CT653 - Artificial Intelligence
    "c627a211-552e-496b-9ebb-42d22ac05a95",  # EX751 - Wireless Communications
    "66c34505-a60d-4a24-98df-446d8df12a24",  # CT704 - Digital Signal Analysis and Processing
    "c3c8ecd4-2884-42a1-aa49-c4de168c1ec7",  # EX752 - RF and Microwave Engineering
    "94cd4e14-802d-4231-b27d-6a4f4a2e6182",  # ME708 - Organization and Management
    "56cdad30-13d3-4621-a0b7-8f841858476b",  # EX725 04 - Aeronautical Telecommunication
}

# Canonical default course notebook mapping (Course Code / Acronym -> Canonical Notebook ID)
DEFAULT_COURSE_NOTEBOOK_MAP = {
    "CT653": "96a12a04-073e-43ca-9f6d-ca0048d63486",  # Artificial Intelligence
    "AI": "96a12a04-073e-43ca-9f6d-ca0048d63486",
    "EX751": "c627a211-552e-496b-9ebb-42d22ac05a95",  # Wireless Communications
    "WC": "c627a211-552e-496b-9ebb-42d22ac05a95",
    "CT704": "66c34505-a60d-4a24-98df-446d8df12a24",  # Digital Signal Analysis and Processing (Default)
    "DSAP": "66c34505-a60d-4a24-98df-446d8df12a24",
    "EX752": "c3c8ecd4-2884-42a1-aa49-c4de168c1ec7",  # RF and Microwave Engineering
    "RF": "c3c8ecd4-2884-42a1-aa49-c4de168c1ec7",
    "ME708": "94cd4e14-802d-4231-b27d-6a4f4a2e6182",  # Organization and Management
    "OM": "94cd4e14-802d-4231-b27d-6a4f4a2e6182",
    "O&M": "94cd4e14-802d-4231-b27d-6a4f4a2e6182",
    "EX725": "56cdad30-13d3-4621-a0b7-8f841858476b",  # Aeronautical Telecommunication
    "AERO": "56cdad30-13d3-4621-a0b7-8f841858476b",
}

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
    id: str
    title: str
    source_count: int = 0
    updated_at: Optional[str] = None
    profileId: str
    profileName: str
    profileEmail: str
    tier: str = "standard"
    color: str = "#6366f1"
    category: Optional[str] = "general"
    is_study: Optional[bool] = False
    course_code: Optional[str] = None

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
    conversationId: Optional[str] = None

class NotebookRef(BaseModel):
    notebookId: str
    profileId: str
    title: Optional[str] = None

class CrossQueryRequest(BaseModel):
    notebooks: List[NotebookRef]
    question: str
    synthesizerProfileId: Optional[str] = None

class StudioRequest(BaseModel):
    notebookId: str
    profileId: str
    artifactType: Literal["audio", "video", "slides", "mindmap", "report", "quiz", "flashcards"]

class BatchShareRequest(BaseModel):
    notebookIds: List[str] = Field(..., min_length=1, description="List of notebook UUIDs to share")
    targetProfileIds: Optional[List[str]] = Field(default=None, description="Target profile IDs. If omitted, shares with all other registered accounts.")
    role: Literal["editor", "viewer"] = Field(default="editor", description="Permission role to grant")
    autoSync: bool = Field(default=True, description="Whether to trigger notebook cache sync after sharing")

# ----------------- CALENDAR MODELS -----------------

class MatchedNotebookSummary(BaseModel):
    id: str
    title: str
    profile_id: str
    course_code: Optional[str] = None
    color: str = "#6366f1"
    match_reason: Optional[str] = None

class CalendarAgendaEvent(BaseModel):
    id: str
    summary: str
    start: str
    end: str
    all_day: bool = False
    location: Optional[str] = ""
    description: Optional[str] = ""
    is_today: bool = False
    is_upcoming: bool = False
    days_until: int = 0
    time_label: str = ""
    date_label: str = ""
    event_type: Literal["exam", "lab", "class", "general"] = "general"
    matched_notebook: Optional[MatchedNotebookSummary] = None

class CalendarAgendaResponse(BaseModel):
    configured: bool
    calendar_email: Optional[str] = ""
    last_synced: Optional[str] = None
    today_count: int = 0
    upcoming_count: int = 0
    matched_count: int = 0
    today_events: List[CalendarAgendaEvent] = []
    upcoming_events: List[CalendarAgendaEvent] = []

# ----------------- USAGE & QUOTA LIMITS MODELS -----------------

class UsageWindow(BaseModel):
    window: str = Field(..., description="'rolling' or 'weekly'")
    percent_used: float = Field(default=0.0)
    percent_remaining: float = Field(default=100.0)
    resets_at: Optional[str] = Field(default=None, description="ISO-8601 UTC reset timestamp")

class ProfileUsage(BaseModel):
    profile_id: str
    display_name: str
    email: str
    tier: str = "pro"
    color: str = "#81c995"
    is_default_pro: bool = False
    status: Literal["connected", "error", "expired"] = "connected"
    windows: List[UsageWindow] = []
    error: Optional[str] = None
    fetched_at: Optional[str] = None

class FleetUsageResponse(BaseModel):
    total_accounts: int = 0
    connected_accounts: int = 0
    average_rolling_used: float = 0.0
    healthy_count: int = 0
    warning_count: int = 0
    critical_count: int = 0
    profiles: List[ProfileUsage] = []
    fetched_at: str

# ----------------- SCHEDULED CREATION & QUEUE MODELS -----------------

class ScheduledJob(BaseModel):
    id: str = Field(..., description="Unique job UUID")
    notebook_id: str
    notebook_title: str
    assigned_profile_id: Optional[str] = None
    artifact_type: Literal["video", "audio", "report", "quiz", "flashcards", "mindmap", "slides", "infographic", "data-table"] = "video"
    format_option: Optional[str] = "cinematic"
    style: Optional[str] = "auto_select"
    custom_prompt: Optional[str] = None
    quantity: Optional[int] = None
    difficulty: Optional[str] = None
    status: Literal["queued", "scheduled", "in_progress", "completed", "failed", "download_failed", "cancelled"] = "queued"
    trigger_type: Literal["immediate", "next_reset_window", "custom_time", "calendar_event"] = "immediate"
    scheduled_time: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    artifact_id: Optional[str] = None
    local_filepath: Optional[str] = None
    download_filename: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    rotation_wave: Optional[int] = 1

class BatchScheduleRequest(BaseModel):
    notebook_ids: List[str] = Field(..., min_length=1, description="Target notebook IDs")
    artifact_type: Literal["video", "audio", "report", "quiz", "flashcards", "mindmap", "slides", "infographic", "data-table"] = "video"
    format_option: Optional[str] = "cinematic"
    style: Optional[str] = "auto_select"
    custom_prompt: Optional[str] = None
    quantity: Optional[int] = None
    difficulty: Optional[str] = None
    preferred_profile_id: Optional[str] = None
    scheduled_time: Optional[str] = None
    trigger_type: Literal["immediate", "next_reset_window", "custom_time", "calendar_event"] = "immediate"

class SingleScheduleRequest(BaseModel):
    notebook_id: str
    artifact_type: Literal["video", "audio", "report", "quiz", "flashcards", "mindmap", "slides", "infographic", "data-table"] = "video"
    format_option: Optional[str] = "cinematic"
    style: Optional[str] = "auto_select"
    custom_prompt: Optional[str] = None
    quantity: Optional[int] = None
    difficulty: Optional[str] = None
    preferred_profile_id: Optional[str] = None
    scheduled_time: Optional[str] = None
    trigger_type: Literal["immediate", "next_reset_window", "custom_time", "calendar_event"] = "immediate"

class BatchScheduleResponse(BaseModel):
    success: bool = True
    total_queued: int = 0
    queued_jobs: List[ScheduledJob] = []
    active_profiles: List[str] = []
    message: str = ""

class SchedulerStatusResponse(BaseModel):
    total_jobs: int = 0
    queued_count: int = 0
    in_progress_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    download_failed_count: int = 0
    active_workers: Dict[str, Optional[str]] = {}
    jobs: List[ScheduledJob] = []

# ----------------- HYBRID FOLDER MAPPING MODELS -----------------

class FolderMapping(BaseModel):
    notebook_id: str
    folder_type: Literal["local_folder", "drive_web"] = "local_folder"
    target_path: str = Field(..., description="Local path or Google Drive Web Folder URL/ID")
    display_name: Optional[str] = ""
    last_scanned: Optional[str] = None
    auto_sync: bool = False
    recursive: bool = False

class FolderFileItem(BaseModel):
    name: str
    path_or_id: str
    extension: str
    size_bytes: Optional[int] = 0
    modified_at: Optional[str] = None
    status: Literal["ingested", "new", "stale", "unsupported"] = "new"
    category: Literal["document", "media", "code", "spreadsheet", "unsupported"] = "document"
    source_id: Optional[str] = None
    requires_code_adapter: bool = False
    detail: Optional[str] = ""

class FolderMappingCreateRequest(BaseModel):
    target_path: str
    folder_type: Optional[Literal["local_folder", "drive_web"]] = None
    display_name: Optional[str] = ""
    auto_sync: Optional[bool] = False
    recursive: Optional[bool] = False

class FolderStatusResponse(BaseModel):
    notebook_id: str
    notebook_title: str
    profile_id: str
    tier: str = "pro"
    max_capacity: int = 300
    current_source_count: int = 0
    capacity_percent: float = 0.0
    mapping: Optional[FolderMapping] = None
    files: List[FolderFileItem] = []
    new_count: int = 0
    ingested_count: int = 0
    stale_count: int = 0
    unsupported_count: int = 0

class FolderSyncRequest(BaseModel):
    action: Literal["ingest_new", "sync_stale", "full_sync"] = "ingest_new"
    selected_files: Optional[List[str]] = None

class FolderSyncResponse(BaseModel):
    success: bool = True
    notebook_id: str
    ingested_count: int = 0
    stale_synced_count: int = 0
    failed_count: int = 0
    results: List[Dict[str, Any]] = []
    message: str = ""
