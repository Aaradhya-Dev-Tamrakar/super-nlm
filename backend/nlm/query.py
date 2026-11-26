"""Notebook query execution, quota error classification, and Gemini synthesis."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from backend.config import GEMINI_API_KEY, SYNTHESIS_FALLBACK_MODELS
from backend.http_pool import get_http_client
from backend.models import NotebookRef

logger = logging.getLogger("backend.nlm_client")


def _facade():
    import backend.nlm_client as facade

    return facade


async def query_notebook(
    profile_id: str,
    notebook_id: str,
    question: str,
    conversation_id: str | None = None,
    source_ids: Any | None = None,
    timeout: int = 120,
    new_conversation: bool = False,
) -> dict[str, Any]:
    """
    Runs a query against a specific notebook under a specific profile.
    Supports multi-turn context via conversation_id.
    """
    args = [
        "query",
        "notebook",
        notebook_id,
        question,
        "--profile",
        profile_id,
        "--json",
        "--timeout",
        str(timeout),
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

    res = await _facade().run_nlm_cmd(args, timeout=timeout + 15)

    clean_stdout = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", res.get("stdout") or "").strip()
    clean_stderr = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", res.get("stderr") or "").strip()

    if not res["success"]:
        err_msg = ""
        if clean_stdout:
            try:
                err_data = json.loads(clean_stdout)
                if isinstance(err_data, dict):
                    err_msg = err_data.get("error") or err_data.get("message") or ""
            except (ValueError, TypeError) as parse_err:
                logger.debug("CLI error stdout was not JSON: %s", parse_err)
        if not err_msg:
            err_msg = clean_stderr or clean_stdout or "Query failed or timed out"

        if conversation_id and not new_conversation and any(
            k in err_msg.lower() for k in ["conversation", "session", "expired", "invalid", "not found"]
        ):
            logger.warning(f"[Query Notebook] Stale conversation_id {conversation_id} failed ({err_msg}). Retrying with fresh session...")
            return await _facade().query_notebook(
                profile_id=profile_id,
                notebook_id=notebook_id,
                question=question,
                conversation_id=None,
                source_ids=source_ids,
                timeout=timeout,
                new_conversation=True,
            )

        return {
            "success": False,
            "error": err_msg,
            "answer": None,
            "conversationId": conversation_id,
        }

    try:
        data = json.loads(clean_stdout)
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
                    "conversationId": conversation_id,
                }
            return {
                "success": True,
                "answer": answer_text if answer_text is not None else str(data),
                "citations": data.get("citations", []),
                "conversationId": data.get("conversation_id") or conversation_id,
                "raw": data,
            }
        return {
            "success": True,
            "answer": str(data),
            "citations": [],
            "conversationId": conversation_id,
            "raw": data,
        }
    except Exception:
        return {
            "success": True,
            "answer": clean_stdout,
            "citations": [],
            "conversationId": conversation_id,
            "raw": res.get("stdout"),
        }


def classify_quota_error(err: str) -> str | None:
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
        "quota exceeded for today",
    ]
    if any(sig in lower for sig in daily_signals):
        return "daily"

    burst_signals = [
        "rate limit",
        "quota",
        "429",
        "too many requests",
        "resource has been exhausted",
        "resource_exhausted",
        "exceeded",
        "throttled",
        "limit reached",
        "temporarily unavailable",
        "503",
        "service unavailable",
        "overloaded",
        "backend error",
    ]
    if any(sig in lower for sig in burst_signals):
        return "burst"

    return None


def is_rate_limit_or_quota_error(err: str) -> bool:
    """Detects if an error message indicates rate limiting or quota exhaustion."""
    return classify_quota_error(err) is not None


async def query_notebook_with_pro_fallback(
    profile_id: str,
    notebook_id: str,
    question: str,
    conversation_id: str | None = None,
    pro_profile_id: str | None = None,
    pro_email: str | None = None,
) -> dict[str, Any]:
    """
    Queries a notebook under its home profile. If a rate limit or quota exhaustion
    is encountered and a Pro profile is configured, automatically shares the notebook
    with the Pro account and re-dispatches the query through the Pro AI engine.
    """
    facade = _facade()
    res = await facade.query_notebook(profile_id, notebook_id, question, conversation_id=conversation_id)
    if res.get("success"):
        res["handledByProFallback"] = False
        return res

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

    if pro_email:
        await facade.check_or_share_with_pro(notebook_id, profile_id, pro_email)

    pro_res = await facade.query_notebook(pro_profile_id, notebook_id, question, conversation_id=conversation_id)
    if pro_res.get("success"):
        pro_res["handledByProFallback"] = True
        pro_res["fallbackReason"] = f"Standard account ({profile_id}) reached quota limit. Seamlessly answered by Pro AI."
        pro_res["originalProfileId"] = profile_id
        return pro_res

    return {
        "success": False,
        "error": f"Initial query failed on '{profile_id}' ({err_message}). Pro AI fallback also failed: {pro_res.get('error')}",
        "handledByProFallback": True,
        "conversationId": conversation_id,
    }


async def synthesize_with_gemini(
    question: str,
    sub_results: list[dict[str, Any]],
    api_key: str | None = None,
) -> dict[str, Any]:
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
            "model": None,
        }

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
            "model": None,
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
        f'Research Goal / User Question: "{question}"\n\n'
        f"--- EVIDENCE RETRIEVED FROM {len(evidence_blocks)} INDEPENDENT NOTEBOOK(S) ---\n\n"
        f"{evidence_text}\n\n"
        "--- SYNTHESIS REQUIREMENTS ---\n"
        "1. Directly answer the user's research goal by synthesizing insights across all provided notebooks into a unified report.\n"
        "2. Explicitly reconcile consensus vs. distinct points between notebooks.\n"
        "3. Include a comparative markdown table in Section 2 highlighting key parameters or positions across sources.\n"
        "4. Cite or attribute data points, file names, statistics, and claims to their source notebook.\n"
        "5. Eliminate redundant filler or repetitious boilerplate.\n"
        "6. Maintain high information density and professional technical rigor."
    )

    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "topP": 0.95,
            "maxOutputTokens": 4096,
        },
    }

    client = await get_http_client()
    last_error = ""
    for model in SYNTHESIS_FALLBACK_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={active_key}"
        try:
            resp = await client.post(url, json=payload, timeout=60.0)
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
                            "error": None,
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
        "model": None,
    }


async def synthesize_cross_notebook(
    notebooks: list[NotebookRef],
    question: str,
    synthesizer_profile_id: str,
) -> dict[str, Any]:
    """
    Stage 1: Queries multiple notebooks concurrently via nlm with quota fallback, retries, and deterministic ordering.
    Stage 2: Synthesizes the retrieved knowledge into a stable, unified comparative brief via Google Gemini.
    """
    from backend.storage import get_profiles

    facade = _facade()
    profiles = await get_profiles()
    selected_profile = next(
        (
            p
            for p in profiles
            if p.id == synthesizer_profile_id
            and p.status == "connected"
            and getattr(p, "tier", "").lower() == "pro"
        ),
        None,
    )
    if selected_profile is None:
        selected_profile = next(
            (
                p
                for p in profiles
                if p.isDefaultPro
                and p.status == "connected"
                and getattr(p, "tier", "").lower() == "pro"
            ),
            None,
        )
    if selected_profile is None:
        selected_profile = next(
            (p for p in profiles if p.status == "connected" and getattr(p, "tier", "").lower() == "pro"),
            None,
        )

    pro_profile_id = selected_profile.id if selected_profile else None
    pro_email = selected_profile.email if selected_profile else None
    if selected_profile:
        logger.info(
            "[Cross Synthesis] Using synthesizer profile '%s' (%s)",
            selected_profile.id,
            selected_profile.email or "no email",
        )

    async def _query_single(ref: NotebookRef):
        ans = await facade.query_notebook_with_pro_fallback(
            profile_id=ref.profileId,
            notebook_id=ref.notebookId,
            question=question,
            pro_profile_id=pro_profile_id,
            pro_email=pro_email,
        )
        if not ans.get("success"):
            logger.warning(f"[Cross Synthesis] Notebook {ref.title or ref.notebookId} on {ref.profileId} failed ({ans.get('error')}). Retrying once...")
            await asyncio.sleep(1.0)
            ans = await facade.query_notebook_with_pro_fallback(
                profile_id=ref.profileId,
                notebook_id=ref.notebookId,
                question=question,
                pro_profile_id=pro_profile_id,
                pro_email=pro_email,
            )
        return {
            "notebookId": ref.notebookId,
            "profileId": ref.profileId,
            "title": ref.title or ref.notebookId,
            "result": ans,
        }

    sub_results = await asyncio.gather(*[_query_single(ref) for ref in notebooks])
    sub_results = sorted(sub_results, key=lambda x: (str(x.get("title") or "").lower(), str(x.get("notebookId"))))

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

    synth_res = await facade.synthesize_with_gemini(question, sub_results)

    is_synthesized = synth_res.get("success", False)
    synthesized_brief = synth_res.get("synthesizedBrief")
    synthesis_model = synth_res.get("model")

    return {
        "success": True,
        "question": question,
        "synthesizerProfileId": selected_profile.id if selected_profile else synthesizer_profile_id,
        "isSynthesized": is_synthesized,
        "synthesisModel": synthesis_model,
        "synthesizedBrief": synthesized_brief,
        "combinedContext": combined_context,
        "notebookResults": sub_results,
        "synthesisError": synth_res.get("error") if not is_synthesized else None,
    }
