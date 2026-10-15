"""Forward MCP queue mutations to a local Hub when it owns the scheduler lease."""

import os
from urllib.parse import urlparse

import httpx

from backend.config import SUPER_NLM_API_KEY
from backend.process_lease import ProcessLease


def queue_owned_elsewhere(scheduler) -> bool:
    if scheduler._lease and scheduler._lease.handle:
        return False
    from backend.scheduler import SCHEDULED_JOBS_FILE

    probe = ProcessLease(SCHEDULED_JOBS_FILE.with_suffix(".lock"))
    if not probe.acquire():
        return True
    probe.release()
    return False


def claim_scheduler(scheduler) -> bool:
    try:
        scheduler._ensure_owner()
        return True
    except RuntimeError as error:
        if "owned by another" in str(error):
            return False
        raise


async def forward_queue(action: str, payload: dict | None = None) -> dict:
    root = os.environ.get("SUPER_NLM_HUB_URL", "http://127.0.0.1:8000").rstrip("/")
    parsed = urlparse(root)
    if (
        parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.scheme not in {"http", "https"}
        or parsed.username
    ):
        raise ValueError("SUPER_NLM_HUB_URL must point to a local Hub on this host")
    headers = (
        {"Authorization": f"Bearer {SUPER_NLM_API_KEY}"} if SUPER_NLM_API_KEY else {}
    )
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{root}/api/fleet/scheduler/{action}",
                json=payload or {},
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as error:
        raise RuntimeError(
            f"Queue owner rejected {action}: HTTP {error.response.status_code}: {error.response.text}"
        ) from error
    except httpx.HTTPError as error:
        raise RuntimeError(
            "Another process owns the queue but its Hub is unavailable; configure SUPER_NLM_HUB_URL or use the owning MCP session"
        ) from error
