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
    id: str
    displayName: str
    email: Optional[str] = ""
    tier: Literal["pro", "standard"] = "standard"
    color: Optional[str] = "#6366f1"
    icon: Optional[str] = "book-open"
    isDefaultPro: Optional[bool] = False

class ProfileUpdateRequest(BaseModel):
    displayName: Optional[str] = None
    email: Optional[str] = None
    tier: Optional[Literal["pro", "standard"]] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    isDefaultPro: Optional[bool] = None

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
