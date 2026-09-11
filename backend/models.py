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
    "bc8653c3-a1d3-42b7-bca1-cd8e4effc038",  # CT704 - Digital Signal Analysis and Processing
    "c3c8ecd4-2884-42a1-aa49-c4de168c1ec7",  # EX752 - RF and Microwave Engineering
    "94cd4e14-802d-4231-b27d-6a4f4a2e6182",  # ME708 - Organization and Management
    "56cdad30-13d3-4621-a0b7-8f841858476b",  # EX725 04 - Aeronautical Telecommunication
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
