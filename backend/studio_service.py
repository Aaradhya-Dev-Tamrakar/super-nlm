"""Structured, read-only Studio inspection and source preflight."""

import json
import re
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from backend.nlm_client import run_nlm_cmd
from backend.storage import get_cached_notebooks, get_profiles

TYPE_ALIASES = {
    "slide_deck": "slides",
    "slide-deck": "slides",
    "mind_map": "mindmap",
    "mind-map": "mindmap",
    "data_table": "data-table",
}
READY = {"completed", "ready", "done", "success"}


def normalize_notebook(value: str) -> str:
    value = value.strip()
    if "://" in value:
        url = urlparse(value)
        if url.scheme != "https" or url.hostname not in {
            "notebook.google.com",
            "notebooklm.google.com",
        }:
            raise ValueError("Use a NotebookLM HTTPS notebook link or notebook UUID")
        match = re.search(r"/notebook/([0-9a-fA-F-]{36})(?:/|$)", url.path)
        if not match:
            raise ValueError("The link does not contain a notebook UUID")
        value = match.group(1)
    return str(UUID(value))


def parse_payload(output: str) -> Any:
    try:
        return json.loads(output)
    except (ValueError, TypeError):
        return None


def diagnostic(result: dict, stage: str, notebook_id: str, profile_id: str) -> dict:
    payload = parse_payload(result.get("stdout", "")) or parse_payload(
        result.get("stderr", "")
    )
    message = payload.get("error") if isinstance(payload, dict) else None
    message = (
        message
        or result.get("stderr")
        or result.get("stdout")
        or "CLI returned no failure details"
    )
    match = re.search(
        r"(?:code|provider_code)\s*[:=]?\s*(\d+)", str(message), re.IGNORECASE
    )
    return {
        "stage": stage,
        "notebook_id": notebook_id,
        "profile_id": profile_id,
        "message": message,
        "returncode": result.get("returncode"),
        "provider_code": (
            payload.get("provider_code") if isinstance(payload, dict) else None
        )
        or (int(match[1]) if match else None),
        "stdout": result.get("stdout", ""),
        "stderr": result.get("stderr", ""),
        "upstream": payload,
        "cause_unavailable": str(message).strip().rstrip(".") == "Could not retrieve notebook sources",
    }


class StudioCommandError(RuntimeError):
    def __init__(self, details: dict):
        self.details = details
        super().__init__(f"{details['stage']}: {details['message']}")


async def inspect_command(
    args: list[str], stage: str, notebook_id: str, profile_id: str
) -> Any:
    result = await run_nlm_cmd(args + ["--profile", profile_id, "--json"], timeout=45)
    data = parse_payload(result.get("stdout", ""))
    if not result.get("success") or (
        isinstance(data, dict) and data.get("status") == "error"
    ):
        raise StudioCommandError(diagnostic(result, stage, notebook_id, profile_id))
    if data is None:
        raise StudioCommandError(
            {
                **diagnostic(result, stage, notebook_id, profile_id),
                "message": "CLI response was not valid JSON",
            }
        )
    return data


async def candidate_profiles(notebook_id: str, profile_id: str | None = None):
    notebooks = await get_cached_notebooks()
    profiles = await get_profiles()
    cached = {n.profileId for n in notebooks if n.id == notebook_id}
    active = [
        p
        for p in profiles
        if p.status == "connected" and (profile_id is None or p.id == profile_id)
    ]
    active.sort(key=lambda p: (p.id not in cached, not p.isDefaultPro))
    if not active:
        raise ValueError(
            "No connected account is available; authenticate or choose another profile"
        )
    return active, notebooks


async def sources(notebook_id: str, profile_id: str) -> list[dict]:
    data = await inspect_command(
        ["source", "list", notebook_id], "source_lookup", notebook_id, profile_id
    )
    items = data if isinstance(data, list) else data.get("sources")
    if not isinstance(items, list):
        raise StudioCommandError(
            {
                "stage": "source_lookup",
                "notebook_id": notebook_id,
                "profile_id": profile_id,
                "message": "Unexpected source-list schema",
                "upstream": data,
            }
        )
    return items


async def source_scope(
    notebook_id: str, profile_id: str, source_ids=None, exclude_sources=None
) -> list[str]:
    items = await sources(notebook_id, profile_id)
    all_ids = {
        str(s.get("id") or s.get("source_id"))
        for s in items
        if s.get("id") or s.get("source_id")
    }
    selected = list(source_ids) if source_ids is not None else list(all_ids)
    unknown = set(selected) - all_ids
    if unknown:
        raise ValueError(
            f"Source IDs do not belong to this notebook: {', '.join(sorted(unknown))}"
        )
    excluded = {s.casefold() for s in (exclude_sources or [])}
    omitted = {
        str(s.get("id") or s.get("source_id"))
        for s in items
        if str(s.get("title") or s.get("name") or "").casefold() in excluded
        or str(s.get("id") or s.get("source_id")).casefold() in excluded
    }
    selected = sorted(set(selected) - omitted)
    if not selected:
        raise ValueError(
            "Source selection is empty; select at least one available source"
        )
    return selected


async def artifacts(notebook_id: str, profile_id: str) -> list[dict]:
    data = await inspect_command(
        ["studio", "status", notebook_id, "--full"],
        "studio_poll",
        notebook_id,
        profile_id,
    )
    items = data if isinstance(data, list) else data.get("artifacts")
    if not isinstance(items, list):
        raise StudioCommandError(
            {
                "stage": "studio_poll",
                "notebook_id": notebook_id,
                "profile_id": profile_id,
                "message": "Unexpected artifact-list schema",
                "upstream": data,
            }
        )
    return [
        {
            **a,
            "id": a.get("id") or a.get("artifact_id"),
            "type": TYPE_ALIASES.get(
                str(a.get("type", "")).lower(), str(a.get("type", "")).lower()
            ),
        }
        for a in items
    ]


async def get_share_status(notebook_id: str, profile_id: str | None = None) -> dict:
    profiles, _ = await candidate_profiles(notebook_id, profile_id)
    errors = []
    for profile in profiles:
        try:
            data = await inspect_command(
                ["share", "status", notebook_id],
                "sharing_status",
                notebook_id,
                profile.id,
            )
            if not isinstance(data, dict) or not isinstance(
                data.get("collaborators"), list
            ):
                raise StudioCommandError(
                    {
                        "stage": "sharing_status",
                        "notebook_id": notebook_id,
                        "profile_id": profile.id,
                        "message": "Unexpected sharing-status schema",
                    }
                )
            all_profiles = await get_profiles()
            by_email = {
                str(c.get("email", "")).casefold(): c for c in data["collaborators"]
            }
            return {
                "success": True,
                "notebook_id": notebook_id,
                "profile_id": profile.id,
                "sharing": data,
                "accounts": [
                    {
                        "profile_id": p.id,
                        "role": by_email.get(p.email.casefold(), {}).get("role"),
                        "pending": by_email.get(p.email.casefold(), {}).get(
                            "is_pending"
                        ),
                        "listed_as_collaborator": p.email.casefold() in by_email,
                    }
                    for p in all_profiles
                ],
                "attempts": errors,
            }
        except StudioCommandError as error:
            errors.append(error.details)
    return {"success": False, "notebook_id": notebook_id, "attempts": errors}
