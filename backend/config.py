from pathlib import Path
import shutil
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"

PROFILES_FILE = DATA_DIR / "profiles.json"
CACHE_FILE = DATA_DIR / "notebooks_cache.json"

# Ensure data directory exists
DATA_DIR.mkdir(exist_ok=True)

# Locate nlm binary
NLM_EXECUTABLE = shutil.which("nlm")
if not NLM_EXECUTABLE:
    fallback = Path(os.environ.get("USERPROFILE", "")) / ".local" / "bin" / "nlm.exe"
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
