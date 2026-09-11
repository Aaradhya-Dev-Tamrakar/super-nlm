import json
import asyncio
import os
import tempfile
from typing import List, Dict, Optional, Any
from pathlib import Path
from backend.config import PROFILES_FILE, CACHE_FILE, DEFAULT_SEED_PROFILES
from backend.models import AccountProfile, Notebook

_lock = asyncio.Lock()

import time
import logging

logger = logging.getLogger(__name__)

def _atomic_write_json(file_path: Path, data: Any):
    """
    Performs atomic file write on Windows Dev Drive (ReFS) using a temp file + os.replace.
    Prevents Windows file-locking collisions (ERROR_SHARING_VIOLATION) with retry backoff.
    """
    dir_path = file_path.parent
    dir_path.mkdir(parents=True, exist_ok=True)
    temp_fd, temp_path = tempfile.mkstemp(dir=dir_path, prefix=f"{file_path.stem}_", suffix=".tmp")
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        # Retry loop for Windows file-locking collisions
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                os.replace(temp_path, file_path)
                break
            except PermissionError:
                if attempt == max_attempts - 1:
                    raise
                time.sleep(0.05 * (attempt + 1))
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
        raise

def _load_profiles_sync() -> List[AccountProfile]:
    if not PROFILES_FILE.exists():
        _atomic_write_json(PROFILES_FILE, DEFAULT_SEED_PROFILES)
        return [AccountProfile(**p) for p in DEFAULT_SEED_PROFILES]
    try:
        with open(PROFILES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [AccountProfile(**p) for p in data]
    except Exception as e:
        logger.error(f"Failed to read profiles from {PROFILES_FILE}: {e}")
        # If file is empty or corrupted, only then fallback to seed
        if PROFILES_FILE.stat().st_size == 0:
            return [AccountProfile(**p) for p in DEFAULT_SEED_PROFILES]
        raise RuntimeError(f"Could not load profiles from {PROFILES_FILE}: {e}")

def _save_profiles_sync(profiles: List[AccountProfile]):
    _atomic_write_json(PROFILES_FILE, [p.model_dump() for p in profiles])

def _load_cache_sync() -> List[Notebook]:
    if not CACHE_FILE.exists():
        return []
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [Notebook(**n) for n in data]
    except Exception:
        return []

def _save_cache_sync(notebooks: List[Notebook]):
    _atomic_write_json(CACHE_FILE, [n.model_dump() for n in notebooks])

async def get_profiles() -> List[AccountProfile]:
    async with _lock:
        return await asyncio.to_thread(_load_profiles_sync)

async def get_profile(profile_id: str) -> Optional[AccountProfile]:
    profiles = await get_profiles()
    for p in profiles:
        if p.id == profile_id:
            return p
    return None

async def save_profile(profile: AccountProfile, old_id: Optional[str] = None):
    async with _lock:
        profiles = await asyncio.to_thread(_load_profiles_sync)
        # If this is set as default pro, unset others
        if profile.isDefaultPro:
            for p in profiles:
                lookup = old_id if old_id else profile.id
                if p.id != lookup and p.id != profile.id:
                    p.isDefaultPro = False

        lookup_id = old_id if old_id else profile.id
        updated = False
        for i, p in enumerate(profiles):
            if p.id == lookup_id:
                profiles[i] = profile
                updated = True
                break
        if not updated:
            profiles.append(profile)
        await asyncio.to_thread(_save_profiles_sync, profiles)

async def delete_profile(profile_id: str) -> bool:
    async with _lock:
        profiles = await asyncio.to_thread(_load_profiles_sync)
        new_profiles = [p for p in profiles if p.id != profile_id]
        if len(new_profiles) < len(profiles):
            await asyncio.to_thread(_save_profiles_sync, new_profiles)
            return True
        return False

async def get_cached_notebooks() -> List[Notebook]:
    async with _lock:
        return await asyncio.to_thread(_load_cache_sync)

async def save_cached_notebooks(notebooks: List[Notebook]):
    async with _lock:
        await asyncio.to_thread(_save_cache_sync, notebooks)
