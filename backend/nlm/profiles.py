"""CLI profile management, login, auth checks, and concurrent notebook fetching."""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import re
import subprocess
import sys
from typing import Any

from backend.config import NLM_EXECUTABLE, SUPER_NLM_FLEET_CONCURRENCY
from backend.models import AccountProfile, Notebook

logger = logging.getLogger("backend.nlm_client")


def _facade():
    import backend.nlm_client as facade

    return facade


async def get_cli_profiles() -> dict[str, str]:
    """
    Parses 'nlm login profile list' to discover known CLI profiles and associated emails.
    Returns a dict of {profile_id: email}.
    """
    res = await _facade().run_nlm_cmd(["login", "profile", "list"], timeout=15)
    profiles = {}
    if res["success"]:
        for raw_line in res["stdout"].splitlines():
            line = raw_line.strip()
            if ":" in line and not line.startswith("Available"):
                parts = line.split(":", 1)
                p_id = parts[0].strip()
                p_email = parts[1].strip()
                profiles[p_id] = p_email
    return profiles


async def fetch_notebooks_for_profile(profile: AccountProfile, retries: int = 1) -> list[Notebook]:
    """
    Fetches all notebooks for a given profile with error resilience and transient retry.
    """
    res = await _facade().run_nlm_cmd(["notebook", "list", "--profile", profile.id, "--json"], timeout=45)
    if not res["success"] and retries > 0:
        logger.info(f"Retrying notebook fetch for profile '{profile.id}' in 1.5s...")
        await asyncio.sleep(1.5)
        return await fetch_notebooks_for_profile(profile, retries=retries - 1)

    if not res["success"]:
        err_msg = (res.get("stderr") or "").strip() or (res.get("stdout") or "").strip() or "Unknown error"
        logger.warning(f"Failed to fetch notebooks for profile {profile.id}: {err_msg}")
        raise RuntimeError(f"Failed to fetch notebooks for profile {profile.id}: {err_msg}")

    try:
        data = json.loads(res["stdout"])
        notebooks = []
        for item in data:
            notebooks.append(
                Notebook(
                    id=item.get("id", ""),
                    title=item.get("title") or "Untitled Notebook",
                    source_count=item.get("source_count", 0),
                    updated_at=item.get("updated_at"),
                    profileId=profile.id,
                    profileName=profile.displayName,
                    profileEmail=profile.email,
                    tier=profile.tier,
                    color=profile.color,
                )
            )
        return notebooks
    except Exception as e:
        logger.error(f"Error parsing JSON from profile {profile.id}: {e}")
        raise RuntimeError(f"Invalid JSON response from profile {profile.id}: {e}") from e


def _is_missing_profile_error(err_text: str) -> bool:
    lower = (err_text or "").lower()
    return any(
        needle in lower
        for needle in (
            "profile not found",
            "not logged in",
            "no credentials",
            "create a profile",
        )
    )


async def fetch_all_notebooks_concurrently(
    profiles: list[AccountProfile],
    fallback_cached: list[Notebook] | None = None,
) -> dict[str, Any]:
    """
    Fetches notebooks for all profiles with bounded concurrency (SUPER_NLM_FLEET_CONCURRENCY).
    Retains cached notebooks if a profile fails to sync.
    """
    sem = asyncio.Semaphore(SUPER_NLM_FLEET_CONCURRENCY)
    facade = _facade()

    async def _fetch_with_sem(p: AccountProfile):
        async with sem:
            return await facade.fetch_notebooks_for_profile(p)

    tasks = [_fetch_with_sem(p) for p in profiles]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_notebooks: list[Notebook] = []
    profile_counts: dict[str, int] = {}
    cached_by_profile: dict[str, list[Notebook]] = {}
    if fallback_cached:
        for n in fallback_cached:
            cached_by_profile.setdefault(n.profileId, []).append(n)

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for profile, res in zip(profiles, results, strict=False):
        profile.lastAuthCheck = now_iso
        if isinstance(res, list):
            all_notebooks.extend(res)
            profile_counts[profile.id] = len(res)
            profile.status = "connected"
            profile.notebookCount = len(res)
            profile.lastError = None
        else:
            err_str = str(res).strip()
            if err_str.startswith("Failed to fetch notebooks for profile"):
                err_str = err_str.split(":", 1)[-1].strip()
            logger.warning(f"Profile '{profile.id}' sync failed: {err_str}")
            existing = cached_by_profile.get(profile.id, [])
            if existing:
                all_notebooks.extend(existing)
                profile_counts[profile.id] = len(existing)
                profile.notebookCount = len(existing)
            else:
                profile_counts[profile.id] = 0
                profile.notebookCount = 0
            if _is_missing_profile_error(err_str):
                profile.status = "not_logged_in"
                profile.lastError = None
            else:
                profile.status = "expired"
                profile.lastError = err_str or "Authentication expired or session invalid"

    all_notebooks.sort(key=lambda n: n.updated_at or "", reverse=True)
    return {
        "notebooks": all_notebooks,
        "profile_counts": profile_counts,
    }


async def check_profile_auth_status(profile: AccountProfile, timeout: int = 20) -> dict[str, Any]:
    """
    Probes authentication status for a single profile using 'nlm login --check -p <id>'.
    Updates profile status and returns diagnosis.
    """
    res = await _facade().run_nlm_cmd(["login", "--check", "-p", profile.id], timeout=timeout)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    profile.lastAuthCheck = now_iso

    out = (res.get("stdout") or "").strip()
    err = (res.get("stderr") or "").strip()

    is_valid = res.get("success", False) and ("Authentication valid" in out or "valid" in out.lower())
    if is_valid:
        profile.status = "connected"
        profile.lastError = None
        for line in out.splitlines():
            stripped = line.strip()
            if stripped.lower().startswith("account:"):
                parsed_email = stripped.split(":", 1)[1].strip()
                if parsed_email and "@" in parsed_email:
                    profile.email = parsed_email
                break
        return {
            "profile_id": profile.id,
            "status": "connected",
            "is_valid": True,
            "message": "Authentication is valid",
            "details": out,
        }

    err_msg = err or out or "Authentication session expired or missing cookies"
    if _is_missing_profile_error(err_msg):
        profile.status = "not_logged_in"
        profile.lastError = None
        return {
            "profile_id": profile.id,
            "status": "not_logged_in",
            "is_valid": False,
            "message": "Account has not been signed in yet",
            "details": err_msg,
        }
    profile.status = "expired"
    profile.lastError = err_msg
    return {
        "profile_id": profile.id,
        "status": "expired",
        "is_valid": False,
        "message": "Authentication expired or relogin required",
        "details": err_msg,
    }


def launch_cli_login(profile_id: str, clear: bool = True):
    """
    Launches an interactive console window running 'nlm login --profile <id> [--clear]'
    so the user can log into their Google account with Chrome.
    """
    if not re.match(r"^[a-zA-Z0-9_\-]{1,64}$", profile_id):
        raise ValueError(f"Invalid profile_id: {profile_id}")

    flags = ["login", "--profile", profile_id]
    if clear:
        flags.append("--clear")

    cmd_args = [NLM_EXECUTABLE, *flags]

    if sys.platform == "win32":
        quoted_cmd = subprocess.list2cmdline(cmd_args)
        console_cmd = f'cmd.exe /k "echo Logging in to Super-NLM profile: {profile_id}... && {quoted_cmd} && echo. && echo Profile auth complete! You can close this window now. && pause"'
        return subprocess.Popen(
            console_cmd,
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
        )

    logger.info(f"Launching login CLI for profile: {profile_id}")
    return subprocess.Popen(cmd_args)


async def delete_cli_profile(profile_id: str) -> bool:
    res = await _facade().run_nlm_cmd(["login", "profile", "delete", profile_id], timeout=15)
    return res["success"]


async def rename_cli_profile(old_id: str, new_id: str) -> bool:
    res = await _facade().run_nlm_cmd(["login", "profile", "rename", old_id, new_id], timeout=15)
    return res.get("success", False)
