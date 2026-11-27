import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("super_nlm.config")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"

PROFILES_FILE = DATA_DIR / "profiles.json"
CACHE_FILE = DATA_DIR / "notebooks_cache.json"
SCHEDULED_JOBS_FILE = DATA_DIR / "scheduled_jobs.json"
FOLDER_MAPPINGS_FILE = DATA_DIR / "folder_mappings.json"
SHARING_RULES_FILE = DATA_DIR / "sharing_rules.json"
USER_CATALOG_FILE = DATA_DIR / "user_catalog.json"
NLM_AUTH_MIRROR_DIR = BASE_DIR / ".nlm-auth"
DOWNLOADS_DIR = Path.home() / "Downloads" / "Super-NLM" / "Generated"

# NotebookLM Quotas & Capacity Limits
NOTEBOOKLM_PRO_SOURCE_LIMIT = 300
NOTEBOOKLM_STANDARD_SOURCE_LIMIT = 50

# Canonical File Extension Categories
NLM_NATIVE_DOCS = {".pdf", ".docx", ".pptx", ".txt", ".md", ".csv", ".epub"}
NLM_MEDIA_FORMATS = {
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".wmv",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic"
}
CODE_ADAPTER_EXTENSIONS = {".ipynb", ".py", ".c", ".cpp", ".h", ".m", ".java", ".v", ".vhd", ".json", ".sql", ".sh", ".ts", ".js", ".html", ".css"}
EXCEL_EXTENSIONS = {".xlsx", ".xls"}
IGNORED_EXTENSIONS = {".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".dll", ".so", ".bin", ".iso", ".tmp", ".log"}

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Locate nlm binary cross-platform
NLM_EXECUTABLE = shutil.which("nlm")
if not NLM_EXECUTABLE:
    home_dir = Path.home()
    binary_name = "nlm.exe" if sys.platform == "win32" else "nlm"
    fallback = home_dir / ".local" / "bin" / binary_name
    NLM_EXECUTABLE = str(fallback) if fallback.exists() else "nlm"


def _load_env_file():
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, encoding="utf-8") as f:
                for raw_line in f:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip("\"' ")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except OSError as exc:
            logger.debug("Could not read .env file: %s", exc)


_load_env_file()
if not os.environ.get("NLM_AUTH_STORAGE", "").strip():
    os.environ["NLM_AUTH_STORAGE"] = "file"


def load_user_catalog() -> dict[str, Any]:
    """Load optional user-local course/project notebook catalog from data/user_catalog.json."""
    default_catalog: dict[str, Any] = {
        "course_notebook_ids": [],
        "default_course_notebook_map": {},
        "project_notebooks": {},
        "acronym_to_keywords": {},
    }
    if not USER_CATALOG_FILE.exists():
        return default_catalog
    try:
        with open(USER_CATALOG_FILE, encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return default_catalog
        return {
            "course_notebook_ids": list(raw.get("course_notebook_ids") or []),
            "default_course_notebook_map": dict(raw.get("default_course_notebook_map") or {}),
            "project_notebooks": dict(raw.get("project_notebooks") or {}),
            "acronym_to_keywords": dict(raw.get("acronym_to_keywords") or {}),
        }
    except (OSError, ValueError, TypeError) as exc:
        logger.warning("Failed to load user catalog from %s: %s", USER_CATALOG_FILE, exc)
        return default_catalog


SUPER_NLM_DEFAULT_EMAIL = os.environ.get("SUPER_NLM_DEFAULT_EMAIL", "").strip()
SUPER_NLM_DEFAULT_DISPLAY_NAME = os.environ.get("SUPER_NLM_DEFAULT_DISPLAY_NAME", "Personal / Student").strip() or "Personal / Student"

# Default seed profile (uses SUPER_NLM_DEFAULT_EMAIL if configured)
DEFAULT_SEED_PROFILES = [
    {
        "id": "default",
        "displayName": SUPER_NLM_DEFAULT_DISPLAY_NAME,
        "email": SUPER_NLM_DEFAULT_EMAIL,
        "tier": "pro",
        "color": "#3b82f6",  # Blue
        "icon": "sparkles",
        "isDefaultPro": True,
        "status": "connected"
    }
]

# Google Gemini Pro/Flash API for 2nd-stage multi-notebook synthesis
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
DEFAULT_SYNTHESIS_MODEL = "gemini-2.5-flash"
SYNTHESIS_FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-2.5-pro"
]

# Google Calendar Private iCal Feed Configuration
GOOGLE_CALENDAR_ICAL_URL = os.environ.get("GOOGLE_CALENDAR_ICAL_URL", "").strip()
CALENDAR_CACHE_TTL_SECONDS = int(os.environ.get("CALENDAR_CACHE_TTL_SECONDS", "900")) # 15 minutes default

# Super-NLM Access Control & Security Boundary
SUPER_NLM_API_KEY = os.environ.get("SUPER_NLM_API_KEY", "").strip()
SUPER_NLM_REQUIRE_AUTH_LOCAL = os.environ.get("SUPER_NLM_REQUIRE_AUTH_LOCAL", "false").strip().lower() in ("1", "true", "yes")
SUPER_NLM_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "SUPER_NLM_ALLOWED_ORIGINS",
        "http://127.0.0.1:8000,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

# Google Drive OAuth Configuration for Folder Sync
GDRIVE_CREDENTIALS_PATH = os.environ.get("GDRIVE_CREDENTIALS_PATH", "").strip() or str(Path.home() / ".gdrive-server-credentials.json")
GDRIVE_OAUTH_PATH = os.environ.get("GDRIVE_OAUTH_PATH", "").strip() or str(Path.home() / ".gdrive-credentials.json")

# Bounded parallelism for fleet CLI/network fan-out operations
SUPER_NLM_FLEET_CONCURRENCY = max(
    1,
    int(os.environ.get("SUPER_NLM_FLEET_CONCURRENCY", str(min(8, max(4, (os.cpu_count() or 4)))))),
)
