"""Account usage and quota polling helpers."""

from __future__ import annotations

import asyncio
import datetime
import json
import logging

from backend.models import AccountProfile, FleetUsageResponse, ProfileUsage, UsageWindow

logger = logging.getLogger("backend.nlm_client")


def _facade():
    import backend.nlm_client as facade

    return facade


async def fetch_profile_usage(profile: AccountProfile, timeout: int = 25) -> ProfileUsage:
    """
    Fetches live plan usage limits for a profile using 'nlm usage --profile <id> --json'.
    Returns a ProfileUsage model with rolling and weekly quotas and reset timestamps.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    res = await _facade().run_nlm_cmd(["usage", "--profile", profile.id, "--json"], timeout=timeout)
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
            fetched_at=now_iso,
        )

    try:
        data = json.loads(res["stdout"])
        windows_data = data.get("windows", [])
        windows = [
            UsageWindow(
                window=w.get("window", "unknown"),
                percent_used=round(float(w.get("percent_used", 0.0)), 2),
                percent_remaining=round(float(w.get("percent_remaining", 100.0)), 2),
                resets_at=w.get("resets_at"),
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
            fetched_at=now_iso,
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
            fetched_at=now_iso,
        )


async def fetch_fleet_usage(profiles: list[AccountProfile]) -> FleetUsageResponse:
    """
    Concurrently fetches usage limits for all profiles with bounded concurrency (Semaphore=3).
    Computes aggregate metrics (average rolling usage, healthy/warning/critical counts).
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    sem = asyncio.Semaphore(3)
    facade = _facade()

    async def _fetch_with_sem(p: AccountProfile) -> ProfileUsage:
        async with sem:
            return await facade.fetch_profile_usage(p)

    tasks = [_fetch_with_sem(p) for p in profiles]
    results: list[ProfileUsage] = await asyncio.gather(*tasks)

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
        fetched_at=now_iso,
    )
