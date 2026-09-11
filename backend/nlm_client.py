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
from backend.models import AccountProfile, Notebook, NotebookRef

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

        extra_kwargs = {}
        if sys.platform == "win32":
            extra_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            **extra_kwargs
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
        "Your role is to perform a comprehensive, unified synthesis across independent Google NotebookLM notebooks. "
        "Resolve overlapping or conflicting statements, de-duplicate shared insights, "
        "highlight key differences or unique findings from each notebook, and maintain strict factual grounding "
        "with explicit attribution (e.g. `[Notebook Title]`). "
        "Format your output cleanly in GitHub-flavored markdown with an Executive Summary, Key Reconciled Findings / Diffs, "
        "and Actionable Takeaways."
    )

    user_prompt = (
        f"Research Goal / User Question: \"{question}\"\n\n"
        f"--- EVIDENCE RETRIEVED FROM {len(evidence_blocks)} INDEPENDENT NOTEBOOK(S) ---\n\n"
        f"{evidence_text}\n\n"
        f"--- SYNTHESIS REQUIREMENTS ---\n"
        f"1. Directly answer the user's research goal by synthesizing insights across all provided notebooks into a unified report.\n"
        f"2. Explicitly reconcile consensus vs. distinct points between notebooks.\n"
        f"3. Cite or attribute data points, file names, statistics, and claims to their source notebook.\n"
        f"4. Eliminate redundant filler or repetitious boilerplate.\n"
        f"5. Maintain high information density and professional technical rigor."
    )

    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 4096
        }
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
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
    Stage 1: Queries multiple notebooks (potentially across different accounts) concurrently via nlm.
    Stage 2: Synthesizes the retrieved knowledge into a unified comparative brief via Pro AI (Gemini).
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

    # 2. Extract partial answers for raw source context
    partial_summaries = []
    for item in sub_results:
        res = item["result"]
        if res.get("success") and res.get("answer"):
            partial_summaries.append(f"### Source Notebook: {item['title']} (Profile: {item['profileId']})\n{res['answer']}\n")
        else:
            err_detail = res.get("error") or "No answer returned or query failed"
            partial_summaries.append(f"### Source Notebook: {item['title']} (Profile: {item['profileId']})\n*⚠️ {err_detail}*")

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
