from pathlib import Path
import shutil
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"

PROFILES_FILE = DATA_DIR / "profiles.json"
CACHE_FILE = DATA_DIR / "notebooks_cache.json"
SCHEDULED_JOBS_FILE = DATA_DIR / "scheduled_jobs.json"
FOLDER_MAPPINGS_FILE = DATA_DIR / "folder_mappings.json"
DOWNLOADS_DIR = BASE_DIR / "downloads"

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
DOWNLOADS_DIR.mkdir(exist_ok=True)

import sys

# Locate nlm binary cross-platform
NLM_EXECUTABLE = shutil.which("nlm")
if not NLM_EXECUTABLE:
    home_dir = Path.home()
    binary_name = "nlm.exe" if sys.platform == "win32" else "nlm"
    fallback = home_dir / ".local" / "bin" / binary_name
    if fallback.exists():
        NLM_EXECUTABLE = str(fallback)
    else:
        NLM_EXECUTABLE = "nlm"

# Default seed profile for aaradhyadevtmr@gmail.com (Pro AI)
DEFAULT_SEED_PROFILES = [
    {
        "id": "default",
        "displayName": "Personal / Student",
        "email": "aaradhyadevtmr@gmail.com",
        "tier": "pro",
        "color": "#3b82f6",  # Blue
        "icon": "sparkles",
        "isDefaultPro": True,
        "status": "connected"
    }
]

def _load_env_file():
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip("\"' ")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except Exception:
            pass

_load_env_file()

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
