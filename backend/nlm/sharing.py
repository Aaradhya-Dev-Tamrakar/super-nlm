"""Notebook collaborator sharing, auto-sharing, and unsharing helpers."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from backend.config import SUPER_NLM_FLEET_CONCURRENCY
from backend.models import detect_course_info

logger = logging.getLogger("backend.nlm_client")

SHARE_ROLE_REMOVE = 4

_UNSHARE_RPC_SCRIPT = (
    "import sys; "
    "from notebooklm_tools.cli.utils import get_client; "
    "profile, nb_id, email = sys.argv[1], sys.argv[2], sys.argv[3]; "
    "with get_client(profile) as client: "
    "res = client._call_rpc(client.RPC_SHARE_NOTEBOOK, [[[nb_id, [[email, None, 4]], None, [1, '']]], 1, None, [2]]); "
    "sys.exit(0 if res is not None else 1)"
)


def _facade():
    import backend.nlm_client as facade

    return facade


async def ensure_notebook_shared(notebook_id: str, source_profile_id: str, target_email: str) -> bool:
    """
    Checks if target_email is already a collaborator on notebook_id via source_profile_id.
    If not, automatically invites target_email as an editor.
    """
    if not target_email or not source_profile_id:
        return False
    from backend.studio_service import StudioCommandError, diagnostic

    facade = _facade()
    status_res = await facade.run_nlm_cmd(["share", "status", notebook_id, "--profile", source_profile_id, "--json"], timeout=20)
    if status_res["success"]:
        try:
            data = json.loads(status_res["stdout"])
            if not isinstance(data, dict) or not isinstance(data.get("collaborators"), list):
                raise TypeError("Missing collaborators list")
            collaborators = data.get("collaborators", [])
            for c in collaborators:
                if c.get("email", "").lower() == target_email.lower():
                    if c.get("is_pending"):
                        raise StudioCommandError(
                            {
                                "stage": "sharing_status",
                                "notebook_id": notebook_id,
                                "profile_id": source_profile_id,
                                "message": "Recipient already has a pending invitation; it has not confirmed access",
                            }
                        )
                    logger.info(f"Notebook {notebook_id} is already shared with {target_email}")
                    return True
        except (ValueError, TypeError) as error:
            raise StudioCommandError(
                {
                    **diagnostic(status_res, "sharing_status", notebook_id, source_profile_id),
                    "message": f"Invalid sharing-status response: {error}",
                }
            ) from error
    else:
        raise StudioCommandError(diagnostic(status_res, "sharing_status", notebook_id, source_profile_id))

    logger.info(f"Inviting {target_email} to notebook {notebook_id} via profile {source_profile_id}")
    invite_res = await facade.run_nlm_cmd(
        [
            "share",
            "invite",
            notebook_id,
            target_email,
            "--role",
            "editor",
            "--profile",
            source_profile_id,
        ],
        timeout=25,
    )

    if invite_res["success"]:
        logger.info(f"Successfully invited {target_email} to notebook {notebook_id}")
        return True
    logger.warning(f"Failed to invite {target_email} to notebook {notebook_id}: {invite_res['stderr']}")
    return False


async def batch_share_notebooks_to_accounts(
    notebook_ids: list[str],
    target_profile_ids: list[str] | None = None,
    role: str = "editor",
    respect_auto_share_rules: bool = False,
) -> dict[str, Any]:
    """
    Batch shares multiple notebooks across specified (or all registered) Google accounts.
    When respect_auto_share_rules=True, skips notebooks excluded via sharing_rules.json and
    excludes target profiles with receiveAutoShare=False or listed in per-notebook exclude_profiles.
    """
    from backend.storage import get_cached_notebooks, get_profiles, get_sharing_rules

    facade = _facade()
    profiles = await get_profiles()
    profile_map = {p.id: p for p in profiles}
    cached_notebooks = await get_cached_notebooks()
    notebook_map = {n.id: n for n in cached_notebooks}
    sharing_rules = await get_sharing_rules() if respect_auto_share_rules else {}
    sem = asyncio.Semaphore(SUPER_NLM_FLEET_CONCURRENCY)

    async def _process_notebook(nb_id: str) -> tuple[list[dict[str, Any]], int, int, int, int]:
        nb_results: list[dict[str, Any]] = []
        nb_shared = 0
        nb_already_shared = 0
        nb_failed = 0
        nb_skipped_owner = 0

        rule = sharing_rules.get(nb_id) if respect_auto_share_rules else None
        if rule and rule.exclude_all:
            return nb_results, nb_shared, nb_already_shared, nb_failed, nb_skipped_owner

        nb_entry = notebook_map.get(nb_id)
        nb_title = nb_entry.title if nb_entry else nb_id

        matching_profiles = [n.profileId for n in cached_notebooks if n.id == nb_id]
        if "main" in matching_profiles:
            owner_profile_id = "main"
        elif any(getattr(p, "isDefaultPro", False) and p.id in matching_profiles for p in profiles):
            owner_profile_id = next(p.id for p in profiles if getattr(p, "isDefaultPro", False) and p.id in matching_profiles)
        elif matching_profiles:
            owner_profile_id = matching_profiles[0]
        else:
            owner_profile_id = nb_entry.profileId if nb_entry else (profiles[0].id if profiles else "main")

        owner_email = profile_map[owner_profile_id].email.lower() if owner_profile_id in profile_map and profile_map[owner_profile_id].email else ""

        if target_profile_ids:
            target_profiles = [profile_map[pid] for pid in target_profile_ids if pid in profile_map]
        else:
            target_profiles = [p for p in profiles if p.id != owner_profile_id]

        if respect_auto_share_rules:
            excluded_pids = set(rule.exclude_profiles) if rule else set()
            target_profiles = [
                p
                for p in target_profiles
                if getattr(p, "receiveAutoShare", True) and p.id not in excluded_pids
            ]

        async with sem:
            existing_collaborators = set()
            status_error = None
            status_res = await facade.run_nlm_cmd(["share", "status", nb_id, "--profile", owner_profile_id, "--json"], timeout=20)
            if status_res["success"]:
                try:
                    data = json.loads(status_res["stdout"])
                    for c in data.get("collaborators", []):
                        c_email = (c.get("email") or "").strip().lower()
                        if c_email:
                            existing_collaborators.add(c_email)
                        if c.get("role") == "owner" and c_email:
                            owner_email = c_email
                except (ValueError, TypeError, AttributeError) as e:
                    logger.warning(f"Could not parse share status for notebook {nb_id}: {e}")
                    from backend.studio_service import diagnostic

                    status_error = {**diagnostic(status_res, "sharing_status", nb_id, owner_profile_id), "message": str(e)}
            else:
                from backend.studio_service import diagnostic

                status_error = diagnostic(status_res, "sharing_status", nb_id, owner_profile_id)

            for target in target_profiles:
                target_email = (target.email or "").strip().lower()
                if not target_email:
                    continue
                if status_error:
                    nb_failed += 1
                    nb_results.append(
                        {
                            "notebookId": nb_id,
                            "notebookTitle": nb_title,
                            "targetProfileId": target.id,
                            "targetEmail": target.email,
                            "status": "unknown",
                            "message": "Sharing status could not be read; no invitation attempted",
                            "error_details": status_error,
                        }
                    )
                    continue

                if target_email == owner_email:
                    nb_skipped_owner += 1
                    nb_results.append(
                        {
                            "notebookId": nb_id,
                            "notebookTitle": nb_title,
                            "targetProfileId": target.id,
                            "targetEmail": target.email,
                            "status": "owner",
                            "message": "Account is already notebook owner",
                        }
                    )
                    continue

                if target_email in existing_collaborators:
                    nb_already_shared += 1
                    nb_results.append(
                        {
                            "notebookId": nb_id,
                            "notebookTitle": nb_title,
                            "targetProfileId": target.id,
                            "targetEmail": target.email,
                            "status": "already_shared",
                            "message": "Account already has access",
                        }
                    )
                    continue

                invite_res = await facade.run_nlm_cmd(
                    [
                        "share",
                        "invite",
                        nb_id,
                        target_email,
                        "--role",
                        role,
                        "--profile",
                        owner_profile_id,
                    ],
                    timeout=25,
                )

                if invite_res["success"]:
                    nb_shared += 1
                    existing_collaborators.add(target_email)
                    nb_results.append(
                        {
                            "notebookId": nb_id,
                            "notebookTitle": nb_title,
                            "targetProfileId": target.id,
                            "targetEmail": target.email,
                            "status": "shared",
                            "message": f"Successfully invited as {role}",
                        }
                    )
                else:
                    nb_failed += 1
                    from backend.studio_service import diagnostic

                    nb_results.append(
                        {
                            "notebookId": nb_id,
                            "notebookTitle": nb_title,
                            "targetProfileId": target.id,
                            "targetEmail": target.email,
                            "status": "failed",
                            "message": invite_res.get("stderr") or invite_res.get("stdout") or "Invitation failed",
                            "error_details": diagnostic(invite_res, "sharing_invite", nb_id, owner_profile_id),
                        }
                    )

        return nb_results, nb_shared, nb_already_shared, nb_failed, nb_skipped_owner

    per_notebook_outcomes = await asyncio.gather(*(_process_notebook(nb_id) for nb_id in notebook_ids))
    results = []
    total_shared = 0
    total_already_shared = 0
    total_failed = 0
    total_skipped_owner = 0
    for nb_results, nb_shared, nb_already_shared, nb_failed, nb_skipped_owner in per_notebook_outcomes:
        results.extend(nb_results)
        total_shared += nb_shared
        total_already_shared += nb_already_shared
        total_failed += nb_failed
        total_skipped_owner += nb_skipped_owner

    try:
        from backend.models import Notebook
        from backend.storage import save_cached_notebooks

        existing_keys = {(n.id, n.profileId) for n in cached_notebooks}
        new_entries = []
        for r in results:
            if r["status"] in ("shared", "already_shared"):
                nb_id = r["notebookId"]
                pid = r["targetProfileId"]
                if (nb_id, pid) not in existing_keys:
                    master_nb = notebook_map.get(nb_id)
                    p_info = profile_map.get(pid)
                    if master_nb and p_info:
                        new_entries.append(
                            Notebook(
                                id=nb_id,
                                title=master_nb.title,
                                source_count=master_nb.source_count,
                                updated_at=master_nb.updated_at,
                                profileId=pid,
                                profileName=p_info.displayName,
                                profileEmail=p_info.email,
                                tier=p_info.tier,
                                color=p_info.color,
                                category=master_nb.category,
                                is_study=master_nb.is_study,
                                course_code=master_nb.course_code,
                            )
                        )
                        existing_keys.add((nb_id, pid))
        if new_entries:
            await save_cached_notebooks(cached_notebooks + new_entries)
    except Exception as e:
        logger.warning(f"Could not auto-populate cache for shared notebooks: {e}")

    return {
        "success": total_failed == 0,
        "totalNotebooks": len(notebook_ids),
        "totalOperations": len(results),
        "shared": total_shared,
        "alreadyShared": total_already_shared,
        "skippedOwner": total_skipped_owner,
        "failed": total_failed,
        "details": results,
    }


async def auto_share_study_notebooks(
    notebooks: list[Any] | None = None,
    role: str = "editor",
) -> dict[str, Any]:
    """
    Identifies all unique study course notebooks (detected via detect_course_info or is_study=True)
    and automatically batch shares them across all registered Google accounts as editor.
    """
    from backend.storage import get_cached_notebooks

    if notebooks is None:
        notebooks = await get_cached_notebooks()

    study_ids = []
    seen = set()
    for n in notebooks:
        nid = getattr(n, "id", None) or (n.get("id") if isinstance(n, dict) else None)
        title = getattr(n, "title", "") or (n.get("title", "") if isinstance(n, dict) else "")
        is_study = getattr(n, "is_study", None)
        if is_study is None:
            is_study, _, _ = detect_course_info(title, nid or "")
        if (is_study or getattr(n, "category", "") == "study") and nid and nid not in seen:
            seen.add(nid)
            study_ids.append(nid)

    if not study_ids:
        return {
            "success": True,
            "totalNotebooks": 0,
            "totalOperations": 0,
            "shared": 0,
            "alreadyShared": 0,
            "skippedOwner": 0,
            "failed": 0,
            "details": [],
        }

    logger.info(f"Auto-sharing {len(study_ids)} study course notebooks across eligible registered accounts...")
    return await _facade().batch_share_notebooks_to_accounts(
        notebook_ids=study_ids,
        role=role,
        respect_auto_share_rules=True,
    )


async def remove_notebook_collaborator(
    notebook_id: str,
    owner_profile_id: str,
    target_email: str,
    timeout: int = 25,
) -> dict[str, Any]:
    """Revoke collaborator access for target_email on notebook_id via owner_profile_id."""
    facade = _facade()
    py_exe = facade._resolve_nlm_python()
    if not py_exe:
        return {"success": False, "error": "notebooklm_tools Python runtime not found"}

    env = os.environ.copy()
    env["NLM_PROFILE"] = owner_profile_id
    env.pop("NOTEBOOKLM_COOKIES", None)

    cmd = [py_exe, "-c", _UNSHARE_RPC_SCRIPT, owner_profile_id, notebook_id, target_email]
    res = await facade._exec_subprocess(cmd, timeout=timeout, env=env)
    if res.get("success"):
        return {"success": True}
    return {
        "success": False,
        "error": res.get("stderr") or res.get("stdout") or "Unshare RPC failed",
    }


async def unshare_account_from_fleet(profile_id: str, target_email: str) -> dict[str, Any]:
    """Unshare fleet notebooks from a leaving account across remaining owner profiles."""
    from backend.storage import get_cached_notebooks, get_profiles

    facade = _facade()
    email_lower = (target_email or "").strip().lower()
    if not email_lower:
        return {
            "success": True,
            "profileId": profile_id,
            "targetEmail": target_email,
            "unshared": 0,
            "skippedOwner": 0,
            "skippedNotShared": 0,
            "failed": 0,
            "results": [],
        }

    profiles = await get_profiles()
    cached_notebooks = await get_cached_notebooks()

    remaining_profiles = [p for p in profiles if p.id != profile_id]
    remaining_by_id = {p.id: p for p in remaining_profiles}
    email_to_profile = {
        p.email.strip().lower(): p.id
        for p in remaining_profiles
        if getattr(p, "email", None)
    }

    candidate_ids: list[str] = []
    seen_ids = set()
    for n in cached_notebooks:
        shared_emails = {
            (c.get("email") or "").strip().lower()
            for c in (getattr(n, "sharedWith", None) or [])
            if isinstance(c, dict)
        }
        if (n.profileId == profile_id or email_lower in shared_emails) and n.id not in seen_ids:
            seen_ids.add(n.id)
            candidate_ids.append(n.id)

    sem = asyncio.Semaphore(SUPER_NLM_FLEET_CONCURRENCY)

    async def _unshare_candidate(nb_id: str) -> tuple[str, dict[str, Any]]:
        nb_entries = [n for n in cached_notebooks if n.id == nb_id]
        nb_title = next((n.title for n in nb_entries if n.title), nb_id)

        cached_owner_emails = [
            n.ownerEmail.strip().lower()
            for n in nb_entries
            if getattr(n, "ownerEmail", None)
        ]
        if email_lower in cached_owner_emails:
            return (
                "skipped_owner",
                {
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "status": "skipped_owner",
                    "message": "Leaving account owns this notebook",
                },
            )

        owner_profile_id = next(
            (email_to_profile[oe] for oe in cached_owner_emails if oe in email_to_profile),
            None,
        )
        if not owner_profile_id:
            holding_remaining = [n.profileId for n in nb_entries if n.profileId in remaining_by_id]
            if "default" in holding_remaining:
                owner_profile_id = "default"
            elif any(getattr(remaining_by_id[pid], "isDefaultPro", False) for pid in holding_remaining):
                owner_profile_id = next(
                    pid for pid in holding_remaining if getattr(remaining_by_id[pid], "isDefaultPro", False)
                )
            elif "main" in holding_remaining:
                owner_profile_id = "main"
            elif holding_remaining:
                owner_profile_id = holding_remaining[0]

        if not owner_profile_id:
            return (
                "skipped_owner",
                {
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "status": "skipped_no_owner",
                    "message": "No remaining profile has access to revoke sharing",
                },
            )

        async with sem:
            status_res = await facade.run_nlm_cmd(
                ["share", "status", nb_id, "--profile", owner_profile_id, "--json"],
                timeout=20,
            )
            if not status_res.get("success"):
                return (
                    "failed",
                    {
                        "notebookId": nb_id,
                        "notebookTitle": nb_title,
                        "ownerProfileId": owner_profile_id,
                        "status": "failed",
                        "message": status_res.get("stderr") or status_res.get("stdout") or "Failed to read share status",
                    },
                )

            try:
                data = json.loads(status_res["stdout"])
                collaborators = data.get("collaborators")
                if not isinstance(collaborators, list):
                    raise TypeError("Missing collaborators list")
            except (ValueError, TypeError, AttributeError) as e:
                return (
                    "failed",
                    {
                        "notebookId": nb_id,
                        "notebookTitle": nb_title,
                        "ownerProfileId": owner_profile_id,
                        "status": "failed",
                        "message": f"Invalid share status response: {e}",
                    },
                )

            target_collab = next(
                (c for c in collaborators if isinstance(c, dict) and (c.get("email") or "").strip().lower() == email_lower),
                None,
            )
            if target_collab is not None and target_collab.get("role") == "owner":
                return (
                    "skipped_owner",
                    {
                        "notebookId": nb_id,
                        "notebookTitle": nb_title,
                        "ownerProfileId": owner_profile_id,
                        "status": "skipped_owner",
                        "message": "Leaving account owns this notebook",
                    },
                )

            if target_collab is None:
                return (
                    "skipped_not_shared",
                    {
                        "notebookId": nb_id,
                        "notebookTitle": nb_title,
                        "ownerProfileId": owner_profile_id,
                        "status": "skipped_not_shared",
                        "message": "Account is not a collaborator on this notebook",
                    },
                )

            live_owner_email = next(
                (
                    (c.get("email") or "").strip().lower()
                    for c in collaborators
                    if isinstance(c, dict) and c.get("role") == "owner" and c.get("email")
                ),
                None,
            )
            if live_owner_email and live_owner_email in email_to_profile:
                owner_profile_id = email_to_profile[live_owner_email]

            remove_res = await facade.remove_notebook_collaborator(nb_id, owner_profile_id, email_lower)
            if remove_res.get("success"):
                return (
                    "unshared",
                    {
                        "notebookId": nb_id,
                        "notebookTitle": nb_title,
                        "ownerProfileId": owner_profile_id,
                        "status": "unshared",
                        "message": "Collaborator access revoked",
                    },
                )
            return (
                "failed",
                {
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "ownerProfileId": owner_profile_id,
                    "status": "failed",
                    "message": remove_res.get("error") or "Failed to revoke collaborator access",
                },
            )

    outcomes = await asyncio.gather(*(_unshare_candidate(nb_id) for nb_id in candidate_ids))
    unshared = sum(1 for kind, _ in outcomes if kind == "unshared")
    skipped_owner = sum(1 for kind, _ in outcomes if kind == "skipped_owner")
    skipped_not_shared = sum(1 for kind, _ in outcomes if kind == "skipped_not_shared")
    failed = sum(1 for kind, _ in outcomes if kind == "failed")
    results = [item for _, item in outcomes]

    return {
        "success": failed == 0,
        "profileId": profile_id,
        "targetEmail": target_email,
        "unshared": unshared,
        "skippedOwner": skipped_owner,
        "skippedNotShared": skipped_not_shared,
        "failed": failed,
        "results": results,
    }


async def check_or_share_with_pro(notebook_id: str, source_profile_id: str, pro_email: str) -> bool:
    """Backward-compatible wrapper for Pro fallback sharing."""
    return await _facade().ensure_notebook_shared(notebook_id, source_profile_id, pro_email)
