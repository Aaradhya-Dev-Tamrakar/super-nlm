"""Studio artifact creation, status polling, and download helpers."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("backend.nlm_client")


def _facade():
    import backend.nlm_client as facade

    return facade


async def create_studio_artifact(
    profile_id: str,
    notebook_id: str,
    artifact_type: str = "video",
    format_option: str | None = None,
    style: str | None = None,
    custom_prompt: str | None = None,
    quantity: int | None = None,
    difficulty: str | None = None,
    source_ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Triggers creation of a studio artifact (video, audio, report, quiz, flashcards, mindmap, slides, etc.)
    using 'nlm <artifact_type> create <notebook_id> --profile <profile_id> --confirm [flags]'.
    """
    artifact_type_lower = artifact_type.lower().strip()
    command_type = artifact_type_lower
    args = [command_type, "create", notebook_id, "--profile", profile_id, "--confirm", "--json"]
    if source_ids is not None:
        if not source_ids:
            raise ValueError("source_ids must contain at least one source")
        args.extend(["--source-ids", ",".join(source_ids)])

    if artifact_type_lower == "video":
        if format_option:
            args.extend(["--format", format_option])
        if style and style != "auto_select" and format_option not in ("cinematic", "short"):
            args.extend(["--style", style])
        if custom_prompt:
            args.extend(["--focus", custom_prompt])
    elif artifact_type_lower == "audio":
        if format_option:
            args.extend(["--format", format_option])
        if custom_prompt:
            args.extend(["--focus", custom_prompt])
    elif artifact_type_lower == "report":
        if format_option:
            args.extend(["--format", format_option])
        if custom_prompt:
            args.extend(["--prompt", custom_prompt])
    elif artifact_type_lower in ("quiz", "flashcards"):
        if difficulty:
            args.extend(["--difficulty", str({"easy": 1, "medium": 3, "hard": 5}.get(difficulty, difficulty))])
        if quantity and artifact_type_lower == "quiz":
            args.extend(["--count", str(quantity)])
        if custom_prompt:
            args.extend(["--focus", custom_prompt])
    elif artifact_type_lower in ("slides", "infographic"):
        if custom_prompt:
            args.extend(["--focus", custom_prompt])
        if artifact_type_lower == "slides" and format_option:
            args.extend(["--format", format_option])
    elif artifact_type_lower == "mindmap" and custom_prompt:
        args.extend(["--title", custom_prompt])
    elif artifact_type_lower == "data-table":
        args.insert(3, custom_prompt or "Summarize the key facts and comparisons from the selected sources")

    logger.info(f"[Studio Create] Dispatching '{artifact_type_lower}' for notebook '{notebook_id}' on profile '{profile_id}'")
    return await _facade().run_nlm_cmd(args, timeout=90)


async def get_studio_status(profile_id: str, notebook_id: str) -> list[dict[str, Any]]:
    """
    Fetches the studio artifact status list for a given notebook and profile.
    Returns a list of dicts with artifact details (id, type, status, title, created_at).
    """
    res = await _facade().run_nlm_cmd(["studio", "status", notebook_id, "--profile", profile_id, "--json"], timeout=30)
    if not res.get("success"):
        logger.warning(f"[Studio Status] Failed for notebook '{notebook_id}' on profile '{profile_id}': {res.get('stderr')}")
        return []

    try:
        data = json.loads(res["stdout"])
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "artifacts" in data:
            return data["artifacts"]
        return []
    except Exception as e:
        logger.warning(f"[Studio Status] Failed to parse JSON response: {e}")
        return []


async def download_studio_artifact(
    profile_id: str,
    notebook_id: str,
    artifact_type: str,
    artifact_id: str | None,
    output_filepath: str,
) -> dict[str, Any]:
    """
    Downloads a studio artifact to the specified local file path.
    """
    artifact_type_lower = artifact_type.lower().strip()
    cmd_type_map = {
        "video": "video",
        "audio": "audio",
        "report": "report",
        "slides": "slide-deck",
        "infographic": "infographic",
        "mindmap": "mind-map",
        "quiz": "quiz",
        "flashcards": "flashcards",
        "data-table": "data-table",
    }
    cmd_type = cmd_type_map.get(artifact_type_lower, artifact_type_lower)
    # Download commands lack --profile; select the account only in this child process.
    args = ["download", cmd_type, notebook_id, "--output", output_filepath]
    if artifact_type_lower in ("audio", "video", "slides", "infographic"):
        args.append("--no-progress")
    if artifact_type_lower in ("quiz", "flashcards"):
        args.extend(["--format", "markdown"])
    if artifact_id:
        args.extend(["--id", artifact_id])

    logger.info(f"[Studio Download] Downloading '{cmd_type}' for notebook '{notebook_id}' to '{output_filepath}'")
    return await _facade().run_nlm_cmd(args, timeout=180, profile_id=profile_id)
