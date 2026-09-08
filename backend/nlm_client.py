import sys
import asyncio
import json
import logging
import subprocess
import re
from typing import List, Dict, Any, Optional
from backend.config import NLM_EXECUTABLE
from backend.models import AccountProfile, Notebook, NotebookRef

logger = logging.getLogger(__name__)

# Windows Process Optimization Flags:
# CREATE_NO_WINDOW (0x08000000) prevents spawning unnecessary conhost processes
# for background CLI execution on Windows, reducing latency significantly.
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

def _run_subprocess_sync(cmd: List[str], timeout: int) -> Dict[str, Any]:
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=CREATE_NO_WINDOW,
            timeout=timeout,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        return {
            "returncode": res.returncode,
            "stdout": res.stdout.replace("\r\n", "\n").strip(),
            "stderr": res.stderr.replace("\r\n", "\n").strip(),
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
        loop = asyncio.get_running_loop()
        # On Windows, SelectorEventLoop (used by uvicorn reload) does not support create_subprocess_exec
        if sys.platform == "win32" and isinstance(loop, getattr(asyncio, "_WindowsSelectorEventLoop", ())):
            return await asyncio.to_thread(_run_subprocess_sync, cmd, timeout)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=CREATE_NO_WINDOW
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        out_str = stdout.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
        err_str = stderr.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()

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

async def fetch_notebooks_for_profile(profile: AccountProfile) -> List[Notebook]:
    """
    Fetches all notebooks for a given profile with error resilience.
    """
    res = await run_nlm_cmd(["notebook", "list", "--profile", profile.id, "--json"], timeout=45)
    if not res["success"]:
        err_msg = res.get("stderr") or "Unknown error"
        logger.warning(f"Failed to fetch notebooks for profile {profile.id}: {err_msg}")
        raise RuntimeError(f"Failed to fetch notebooks for profile {profile.id}: {err_msg}")

    try:
        data = json.loads(res["stdout"])
        notebooks = []
        for item in data:
            notebooks.append(Notebook(
                id=item.get("id", ""),
                title=item.get("title", "Untitled Notebook"),
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
    Fetches notebooks for all profiles simultaneously.
    Retains cached notebooks if a profile fails to sync.
    """
    tasks = [fetch_notebooks_for_profile(p) for p in profiles]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_notebooks: List[Notebook] = []
    profile_counts: Dict[str, int] = {}
    cached_by_profile: Dict[str, List[Notebook]] = {}
    if fallback_cached:
        for n in fallback_cached:
            cached_by_profile.setdefault(n.profileId, []).append(n)

    for profile, res in zip(profiles, results):
        if isinstance(res, list):
            all_notebooks.extend(res)
            profile_counts[profile.id] = len(res)
            profile.status = "connected"
            profile.notebookCount = len(res)
        else:
            logger.warning(f"Profile '{profile.id}' sync failed: {res}")
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

    # Sort notebooks by updated_at descending (latest first)
    all_notebooks.sort(key=lambda n: n.updated_at or "", reverse=True)
    return {
        "notebooks": all_notebooks,
        "profile_counts": profile_counts
    }

async def query_notebook(profile_id: str, notebook_id: str, question: str) -> Dict[str, Any]:
    """
    Runs a query against a specific notebook under a specific profile.
    """
    res = await run_nlm_cmd([
        "query", "notebook", notebook_id, question,
        "--profile", profile_id,
        "--json",
        "--timeout", "120"
    ], timeout=130)

    if not res["success"]:
        return {
            "success": False,
            "error": res["stderr"] or "Query failed or timed out",
            "answer": None
        }

    try:
        data = json.loads(res["stdout"])
        # Format can be string or structured dict with 'answer' and 'citations'
        if isinstance(data, dict):
            return {
                "success": True,
                "answer": data.get("answer") or data.get("text") or str(data),
                "citations": data.get("citations", []),
                "raw": data
            }
        else:
            return {
                "success": True,
                "answer": str(data),
                "citations": [],
                "raw": data
            }
    except Exception:
        # Fallback to plain text if stdout is not JSON
        return {
            "success": True,
            "answer": res["stdout"],
            "citations": [],
            "raw": res["stdout"]
        }

def is_rate_limit_or_quota_error(err: str) -> bool:
    """Detects if an error message indicates rate limiting or quota exhaustion."""
    if not err:
        return False
    lower = err.lower()
    signals = [
        "rate limit", "quota", "429", "too many requests",
        "resource has been exhausted", "resource_exhausted",
        "exceeded", "throttled", "limit reached"
    ]
    return any(sig in lower for sig in signals)

async def check_or_share_with_pro(notebook_id: str, source_profile_id: str, pro_email: str) -> bool:
    """
    Checks if the Pro account is already a collaborator on the notebook.
    If not, automatically invites the Pro account as an editor.
    """
    if not pro_email:
        return False

    # Check current sharing status
    status_res = await run_nlm_cmd(["share", "status", notebook_id, "--profile", source_profile_id, "--json"], timeout=20)
    if status_res["success"]:
        try:
            data = json.loads(status_res["stdout"])
            collaborators = data.get("collaborators", [])
            for c in collaborators:
                if c.get("email", "").lower() == pro_email.lower():
                    logger.info(f"Notebook {notebook_id} is already shared with Pro AI ({pro_email})")
                    return True
        except Exception as e:
            logger.warning(f"Could not parse share status for notebook {notebook_id}: {e}")

    # Invite Pro account
    logger.info(f"Inviting Pro AI ({pro_email}) to notebook {notebook_id} via profile {source_profile_id}")
    invite_res = await run_nlm_cmd([
        "share", "invite", notebook_id, pro_email,
        "--role", "editor",
        "--profile", source_profile_id
    ], timeout=25)

    return invite_res["success"]

async def query_notebook_with_pro_fallback(
    profile_id: str,
    notebook_id: str,
    question: str,
    pro_profile_id: Optional[str] = None,
    pro_email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Queries a notebook under its home profile. If a rate limit or quota exhaustion
    is encountered and a Pro profile is configured, automatically shares the notebook
    with the Pro account and re-dispatches the query through the Pro AI engine.
    """
    # 1. First attempt with home profile
    res = await query_notebook(profile_id, notebook_id, question)
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
    pro_res = await query_notebook(pro_profile_id, notebook_id, question)
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
            "handledByProFallback": True
        }

async def synthesize_cross_notebook(
    notebooks: List[NotebookRef],
    question: str,
    synthesizer_profile_id: str
) -> Dict[str, Any]:
    """
    Queries multiple notebooks (potentially across different accounts) and synthesizes
    the findings using the synthesizer profile (e.g. the Pro AI account).
    """
    # 1. Concurrently query each notebook
    async def _query_single(ref: NotebookRef):
        ans = await query_notebook(ref.profileId, ref.notebookId, question)
        return {
            "notebookId": ref.notebookId,
            "profileId": ref.profileId,
            "title": ref.title or ref.notebookId,
            "result": ans
        }

    sub_results = await asyncio.gather(*[_query_single(ref) for ref in notebooks])

    # 2. Extract partial answers
    partial_summaries = []
    for item in sub_results:
        res = item["result"]
        if res.get("success") and res.get("answer"):
            partial_summaries.append(f"### Source Notebook: {item['title']} (Profile: {item['profileId']})\n{res['answer']}\n")
        else:
            partial_summaries.append(f"### Source Notebook: {item['title']}\n*Could not retrieve answer or no relevant sources.*")

    combined_context = "\n\n".join(partial_summaries)

    return {
        "success": True,
        "question": question,
        "synthesizerProfileId": synthesizer_profile_id,
        "combinedContext": combined_context,
        "notebookResults": sub_results
    }

def launch_cli_login(profile_id: str, clear: bool = True):
    """
    Launches an interactive console window on Windows running 'nlm login --profile <id> [--clear]'
    so the user can log into their Google account with Chrome.
    """
    flags = ["login", "--profile", profile_id]
    if clear:
        flags.append("--clear")

    cmd = f'"{NLM_EXECUTABLE}" ' + " ".join(flags)
    # Open new Windows cmd window so the browser/auth prompt is visible to the user
    subprocess.Popen(
        f'cmd.exe /k "echo Logging in to Super-NLM profile: {profile_id}... && {cmd} && echo. && echo Profile auth complete! You can close this window now. && pause"',
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )

async def delete_cli_profile(profile_id: str) -> bool:
    res = await run_nlm_cmd(["login", "profile", "delete", profile_id], timeout=15)
    return res["success"]
