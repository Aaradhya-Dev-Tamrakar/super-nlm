import asyncio
import contextlib
import logging
import os
import tempfile
import threading
import time
import weakref
from pathlib import Path
from typing import Any

import orjson

from backend.config import (
    CACHE_FILE,
    DEFAULT_SEED_PROFILES,
    FOLDER_MAPPINGS_FILE,
    PROFILES_FILE,
    SHARING_RULES_FILE,
)
from backend.models import AccountProfile, FolderMapping, Notebook, NotebookSharingRule

_file_cache_lock = threading.Lock()
_loop_file_locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[Path, asyncio.Lock]] = weakref.WeakKeyDictionary()
# Maps resolved file path -> (st_mtime_ns, st_size, cached_models)
_MODEL_CACHE: dict[Path, tuple[int, int, Any]] = {}


def _get_file_lock(file_path: Path | None = None) -> asyncio.Lock:
    """Return a loop-local, per-file asyncio.Lock so separate files or loops never contend or mismatch loops."""
    loop = asyncio.get_running_loop()
    target = file_path.resolve() if file_path is not None else Path("__global__")
    with _file_cache_lock:
        per_file = _loop_file_locks.get(loop)
        if per_file is None:
            per_file = {}
            _loop_file_locks[loop] = per_file
        lock = per_file.get(target)
        if lock is None:
            lock = asyncio.Lock()
            per_file[target] = lock
        return lock

logger = logging.getLogger(__name__)

_STATUS_RANK = {
    "connected": 3,
    "checking": 2,
    "expired": 1,
    "not_logged_in": 0,
}


def normalize_email_key(email: str) -> str:
    """Return a canonical deduplication key for an email address.

    For Gmail / Googlemail addresses, strips '+tag' subaddressing, ignores dots in
    the local part, and normalizes googlemail.com -> gmail.com.
    """
    raw = (email or "").strip().lower()
    if "@" not in raw:
        return ""
    local, domain = raw.rsplit("@", 1)
    if not local or not domain:
        return ""
    if domain in ("gmail.com", "googlemail.com"):
        local = local.split("+", 1)[0].replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def deduplicate_profiles(profiles: list[AccountProfile]) -> tuple[list[AccountProfile], list[dict[str, Any]]]:
    """Collapse duplicate profiles sharing the same canonical email key.

    Profiles without a valid email are never merged with one another.
    """
    groups: dict[str, list[tuple[int, AccountProfile]]] = {}
    for idx, profile in enumerate(profiles):
        key = normalize_email_key(profile.email)
        if key:
            groups.setdefault(key, []).append((idx, profile))

    loser_to_winner: dict[str, AccountProfile] = {}
    winner_indices: set[int] = set()
    merged_records: list[dict[str, Any]] = []

    for key, entries in groups.items():
        if len(entries) == 1:
            winner_indices.add(entries[0][0])
            continue

        def _priority(item: tuple[int, AccountProfile]):
            idx, prof = item
            return (
                1 if prof.isDefaultPro else 0,
                _STATUS_RANK.get(prof.status, 0),
                1 if (prof.tier or "").lower() == "pro" else 0,
                prof.notebookCount or 0,
                1 if prof.id == "default" else 0,
                -idx,
            )

        best_idx, winner = max(entries, key=_priority)
        winner = winner.model_copy(deep=True)
        winner_indices.add(best_idx)

        for idx, candidate in entries:
            if idx == best_idx:
                continue
            if not winner.displayName.strip() and candidate.displayName.strip():
                winner.displayName = candidate.displayName
            if not winner.lastAuthCheck and candidate.lastAuthCheck:
                winner.lastAuthCheck = candidate.lastAuthCheck
            if not winner.receiveAutoShare and candidate.receiveAutoShare and winner.status != "connected":
                winner.receiveAutoShare = True
            loser_to_winner[candidate.id] = winner
            merged_records.append({
                "removedId": candidate.id,
                "keptId": winner.id,
                "email": candidate.email,
                "canonicalEmail": key,
                "removedStatus": candidate.status,
                "keptStatus": winner.status,
            })

    deduped: list[AccountProfile] = []
    winners_by_key = {}
    for idx, prof in enumerate(profiles):
        key = normalize_email_key(prof.email)
        if not key:
            deduped.append(prof)
        elif idx in winner_indices:
            # Replace with enriched winner if this group had duplicates
            winner_obj = next(
                (w for w in loser_to_winner.values() if normalize_email_key(w.email) == key),
                prof,
            )
            if key not in winners_by_key:
                winners_by_key[key] = winner_obj
                deduped.append(winner_obj)

    return deduped, merged_records


def invalidate_storage_cache(file_path: Path | None = None) -> None:
    """Clear read-through JSON/model cache entries for one file or all files."""
    with _file_cache_lock:
        if file_path is None:
            _MODEL_CACHE.clear()
        else:
            _MODEL_CACHE.pop(file_path.resolve(), None)


def _read_cached_models(file_path: Path, builder):
    """Load Pydantic models via SIMD orjson with (mtime_ns, size) cache validation."""
    resolved = file_path.resolve()
    stat = file_path.stat()
    key = (stat.st_mtime_ns, stat.st_size)

    with _file_cache_lock:
        entry = _MODEL_CACHE.get(resolved)
        if entry is not None and entry[0] == key[0] and entry[1] == key[1]:
            cached = entry[2]
            if isinstance(cached, dict):
                return {k: v.model_copy(deep=True) for k, v in cached.items()}
            return [m.model_copy(deep=True) for m in cached]

    raw_bytes = file_path.read_bytes()
    data = orjson.loads(raw_bytes)
    models = builder(data)

    with _file_cache_lock:
        if isinstance(models, dict):
            _MODEL_CACHE[resolved] = (key[0], key[1], {k: v.model_copy(deep=True) for k, v in models.items()})
        else:
            _MODEL_CACHE[resolved] = (key[0], key[1], tuple(m.model_copy(deep=True) for m in models))

    return models


def _atomic_write_json(file_path: Path, data: Any):
    """
    Performs atomic file write on Windows Dev Drive (ReFS) using SIMD orjson + os.replace.
    Prevents Windows file-locking collisions (ERROR_SHARING_VIOLATION) with retry backoff.
    """
    resolved = file_path.resolve()
    invalidate_storage_cache(resolved)
    dir_path = file_path.parent
    dir_path.mkdir(parents=True, exist_ok=True)
    payload = orjson.dumps(data, option=orjson.OPT_INDENT_2)
    temp_fd, temp_path = tempfile.mkstemp(dir=dir_path, prefix=f"{file_path.stem}_", suffix=".tmp")
    try:
        with os.fdopen(temp_fd, "wb") as f:
            f.write(payload)

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
        invalidate_storage_cache(resolved)
    except Exception:
        if os.path.exists(temp_path):
            with contextlib.suppress(OSError):
                os.remove(temp_path)
        raise

def _load_profiles_sync() -> list[AccountProfile]:
    if not PROFILES_FILE.exists():
        _atomic_write_json(PROFILES_FILE, DEFAULT_SEED_PROFILES)
        return [AccountProfile(**p) for p in DEFAULT_SEED_PROFILES]
    try:
        return _read_cached_models(PROFILES_FILE, lambda data: [AccountProfile(**p) for p in data])
    except Exception as e:
        logger.error(f"Failed to read profiles from {PROFILES_FILE}: {e}")
        # If file is empty or corrupted, only then fallback to seed
        if PROFILES_FILE.stat().st_size == 0:
            return [AccountProfile(**p) for p in DEFAULT_SEED_PROFILES]
        raise RuntimeError(f"Could not load profiles from {PROFILES_FILE}: {e}") from e

def _save_profiles_sync(profiles: list[AccountProfile]):
    _atomic_write_json(PROFILES_FILE, [p.model_dump() for p in profiles])

def _load_cache_sync() -> list[Notebook]:
    if not CACHE_FILE.exists():
        return []
    try:
        return _read_cached_models(CACHE_FILE, lambda data: [Notebook(**n) for n in data])
    except Exception:
        return []

def _save_cache_sync(notebooks: list[Notebook]):
    _atomic_write_json(CACHE_FILE, [n.model_dump() for n in notebooks])

async def get_profiles() -> list[AccountProfile]:
    async with _get_file_lock(PROFILES_FILE):
        return await asyncio.to_thread(_load_profiles_sync)

async def get_profile(profile_id: str) -> AccountProfile | None:
    profiles = await get_profiles()
    for p in profiles:
        if p.id == profile_id:
            return p
    return None

async def save_profile(profile: AccountProfile, old_id: str | None = None):
    async with _get_file_lock(PROFILES_FILE):
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
    async with _get_file_lock(PROFILES_FILE):
        profiles = await asyncio.to_thread(_load_profiles_sync)
        new_profiles = [p for p in profiles if p.id != profile_id]
        if len(new_profiles) < len(profiles):
            await asyncio.to_thread(_save_profiles_sync, new_profiles)
            return True
        return False

async def get_cached_notebooks() -> list[Notebook]:
    async with _get_file_lock(CACHE_FILE):
        return await asyncio.to_thread(_load_cache_sync)

async def save_cached_notebooks(notebooks: list[Notebook]):
    async with _get_file_lock(CACHE_FILE):
        await asyncio.to_thread(_save_cache_sync, notebooks)

async def delete_cached_notebook(notebook_id: str) -> int:
    """Removes all cached instances of a notebook across all profiles."""
    async with _get_file_lock(CACHE_FILE):
        notebooks = await asyncio.to_thread(_load_cache_sync)
        remaining = [n for n in notebooks if n.id != notebook_id]
        removed = len(notebooks) - len(remaining)
        if removed > 0:
            await asyncio.to_thread(_save_cache_sync, remaining)
        return removed

# ----------------- FOLDER MAPPINGS PERSISTENCE -----------------

def _load_folder_mappings_sync() -> dict[str, FolderMapping]:
    if not FOLDER_MAPPINGS_FILE.exists():
        return {}
    try:
        return _read_cached_models(
            FOLDER_MAPPINGS_FILE,
            lambda data: {k: FolderMapping(**v) for k, v in data.items()},
        )
    except Exception as e:
        logger.error(f"Failed to read folder mappings from {FOLDER_MAPPINGS_FILE}: {e}")
        return {}

def _save_folder_mappings_sync(mappings: dict[str, FolderMapping]):
    _atomic_write_json(FOLDER_MAPPINGS_FILE, {k: v.model_dump() for k, v in mappings.items()})

async def get_folder_mappings() -> dict[str, FolderMapping]:
    async with _get_file_lock(FOLDER_MAPPINGS_FILE):
        return await asyncio.to_thread(_load_folder_mappings_sync)

async def get_folder_mapping(notebook_id: str) -> FolderMapping | None:
    mappings = await get_folder_mappings()
    return mappings.get(notebook_id)

async def save_folder_mapping(mapping: FolderMapping):
    async with _get_file_lock(FOLDER_MAPPINGS_FILE):
        mappings = await asyncio.to_thread(_load_folder_mappings_sync)
        mappings[mapping.notebook_id] = mapping
        await asyncio.to_thread(_save_folder_mappings_sync, mappings)

async def delete_folder_mapping(notebook_id: str) -> bool:
    async with _get_file_lock(FOLDER_MAPPINGS_FILE):
        mappings = await asyncio.to_thread(_load_folder_mappings_sync)
        if notebook_id in mappings:
            del mappings[notebook_id]
            await asyncio.to_thread(_save_folder_mappings_sync, mappings)
            return True
        return False

# ----------------- SHARING RULES PERSISTENCE -----------------

def _load_sharing_rules_sync() -> dict[str, NotebookSharingRule]:
    if not SHARING_RULES_FILE.exists():
        return {}
    try:
        return _read_cached_models(
            SHARING_RULES_FILE,
            lambda data: {k: NotebookSharingRule(**v) for k, v in data.items()},
        )
    except Exception as e:
        logger.error(f"Failed to read sharing rules from {SHARING_RULES_FILE}: {e}")
        return {}

def _save_sharing_rules_sync(rules: dict[str, NotebookSharingRule]):
    _atomic_write_json(SHARING_RULES_FILE, {k: v.model_dump() for k, v in rules.items()})

async def get_sharing_rules() -> dict[str, NotebookSharingRule]:
    async with _get_file_lock(SHARING_RULES_FILE):
        return await asyncio.to_thread(_load_sharing_rules_sync)

async def get_notebook_sharing_rule(notebook_id: str) -> NotebookSharingRule:
    rules = await get_sharing_rules()
    return rules.get(notebook_id, NotebookSharingRule(notebook_id=notebook_id))

async def save_notebook_sharing_rule(rule: NotebookSharingRule):
    async with _get_file_lock(SHARING_RULES_FILE):
        rules = await asyncio.to_thread(_load_sharing_rules_sync)
        if not rule.exclude_all and not rule.exclude_profiles:
            rules.pop(rule.notebook_id, None)
        else:
            rules[rule.notebook_id] = rule
        await asyncio.to_thread(_save_sharing_rules_sync, rules)


async def remove_profile_from_sharing_rules(profile_id: str) -> int:
    """Remove a deleted profile ID from all per-notebook sharing exclusion lists."""
    async with _get_file_lock(SHARING_RULES_FILE):
        rules = await asyncio.to_thread(_load_sharing_rules_sync)
        updated = 0
        for nb_id in list(rules.keys()):
            rule = rules[nb_id]
            if profile_id in rule.exclude_profiles:
                rule.exclude_profiles = [pid for pid in rule.exclude_profiles if pid != profile_id]
                updated += 1
                if not rule.exclude_all and not rule.exclude_profiles:
                    del rules[nb_id]
        if updated > 0:
            await asyncio.to_thread(_save_sharing_rules_sync, rules)
        return updated


async def deduplicate_stored_profiles() -> dict[str, Any]:
    """Deduplicate persisted profiles by canonical email and remap cached notebooks/rules."""
    async with _get_file_lock(PROFILES_FILE):
        def _run_dedup() -> dict[str, Any]:
            profiles = _load_profiles_sync()
            total_before = len(profiles)
            deduped, merged_records = deduplicate_profiles(profiles)
            if not merged_records:
                return {
                    "changed": False,
                    "totalBefore": total_before,
                    "totalAfter": total_before,
                    "removedCount": 0,
                    "merged": [],
                }

            _save_profiles_sync(deduped)

            winner_by_id = {p.id: p for p in deduped}
            remap = {rec["removedId"]: rec["keptId"] for rec in merged_records}

            notebooks = _load_cache_sync()
            seen_pairs: set[tuple[str, str]] = set()
            updated_notebooks: list[Notebook] = []
            for nb in notebooks:
                target_pid = remap.get(nb.profileId, nb.profileId)
                pair = (nb.id, target_pid)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                if target_pid != nb.profileId and target_pid in winner_by_id:
                    winner = winner_by_id[target_pid]
                    updated_nb = nb.model_copy(update={
                        "profileId": winner.id,
                        "profileName": winner.displayName,
                        "profileEmail": winner.email,
                        "tier": winner.tier,
                        "color": winner.color,
                    })
                    updated_notebooks.append(updated_nb)
                else:
                    updated_notebooks.append(nb)

            if CACHE_FILE.exists() or updated_notebooks:
                _save_cache_sync(updated_notebooks)

            removed_ids = set(remap.keys())
            rules = _load_sharing_rules_sync()
            rules_changed = False
            for nb_id in list(rules.keys()):
                rule = rules[nb_id]
                filtered = [pid for pid in rule.exclude_profiles if pid not in removed_ids]
                if len(filtered) != len(rule.exclude_profiles):
                    rule.exclude_profiles = filtered
                    rules_changed = True
                    if not rule.exclude_all and not rule.exclude_profiles:
                        del rules[nb_id]
            if rules_changed:
                _save_sharing_rules_sync(rules)

            return {
                "changed": True,
                "totalBefore": total_before,
                "totalAfter": len(deduped),
                "removedCount": len(merged_records),
                "merged": merged_records,
            }

        return await asyncio.to_thread(_run_dedup)


