import sys
import asyncio
import json
import logging
import subprocess
import re
from typing import List, Dict, Any, Optional
import httpx
from backend.config import (
    NLM_EXECUTABLE,
    GEMINI_API_KEY,
    DEFAULT_SYNTHESIS_MODEL,
    SYNTHESIS_FALLBACK_MODELS
)
import datetime
from backend.models import (
    AccountProfile, Notebook, NotebookRef,
    UsageWindow, ProfileUsage, FleetUsageResponse,
    detect_course_info
)

logger = logging.getLogger(__name__)

# Windows Process Optimization Flags:
# CREATE_NO_WINDOW (0x08000000) prevents spawning unnecessary conhost processes
# for background CLI execution on Windows, reducing latency significantly.
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

def _run_subprocess_sync(cmd: List[str], timeout: int) -> Dict[str, Any]:
    extra_kwargs = {}
    if sys.platform == "win32":
        extra_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            text=True,
            encoding="utf-8",
            errors="replace",
            **extra_kwargs
        )
        out = res.stdout.replace("\r\n", "\n").strip()
        err = res.stderr.replace("\r\n", "\n").strip()
        if res.returncode != 0 and not err and out:
            err = out
        return {
            "returncode": res.returncode,
            "stdout": out,
            "stderr": err,
            "success": res.returncode == 0
        }
    except subprocess.TimeoutExpired:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout} seconds",
            "success": False
        }
    except Exception as e:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": str(e) or type(e).__name__,
            "success": False
        }

async def run_nlm_cmd(args: List[str], timeout: int = 60) -> Dict[str, Any]:
    cmd = [NLM_EXECUTABLE] + args
    logger.info(f"Running command: {' '.join(cmd)}")
    try:
        # On Windows, synchronous subprocess in thread pool is immune to IOCP pipe/reloader conflicts
        if sys.platform == "win32":
            return await asyncio.to_thread(_run_subprocess_sync, cmd, timeout)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        out_str = stdout.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
        err_str = stderr.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
        if proc.returncode != 0 and not err_str and out_str:
            err_str = out_str

        return {
            "returncode": proc.returncode,
            "stdout": out_str,
            "stderr": err_str,
            "success": proc.returncode == 0
        }
    except NotImplementedError:
        logger.info("Current event loop does not support create_subprocess_exec, falling back to to_thread")
        return await asyncio.to_thread(_run_subprocess_sync, cmd, timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
            await proc.wait()
        except Exception:
            pass
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout} seconds",
            "success": False
        }
    except Exception as e:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": str(e) or type(e).__name__,
            "success": False
        }

async def get_cli_profiles() -> Dict[str, str]:
    """
    Parses 'nlm login profile list' to discover known CLI profiles and associated emails.
    Returns a dict of {profile_id: email}.
    """
    res = await run_nlm_cmd(["login", "profile", "list"], timeout=15)
    profiles = {}
    if res["success"]:
        # Output looks like:
        # Available profiles:
        #   default: aaradhyadevtmr@gmail.com
        #   work: user@work.com
        for line in res["stdout"].splitlines():
            line = line.strip()
            if ":" in line and not line.startswith("Available"):
                parts = line.split(":", 1)
                p_id = parts[0].strip()
                p_email = parts[1].strip()
                profiles[p_id] = p_email
    return profiles

async def fetch_notebooks_for_profile(profile: AccountProfile, retries: int = 1) -> List[Notebook]:
    """
    Fetches all notebooks for a given profile with error resilience and transient retry.
    """
    res = await run_nlm_cmd(["notebook", "list", "--profile", profile.id, "--json"], timeout=45)
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
            notebooks.append(Notebook(
                id=item.get("id", ""),
                title=item.get("title") or "Untitled Notebook",
                source_count=item.get("source_count", 0),
                updated_at=item.get("updated_at"),
                profileId=profile.id,
                profileName=profile.displayName,
                profileEmail=profile.email,
                tier=profile.tier,
                color=profile.color
            ))
        return notebooks
    except Exception as e:
        logger.error(f"Error parsing JSON from profile {profile.id}: {e}")
        raise RuntimeError(f"Invalid JSON response from profile {profile.id}: {e}")

async def fetch_all_notebooks_concurrently(
    profiles: List[AccountProfile],
    fallback_cached: Optional[List[Notebook]] = None
) -> Dict[str, Any]:
    """
    Fetches notebooks for all profiles with bounded concurrency (Semaphore=3).
    Retains cached notebooks if a profile fails to sync.
    """
    sem = asyncio.Semaphore(3)

    async def _fetch_with_sem(p: AccountProfile):
        async with sem:
            return await fetch_notebooks_for_profile(p)

    tasks = [_fetch_with_sem(p) for p in profiles]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_notebooks: List[Notebook] = []
    profile_counts: Dict[str, int] = {}
    cached_by_profile: Dict[str, List[Notebook]] = {}
    if fallback_cached:
        for n in fallback_cached:
            cached_by_profile.setdefault(n.profileId, []).append(n)

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for profile, res in zip(profiles, results):
        profile.lastAuthCheck = now_iso
        if isinstance(res, list):
            all_notebooks.extend(res)
            profile_counts[profile.id] = len(res)
            profile.status = "connected"
            profile.notebookCount = len(res)
            profile.lastError = None
        else:
            err_str = str(res).strip()
            # Clean exception wrapper prefix if present
            if err_str.startswith("Failed to fetch notebooks for profile"):
                err_str = err_str.split(":", 1)[-1].strip()
            logger.warning(f"Profile '{profile.id}' sync failed: {err_str}")
            # Preserve existing cache for this profile so data is not wiped out
            existing = cached_by_profile.get(profile.id, [])
            if existing:
                all_notebooks.extend(existing)
                profile_counts[profile.id] = len(existing)
                profile.notebookCount = len(existing)
            else:
                profile_counts[profile.id] = 0
                profile.notebookCount = 0
            profile.status = "expired"
            profile.lastError = err_str or "Authentication expired or session invalid"

    # Sort notebooks by updated_at descending (latest first)
    all_notebooks.sort(key=lambda n: n.updated_at or "", reverse=True)
    return {
        "notebooks": all_notebooks,
        "profile_counts": profile_counts
    }

async def check_profile_auth_status(profile: AccountProfile, timeout: int = 20) -> Dict[str, Any]:
    """
    Probes authentication status for a single profile using 'nlm login --check -p <id>'.
    Updates profile status and returns diagnosis.
    """
    res = await run_nlm_cmd(["login", "--check", "-p", profile.id], timeout=timeout)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    profile.lastAuthCheck = now_iso

    out = (res.get("stdout") or "").strip()
    err = (res.get("stderr") or "").strip()

    is_valid = res.get("success", False) and ("Authentication valid" in out or "valid" in out.lower())
    if is_valid:
        profile.status = "connected"
        profile.lastError = None
        return {
            "profile_id": profile.id,
            "status": "connected",
            "is_valid": True,
            "message": "Authentication is valid",
            "details": out
        }
    else:
        err_msg = err or out or "Authentication session expired or missing cookies"
        profile.status = "expired"
        profile.lastError = err_msg
        return {
            "profile_id": profile.id,
            "status": "expired",
            "is_valid": False,
            "message": "Authentication expired or relogin required",
            "details": err_msg
        }

async def query_notebook(
    profile_id: str,
    notebook_id: str,
    question: str,
    conversation_id: Optional[str] = None,
    source_ids: Optional[Any] = None,
    timeout: int = 120,
    new_conversation: bool = False
) -> Dict[str, Any]:
    """
    Runs a query against a specific notebook under a specific profile.
    Supports multi-turn context via conversation_id.
    """
    args = [
        "query", "notebook", notebook_id, question,
        "--profile", profile_id,
        "--json",
        "--timeout", str(timeout)
    ]
    if conversation_id:
        args.extend(["--conversation-id", conversation_id])
    if new_conversation:
        args.append("--new-conversation")
    if source_ids:
        if isinstance(source_ids, list):
            args.extend(["--source-ids", ",".join(str(s) for s in source_ids)])
        else:
            args.extend(["--source-ids", str(source_ids)])

    res = await run_nlm_cmd(args, timeout=timeout + 15)

    clean_stdout = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', res.get("stdout") or "").strip()
    clean_stderr = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', res.get("stderr") or "").strip()

    if not res["success"]:
        # When nlm query fails, it frequently outputs JSON {"status": "error", "error": "..."} to stdout
        err_msg = ""
        if clean_stdout:
            try:
                err_data = json.loads(clean_stdout)
                if isinstance(err_data, dict):
                    err_msg = err_data.get("error") or err_data.get("message") or ""
            except Exception:
                pass
        if not err_msg:
            err_msg = clean_stderr or clean_stdout or "Query failed or timed out"

        # If a conversational query failed due to expired/stale conversation_id, retry once fresh
        if conversation_id and not new_conversation and any(k in err_msg.lower() for k in ["conversation", "session", "expired", "invalid", "not found"]):
            logger.warning(f"[Query Notebook] Stale conversation_id {conversation_id} failed ({err_msg}). Retrying with fresh session...")
            return await query_notebook(
                profile_id=profile_id,
                notebook_id=notebook_id,
                question=question,
                conversation_id=None,
                source_ids=source_ids,
                timeout=timeout,
                new_conversation=True
            )

        return {
            "success": False,
            "error": err_msg,
            "answer": None,
            "conversationId": conversation_id
        }

    try:
        data = json.loads(clean_stdout)
        # Format can be string or structured dict with 'answer' and 'citations'
        if isinstance(data, dict):
            answer_text = (
                data.get("answer")
                or data.get("text")
                or data.get("response")
                or data.get("content")
                or data.get("output")
                or data.get("result")
            )
            if not answer_text and "error" in data:
                return {
                    "success": False,
                    "error": data["error"],
                    "answer": None,
                    "conversationId": conversation_id
                }
            return {
                "success": True,
                "answer": answer_text if answer_text is not None else str(data),
                "citations": data.get("citations", []),
                "conversationId": data.get("conversation_id") or conversation_id,
                "raw": data
            }
        else:
            return {
                "success": True,
                "answer": str(data),
                "citations": [],
                "conversationId": conversation_id,
                "raw": data
            }
    except Exception:
        # Fallback to plain text if stdout is not JSON
        return {
            "success": True,
            "answer": clean_stdout,
            "citations": [],
            "conversationId": conversation_id,
            "raw": res.get("stdout")
        }

def classify_quota_error(err: str) -> Optional[str]:
    """
    Classifies a quota/rate limit error into:
      - 'daily': Daily hard quota cap reached (resets at midnight UTC).
      - 'burst': Short-term concurrency / 429 burst throttle (resets in 60-120s).
      - None: Not a quota or rate limit error.
    """
    if not err:
        return None
    lower = err.lower()

    daily_signals = [
        "daily query limit",
        "daily limit",
        "daily quota",
        "reached your limit for today",
        "limit for today",
        "try again tomorrow",
        "day limit",
        "quota exceeded for today"
    ]
    if any(sig in lower for sig in daily_signals):
        return "daily"

    burst_signals = [
        "rate limit", "quota", "429", "too many requests",
        "resource has been exhausted", "resource_exhausted",
        "exceeded", "throttled", "limit reached", "temporarily unavailable",
        "503", "service unavailable", "overloaded", "backend error"
    ]
    if any(sig in lower for sig in burst_signals):
        return "burst"

    return None

def is_rate_limit_or_quota_error(err: str) -> bool:
    """Detects if an error message indicates rate limiting or quota exhaustion."""
    return classify_quota_error(err) is not None

async def ensure_notebook_shared(notebook_id: str, source_profile_id: str, target_email: str) -> bool:
    """
    Checks if target_email is already a collaborator on notebook_id via source_profile_id.
    If not, automatically invites target_email as an editor.
    """
    if not target_email or not source_profile_id:
        return False

    # Check current sharing status
    status_res = await run_nlm_cmd(["share", "status", notebook_id, "--profile", source_profile_id, "--json"], timeout=20)
    if status_res["success"]:
        try:
            data = json.loads(status_res["stdout"])
            collaborators = data.get("collaborators", [])
            for c in collaborators:
                if c.get("email", "").lower() == target_email.lower():
                    logger.info(f"Notebook {notebook_id} is already shared with {target_email}")
                    return True
        except Exception as e:
            logger.warning(f"Could not parse share status for notebook {notebook_id}: {e}")

    # Invite target account as editor
    logger.info(f"Inviting {target_email} to notebook {notebook_id} via profile {source_profile_id}")
    invite_res = await run_nlm_cmd([
        "share", "invite", notebook_id, target_email,
        "--role", "editor",
        "--profile", source_profile_id
    ], timeout=25)

    return invite_res["success"]

async def batch_share_notebooks_to_accounts(
    notebook_ids: List[str],
    target_profile_ids: Optional[List[str]] = None,
    role: str = "editor"
) -> Dict[str, Any]:
    """
    Batch shares multiple notebooks across specified (or all registered) Google accounts.
    Optimized to fetch share status once per notebook and only issue invitations for missing collaborators.
    """
    from backend.storage import get_profiles, get_cached_notebooks

    profiles = await get_profiles()
    profile_map = {p.id: p for p in profiles}
    cached_notebooks = await get_cached_notebooks()
    notebook_map = {n.id: n for n in cached_notebooks}

    results = []
    total_shared = 0
    total_already_shared = 0
    total_failed = 0
    total_skipped_owner = 0

    for nb_id in notebook_ids:
        nb_entry = notebook_map.get(nb_id)
        nb_title = nb_entry.title if nb_entry else nb_id

        # Resolve the most suitable owner profile (prefer 'main' or default pro if they have this notebook)
        matching_profiles = [n.profileId for n in cached_notebooks if n.id == nb_id]
        if "main" in matching_profiles:
            owner_profile_id = "main"
        elif any(getattr(p, 'isDefaultPro', False) and p.id in matching_profiles for p in profiles):
            owner_profile_id = next(p.id for p in profiles if getattr(p, 'isDefaultPro', False) and p.id in matching_profiles)
        elif matching_profiles:
            owner_profile_id = matching_profiles[0]
        else:
            owner_profile_id = nb_entry.profileId if nb_entry else (profiles[0].id if profiles else "main")

        owner_email = profile_map[owner_profile_id].email.lower() if owner_profile_id in profile_map and profile_map[owner_profile_id].email else ""

        existing_collaborators = set()
        status_res = await run_nlm_cmd(["share", "status", nb_id, "--profile", owner_profile_id, "--json"], timeout=20)
        if status_res["success"]:
            try:
                data = json.loads(status_res["stdout"])
                for c in data.get("collaborators", []):
                    c_email = (c.get("email") or "").strip().lower()
                    if c_email:
                        existing_collaborators.add(c_email)
                    if c.get("role") == "owner" and c_email:
                        owner_email = c_email
            except Exception as e:
                logger.warning(f"Could not parse share status for notebook {nb_id}: {e}")

        if target_profile_ids:
            target_profiles = [profile_map[pid] for pid in target_profile_ids if pid in profile_map]
        else:
            target_profiles = [p for p in profiles if p.id != owner_profile_id]

        for target in target_profiles:
            target_email = (target.email or "").strip().lower()
            if not target_email:
                continue

            if target_email == owner_email:
                total_skipped_owner += 1
                results.append({
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "targetProfileId": target.id,
                    "targetEmail": target.email,
                    "status": "owner",
                    "message": "Account is already notebook owner"
                })
                continue

            if target_email in existing_collaborators:
                total_already_shared += 1
                results.append({
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "targetProfileId": target.id,
                    "targetEmail": target.email,
                    "status": "already_shared",
                    "message": "Account already has access"
                })
                continue

            invite_res = await run_nlm_cmd([
                "share", "invite", nb_id, target_email,
                "--role", role,
                "--profile", owner_profile_id
            ], timeout=25)

            if invite_res["success"]:
                total_shared += 1
                existing_collaborators.add(target_email)
                results.append({
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "targetProfileId": target.id,
                    "targetEmail": target.email,
                    "status": "shared",
                    "message": f"Successfully invited as {role}"
                })
            else:
                total_failed += 1
                results.append({
                    "notebookId": nb_id,
                    "notebookTitle": nb_title,
                    "targetProfileId": target.id,
                    "targetEmail": target.email,
                    "status": "failed",
                    "message": invite_res.get("stderr") or "Invitation failed"
                })

    # Populate local cache entries for shared notebooks so UI displays them immediately under target profiles
    try:
        from backend.storage import save_cached_notebooks
        from backend.models import Notebook
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
                        new_entries.append(Notebook(
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
                            course_code=master_nb.course_code
                        ))
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
        "details": results
    }

async def auto_share_study_notebooks(
    notebooks: Optional[List[Any]] = None,
    role: str = "editor"
) -> Dict[str, Any]:
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
            "details": []
        }

    logger.info(f"Auto-sharing {len(study_ids)} study course notebooks across all registered accounts...")
    return await batch_share_notebooks_to_accounts(notebook_ids=study_ids, role=role)

async def check_or_share_with_pro(notebook_id: str, source_profile_id: str, pro_email: str) -> bool:
    """Backward-compatible wrapper for Pro fallback sharing."""
    return await ensure_notebook_shared(notebook_id, source_profile_id, pro_email)

async def query_notebook_with_pro_fallback(
    profile_id: str,
    notebook_id: str,
    question: str,
    conversation_id: Optional[str] = None,
    pro_profile_id: Optional[str] = None,
    pro_email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Queries a notebook under its home profile. If a rate limit or quota exhaustion
    is encountered and a Pro profile is configured, automatically shares the notebook
    with the Pro account and re-dispatches the query through the Pro AI engine.
    """
    # 1. First attempt with home profile
    res = await query_notebook(profile_id, notebook_id, question, conversation_id=conversation_id)
    if res.get("success"):
        res["handledByProFallback"] = False
        return res

    # 2. Check if eligible for Pro fallback
    err_message = str(res.get("error", ""))
    is_quota_hit = is_rate_limit_or_quota_error(err_message)

    can_fallback = (
        pro_profile_id
        and profile_id != pro_profile_id
        and (is_quota_hit or "failed" in err_message.lower())
    )

    if not can_fallback:
        res["handledByProFallback"] = False
        return res

    logger.warning(
        f"[PRO FALLBACK TRIGGERED] Rate limit or quota error on '{profile_id}': {err_message}. "
        f"Switching to Pro AI engine '{pro_profile_id}' ({pro_email})..."
    )

    # 3. Share notebook with Pro account if needed
    if pro_email:
        await check_or_share_with_pro(notebook_id, profile_id, pro_email)

    # 4. Retry query via the Pro AI account
    pro_res = await query_notebook(pro_profile_id, notebook_id, question, conversation_id=conversation_id)
    if pro_res.get("success"):
        pro_res["handledByProFallback"] = True
        pro_res["fallbackReason"] = f"Standard account ({profile_id}) reached quota limit. Seamlessly answered by Pro AI."
        pro_res["originalProfileId"] = profile_id
        return pro_res
    else:
        # If fallback also failed, return composite error
        return {
            "success": False,
            "error": f"Initial query failed on '{profile_id}' ({err_message}). Pro AI fallback also failed: {pro_res.get('error')}",
            "handledByProFallback": True,
            "conversationId": conversation_id
        }

async def synthesize_with_gemini(
    question: str,
    sub_results: List[Dict[str, Any]],
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Second-stage synthesis pass:
    Takes answers and citations retrieved from multiple Google notebooks and synthesizes
    them into a unified comparative intelligence brief using Google Gemini.
    """
    active_key = api_key if api_key is not None else GEMINI_API_KEY
    if not active_key:
        logger.info("[Super-NLM Synthesis] GEMINI_API_KEY is not set. Skipping stage 2 LLM synthesis.")
        return {
            "success": False,
            "error": "GEMINI_API_KEY is not configured.",
            "synthesizedBrief": None,
            "model": None
        }

    # Format multi-notebook sources with explicit titles and profile IDs
    evidence_blocks = []
    for item in sub_results:
        res = item.get("result", {})
        title = item.get("title") or item.get("notebookId")
        profile = item.get("profileId")
        if res.get("success") and res.get("answer"):
            evidence_blocks.append(
                f"### Notebook: {title} (Account Profile: {profile})\n{res['answer'].strip()}\n"
            )

    if not evidence_blocks:
        return {
            "success": False,
            "error": "No valid notebook answers were retrieved to synthesize.",
            "synthesizedBrief": None,
            "model": None
        }

    evidence_text = "\n\n".join(evidence_blocks)

    system_instruction = (
        "You are the Super-NLM Cross-Notebook Intelligence Synthesizer. "
        "Your role is to perform a rigorous, deterministic, and unified synthesis across independent Google NotebookLM notebooks. "
        "Resolve overlapping or conflicting statements, de-duplicate shared insights, "
        "highlight key differences or unique findings from each notebook, and maintain strict factual grounding "
        "with explicit attribution (e.g. `[Notebook Title]`).\n\n"
        "Structure your output strictly in clean GitHub-flavored Markdown using these exact section headers:\n"
        "# 📑 Executive Synthesis Brief\n"
        "## 🔍 1. Key Reconciled Findings & Consensus\n"
        "## ⚖️ 2. Cross-Notebook Comparison & Matrix\n"
        "## 💡 3. Divergences & Unique Source Insights\n"
        "## 🎯 4. Actionable Takeaways & Next Steps"
    )

    user_prompt = (
        f"Research Goal / User Question: \"{question}\"\n\n"
        f"--- EVIDENCE RETRIEVED FROM {len(evidence_blocks)} INDEPENDENT NOTEBOOK(S) ---\n\n"
        f"{evidence_text}\n\n"
        f"--- SYNTHESIS REQUIREMENTS ---\n"
        f"1. Directly answer the user's research goal by synthesizing insights across all provided notebooks into a unified report.\n"
        f"2. Explicitly reconcile consensus vs. distinct points between notebooks.\n"
        f"3. Include a comparative markdown table in Section 2 highlighting key parameters or positions across sources.\n"
        f"4. Cite or attribute data points, file names, statistics, and claims to their source notebook.\n"
        f"5. Eliminate redundant filler or repetitious boilerplate.\n"
        f"6. Maintain high information density and professional technical rigor."
    )

    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "topP": 0.95,
            "maxOutputTokens": 4096
        }
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        last_error = ""
        for model in SYNTHESIS_FALLBACK_MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={active_key}"
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            text = parts[0]["text"].strip()
                            logger.info(f"[Super-NLM Synthesis] Successfully synthesized with model '{model}'")
                            return {
                                "success": True,
                                "synthesizedBrief": text,
                                "model": model,
                                "error": None
                            }
                else:
                    err_json = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    err_msg = err_json.get("error", {}).get("message") or resp.text[:200]
                    last_error = f"Model {model} returned HTTP {resp.status_code}: {err_msg}"
                    logger.warning(f"[Super-NLM Synthesis] {last_error}. Trying next fallback...")
            except Exception as e:
                last_error = f"Model {model} failed with exception: {e}"
                logger.warning(f"[Super-NLM Synthesis] {last_error}. Trying next fallback...")

        return {
            "success": False,
            "error": last_error or "All Gemini synthesis models were unavailable.",
            "synthesizedBrief": None,
            "model": None
        }

async def synthesize_cross_notebook(
    notebooks: List[NotebookRef],
    question: str,
    synthesizer_profile_id: str
) -> Dict[str, Any]:
    """
    Stage 1: Queries multiple notebooks concurrently via nlm with quota fallback, retries, and deterministic ordering.
    Stage 2: Synthesizes the retrieved knowledge into a stable, unified comparative brief via Google Gemini.
    """
    from backend.storage import get_profiles
    profiles = await get_profiles()
    pro_profile_id = None
    pro_email = None
    for p in profiles:
        if p.isDefaultPro or getattr(p, "tier", "") == "pro":
            pro_profile_id = p.id
            pro_email = p.email
            break

    # 1. Concurrently query each notebook with quota fallback and a 1-shot retry on failure
    async def _query_single(ref: NotebookRef):
        # First attempt with home profile and Pro fallback
        ans = await query_notebook_with_pro_fallback(
            profile_id=ref.profileId,
            notebook_id=ref.notebookId,
            question=question,
            pro_profile_id=pro_profile_id,
            pro_email=pro_email
        )
        # If initial attempt failed, 1-shot retry
        if not ans.get("success"):
            logger.warning(f"[Cross Synthesis] Notebook {ref.title or ref.notebookId} on {ref.profileId} failed ({ans.get('error')}). Retrying once...")
            await asyncio.sleep(1.0)
            ans = await query_notebook_with_pro_fallback(
                profile_id=ref.profileId,
                notebook_id=ref.notebookId,
                question=question,
                pro_profile_id=pro_profile_id,
                pro_email=pro_email
            )
        return {
            "notebookId": ref.notebookId,
            "profileId": ref.profileId,
            "title": ref.title or ref.notebookId,
            "result": ans
        }

    sub_results = await asyncio.gather(*[_query_single(ref) for ref in notebooks])

    # Sort deterministically by title / notebookId to guarantee stable evidence order
    sub_results = sorted(sub_results, key=lambda x: (str(x.get("title") or "").lower(), str(x.get("notebookId"))))

    # 2. Extract partial answers for raw source context
    partial_summaries = []
    for item in sub_results:
        res = item["result"]
        title = item["title"]
        profile = item["profileId"]
        if res.get("success") and res.get("answer"):
            fallback_note = " *(Served via Pro AI Fallback)*" if res.get("handledByProFallback") else ""
            partial_summaries.append(f"### Source Notebook: {title} (Profile: {profile}){fallback_note}\n{res['answer']}\n")
        else:
            err_detail = res.get("error") or "No answer returned or query failed"
            partial_summaries.append(f"### Source Notebook: {title} (Profile: {profile})\n*⚠️ {err_detail}*")

    combined_context = "\n\n".join(partial_summaries)

    # 3. Stage 2 Pro AI Cross-Notebook Synthesis
    synth_res = await synthesize_with_gemini(question, sub_results)

    is_synthesized = synth_res.get("success", False)
    synthesized_brief = synth_res.get("synthesizedBrief")
    synthesis_model = synth_res.get("model")

    return {
        "success": True,
        "question": question,
        "synthesizerProfileId": synthesizer_profile_id,
        "isSynthesized": is_synthesized,
        "synthesisModel": synthesis_model,
        "synthesizedBrief": synthesized_brief,
        "combinedContext": combined_context,
        "notebookResults": sub_results,
        "synthesisError": synth_res.get("error") if not is_synthesized else None
    }

def launch_cli_login(profile_id: str, clear: bool = True):
    """
    Launches an interactive console window running 'nlm login --profile <id> [--clear]'
    so the user can log into their Google account with Chrome.
    """
    if not re.match(r'^[a-zA-Z0-9_\-]{1,64}$', profile_id):
        raise ValueError(f"Invalid profile_id: {profile_id}")

    flags = ["login", "--profile", profile_id]
    if clear:
        flags.append("--clear")

    cmd_args = [NLM_EXECUTABLE] + flags

    if sys.platform == "win32":
        quoted_cmd = subprocess.list2cmdline(cmd_args)
        console_cmd = f'cmd.exe /k "echo Logging in to Super-NLM profile: {profile_id}... && {quoted_cmd} && echo. && echo Profile auth complete! You can close this window now. && pause"'
        subprocess.Popen(
            console_cmd,
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        )
    else:
        logger.info(f"Launching login CLI for profile: {profile_id}")
        subprocess.Popen(cmd_args)

async def delete_cli_profile(profile_id: str) -> bool:
    res = await run_nlm_cmd(["login", "profile", "delete", profile_id], timeout=15)
    return res["success"]

async def rename_cli_profile(old_id: str, new_id: str) -> bool:
    res = await run_nlm_cmd(["login", "profile", "rename", old_id, new_id], timeout=15)
    return res.get("success", False)

# ----------------- PLAN USAGE & QUOTA LIMITS -----------------

async def fetch_profile_usage(profile: AccountProfile, timeout: int = 25) -> ProfileUsage:
    """
    Fetches live plan usage limits for a profile using 'nlm usage --profile <id> --json'.
    Returns a ProfileUsage model with rolling and weekly quotas and reset timestamps.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    res = await run_nlm_cmd(["usage", "--profile", profile.id, "--json"], timeout=timeout)
    if not res["success"]:
        err_msg = (res.get("stderr") or "").strip() or (res.get("stdout") or "").strip() or "Failed to fetch usage limits"
        return ProfileUsage(
            profile_id=profile.id,
            display_name=profile.displayName,
            email=profile.email,
            tier=profile.tier,
            color=profile.color,
            is_default_pro=bool(getattr(profile, "isDefaultPro", False)),
            status="error",
            windows=[],
            error=err_msg,
            fetched_at=now_iso
        )

    try:
        data = json.loads(res["stdout"])
        windows_data = data.get("windows", [])
        windows = [
            UsageWindow(
                window=w.get("window", "unknown"),
                percent_used=round(float(w.get("percent_used", 0.0)), 2),
                percent_remaining=round(float(w.get("percent_remaining", 100.0)), 2),
                resets_at=w.get("resets_at")
            )
            for w in windows_data
        ]
        tier_raw = data.get("tier", profile.tier)
        tier_label = "pro" if "PRO" in str(tier_raw).upper() else profile.tier

        return ProfileUsage(
            profile_id=profile.id,
            display_name=profile.displayName,
            email=profile.email,
            tier=tier_label,
            color=profile.color,
            is_default_pro=bool(getattr(profile, "isDefaultPro", False)),
            status="connected",
            windows=windows,
            error=None,
            fetched_at=now_iso
        )
    except Exception as e:
        logger.error(f"Error parsing usage JSON for profile {profile.id}: {e}")
        return ProfileUsage(
            profile_id=profile.id,
            display_name=profile.displayName,
            email=profile.email,
            tier=profile.tier,
            color=profile.color,
            is_default_pro=bool(getattr(profile, "isDefaultPro", False)),
            status="error",
            windows=[],
            error=f"JSON parse error: {e}",
            fetched_at=now_iso
        )

async def fetch_fleet_usage(profiles: List[AccountProfile]) -> FleetUsageResponse:
    """
    Concurrently fetches usage limits for all profiles with bounded concurrency (Semaphore=3).
    Computes aggregate metrics (average rolling usage, healthy/warning/critical counts).
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    sem = asyncio.Semaphore(3)

    async def _fetch_with_sem(p: AccountProfile) -> ProfileUsage:
        async with sem:
            return await fetch_profile_usage(p)

    tasks = [_fetch_with_sem(p) for p in profiles]
    results: List[ProfileUsage] = await asyncio.gather(*tasks)

    connected_count = sum(1 for r in results if r.status == "connected")
    rolling_percents = []
    healthy_count = 0
    warning_count = 0
    critical_count = 0

    for r in results:
        rolling_win = next((w for w in r.windows if w.window == "rolling"), None)
        if rolling_win:
            used = rolling_win.percent_used
            rolling_percents.append(used)
            if used >= 90.0:
                critical_count += 1
            elif used >= 70.0:
                warning_count += 1
            else:
                healthy_count += 1
        elif r.status == "connected":
            healthy_count += 1

    avg_used = sum(rolling_percents) / len(rolling_percents) if rolling_percents else 0.0

    return FleetUsageResponse(
        total_accounts=len(profiles),
        connected_accounts=connected_count,
        average_rolling_used=round(avg_used, 1),
        healthy_count=healthy_count,
        warning_count=warning_count,
        critical_count=critical_count,
        profiles=results,
        fetched_at=now_iso
    )

# ----------------- STUDIO ARTIFACT CREATION & DOWNLOAD -----------------

async def create_studio_artifact(
    profile_id: str,
    notebook_id: str,
    artifact_type: str = "video",
    format_option: Optional[str] = None,
    style: Optional[str] = None,
    custom_prompt: Optional[str] = None,
    quantity: Optional[int] = None,
    difficulty: Optional[str] = None
) -> Dict[str, Any]:
    """
    Triggers creation of a studio artifact (video, audio, report, quiz, flashcards, mindmap, slides, etc.)
    using 'nlm <artifact_type> create <notebook_id> --profile <profile_id> --confirm [flags]'.
    """
    artifact_type_lower = artifact_type.lower().strip()
    args = [artifact_type_lower, "create", notebook_id, "--profile", profile_id, "--confirm", "--json"]

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
            args.extend(["--difficulty", difficulty])
        if quantity and artifact_type_lower == "quiz":
            args.extend(["--count", str(quantity)])

    logger.info(f"[Studio Create] Dispatching '{artifact_type_lower}' for notebook '{notebook_id}' on profile '{profile_id}'")
    res = await run_nlm_cmd(args, timeout=90)
    return res

async def get_studio_status(profile_id: str, notebook_id: str) -> List[Dict[str, Any]]:
    """
    Fetches the studio artifact status list for a given notebook and profile.
    Returns a list of dicts with artifact details (id, type, status, title, created_at).
    """
    res = await run_nlm_cmd(["studio", "status", notebook_id, "--profile", profile_id, "--json"], timeout=30)
    if not res.get("success"):
        logger.warning(f"[Studio Status] Failed for notebook '{notebook_id}' on profile '{profile_id}': {res.get('stderr')}")
        return []

    try:
        data = json.loads(res["stdout"])
        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and "artifacts" in data:
            return data["artifacts"]
        return []
    except Exception as e:
        logger.warning(f"[Studio Status] Failed to parse JSON response: {e}")
        return []

async def download_studio_artifact(
    profile_id: str,
    notebook_id: str,
    artifact_type: str,
    artifact_id: Optional[str],
    output_filepath: str
) -> Dict[str, Any]:
    """
    Downloads a studio artifact to the specified local file path.
    """
    artifact_type_lower = artifact_type.lower().strip()
    # Map model artifact types to download command types
    cmd_type_map = {
        "video": "video",
        "audio": "audio",
        "report": "report",
        "slides": "slide-deck",
        "infographic": "infographic",
        "mindmap": "mind-map",
        "quiz": "quiz",
        "flashcards": "flashcards",
        "data-table": "data-table"
    }
    cmd_type = cmd_type_map.get(artifact_type_lower, artifact_type_lower)
    args = ["download", cmd_type, notebook_id, "--output", output_filepath, "--no-progress"]
    if artifact_id:
        args.extend(["--id", artifact_id])

    logger.info(f"[Studio Download] Downloading '{cmd_type}' for notebook '{notebook_id}' to '{output_filepath}'")
    res = await run_nlm_cmd(args, timeout=180)
    return res


