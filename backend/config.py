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

# Google Gemini Pro/Flash API for 2nd-stage multi-notebook synthesis
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
DEFAULT_SYNTHESIS_MODEL = "gemini-2.5-flash"
SYNTHESIS_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-pro"]
