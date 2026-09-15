import asyncio
import datetime
import logging
import time
from typing import List, Dict, Any, Optional, Set, Tuple

from backend.models import AccountProfile, Notebook
from backend.storage import get_profiles, get_cached_notebooks
from backend.nlm_client import (
    query_notebook,
    ensure_notebook_shared,
    is_rate_limit_or_quota_error,
    classify_quota_error,
    get_cli_profiles
)

logger = logging.getLogger("super_nlm.rotator")

def get_seconds_until_next_utc_midnight() -> float:
    """Calculates seconds remaining until 00:00 UTC with a 60s safety buffer."""
    now = datetime.datetime.now(datetime.timezone.utc)
    tomorrow = (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    diff = (tomorrow - now).total_seconds() + 60.0
    return max(3600.0, diff)

class AccountRotator:
    """
    Manages round-robin account rotation for Super-NLM notebook queries.
    Distributes query workload across all authenticated Google accounts to
    prevent single-account quota exhaustion during parallel agent execution.

    Distinguishes between:
      1. Short-term burst rate limits (HTTP 429 / RPM) -> 120s cooldown.
      2. Hard daily quota caps (RPD) -> Cooldown until midnight UTC (~12-24h).
    """

    def __init__(self, burst_cooldown_duration: float = 120.0):
        self._lock = asyncio.Lock()
        self._counter: int = 0
        self._burst_cooldown_duration = burst_cooldown_duration
        # profile_id -> {"expires_at": float, "reason": "burst" | "daily", "details": str}
        self._cooldowns: Dict[str, Dict[str, Any]] = {}
        # (notebook_id, target_email) -> True if sharing has been verified
        self._shared_cache: Set[Tuple[str, str]] = set()
        # conversation_id -> profile_id to pin multi-turn chat sessions to the same Google account
        self._conversation_owners: Dict[str, str] = {}
        # profile_id -> current in-flight concurrent queries
        self._inflight: Dict[str, int] = {}
        # profile_id -> stats
        self._stats: Dict[str, Dict[str, int]] = {}

    def _ensure_stats_entry(self, profile_id: str):
        if profile_id not in self._stats:
            self._stats[profile_id] = {
                "queries_dispatched": 0,
                "queries_succeeded": 0,
                "burst_429_hits": 0,
                "daily_cap_hits": 0,
                "other_errors": 0
            }

    def _acquire_inflight(self, profile_id: str):
        self._inflight[profile_id] = self._inflight.get(profile_id, 0) + 1

    def _release_inflight(self, profile_id: str):
        if profile_id in self._inflight:
            self._inflight[profile_id] = max(0, self._inflight[profile_id] - 1)

    async def get_active_profiles(self) -> List[AccountProfile]:
        """
        Retrieves all valid accounts from storage and syncs their emails with CLI state.
        """
        profiles = await get_profiles()
        try:
            cli_profiles = await get_cli_profiles()
            for p in profiles:
                if p.id in cli_profiles and cli_profiles[p.id]:
                    p.email = cli_profiles[p.id]
                    p.status = "connected"
        except Exception as e:
            logger.debug(f"Could not refresh CLI profiles: {e}")

        # Return connected profiles, or all profiles if none marked connected
        connected = [p for p in profiles if p.status != "expired"]
        return connected if connected else profiles

    async def get_pro_profiles(self) -> List[AccountProfile]:
        """Returns all active profiles with pro tier."""
        profiles = await self.get_active_profiles()
        pro_pool = [p for p in profiles if getattr(p, "tier", "").lower() == "pro"]
        return pro_pool if pro_pool else profiles

    async def pick_next_profile(
        self,
        exclude_ids: Optional[Set[str]] = None,
        require_pro: bool = False
    ) -> Tuple[AccountProfile, int]:
        """
        Atomically selects the next account profile using least-loaded round-robin order.
        If require_pro is True, restricts candidates to the Pro fleet pool.
        Skips profiles that are currently under burst or daily quota cooldown.
        If all accounts are cooling down, prioritizes burst-cooldown accounts over daily-exhausted ones.
        """
        async with self._lock:
            all_profiles = await self.get_active_profiles()
            if not all_profiles:
                raise RuntimeError("No Google account profiles configured in Super-NLM.")

            # Filter for Pro tier if requested
            if require_pro:
                pro_candidates = [p for p in all_profiles if getattr(p, "tier", "").lower() == "pro"]
                candidate_pool = pro_candidates if pro_candidates else all_profiles
            else:
                candidate_pool = all_profiles

            exclude = exclude_ids or set()
            now = time.time()

            # Clean expired cooldowns
            expired = [pid for pid, info in self._cooldowns.items() if now >= info["expires_at"]]
            for pid in expired:
                del self._cooldowns[pid]

            # Filter out explicitly excluded profiles (e.g. from current retry chain)
            available = [p for p in candidate_pool if p.id not in exclude]
            if not available:
                # If everything excluded, fallback to any profile in candidate pool
                available = candidate_pool

            # Identify candidates that are not in any cooldown
            active_candidates = [p for p in available if p.id not in self._cooldowns]

            if active_candidates:
                # Find the minimum in-flight load among active candidates
                min_inflight = min(self._inflight.get(p.id, 0) for p in active_candidates)
                least_loaded = [p for p in active_candidates if self._inflight.get(p.id, 0) == min_inflight]

                # Round-robin among the least-loaded candidates
                idx = self._counter % len(least_loaded)
                selected = least_loaded[idx]
                self._counter += 1
                curr_idx = self._counter
                self._ensure_stats_entry(selected.id)
                self._stats[selected.id]["queries_dispatched"] += 1
                return selected, curr_idx

            # If all available accounts are in cooldown:
            # Prioritize short burst accounts (0) over daily-exhausted accounts (1), then lowest in-flight, then soonest expiry
            logger.warning("All eligible profiles are currently in cooldown! Picking closest recovery candidate.")
            soonest_profile = min(
                available,
                key=lambda p: (
                    0 if self._cooldowns.get(p.id, {}).get("reason") == "burst" else 1,
                    self._inflight.get(p.id, 0),
                    self._cooldowns.get(p.id, {}).get("expires_at", float("inf"))
                )
            )
            self._counter += 1
            curr_idx = self._counter
            self._ensure_stats_entry(soonest_profile.id)
            self._stats[soonest_profile.id]["queries_dispatched"] += 1
            return soonest_profile, curr_idx

    def mark_quota_exhausted(
        self,
        profile_id: str,
        error_type: str = "burst",
        details: str = "",
        custom_duration: Optional[float] = None
    ):
        """
        Places an account into cooldown based on limit classification:
          - 'burst': short-term 429/RPM rate limit -> 120s cooldown.
          - 'daily': hard daily quota ceiling -> cooldown until next midnight UTC.
        """
        self._ensure_stats_entry(profile_id)

        if error_type == "daily":
            duration = custom_duration or get_seconds_until_next_utc_midnight()
            self._stats[profile_id]["daily_cap_hits"] += 1
            reason_label = "DAILY hard quota cap"
        else:
            duration = custom_duration or self._burst_cooldown_duration
            self._stats[profile_id]["burst_429_hits"] += 1
            reason_label = "BURST 429/concurrency limit"

        expiry = time.time() + duration
        self._cooldowns[profile_id] = {
            "expires_at": expiry,
            "reason": error_type,
            "details": details or reason_label
        }
        logger.warning(
            f"Profile '{profile_id}' placed in {reason_label} cooldown for "
            f"{duration:.0f}s ({duration/3600:.1f}h) until {expiry}"
        )

    def record_success(self, profile_id: str):
        """Records a successful query on a profile and removes any lingering cooldown."""
        self._cooldowns.pop(profile_id, None)
        self._ensure_stats_entry(profile_id)
        self._stats[profile_id]["queries_succeeded"] += 1

    def record_error(self, profile_id: str):
        """Records a non-quota error."""
        self._ensure_stats_entry(profile_id)
        self._stats[profile_id]["other_errors"] += 1

    async def ensure_profile_has_access(self, notebook_id: str, profile: AccountProfile) -> bool:
        """
        Ensures the given profile has access to the notebook.
        If the notebook is owned by another profile, shares it automatically.
        Results are cached in memory to avoid repetitive CLI overhead.
        """
        if not profile.email:
            return True

        cache_key = (notebook_id, profile.email.lower())
        async with self._lock:
            if cache_key in self._shared_cache:
                return True

        try:
            cached_notebooks = await get_cached_notebooks()
            notebook_entry = next((n for n in cached_notebooks if n.id == notebook_id), None)

            # If the profile itself is the owner, access is granted
            if notebook_entry and notebook_entry.profileId == profile.id:
                async with self._lock:
                    self._shared_cache.add(cache_key)
                return True

            # If owned by another account, invite this account
            if notebook_entry and notebook_entry.profileId != profile.id:
                source_profile_id = notebook_entry.profileId
                logger.info(
                    f"Auto-sharing notebook {notebook_id} from owner '{source_profile_id}' "
                    f"with query account '{profile.id}' ({profile.email})"
                )
                success = await ensure_notebook_shared(notebook_id, source_profile_id, profile.email)
                if success:
                    async with self._lock:
                        self._shared_cache.add(cache_key)
                return success
        except Exception as e:
            logger.warning(f"Error checking or auto-sharing notebook {notebook_id}: {e}")

        # Fallback: assume access exists
        async with self._lock:
            self._shared_cache.add(cache_key)
        return True

    async def execute_query_rotated(
        self,
        notebook_id: str,
        question: str,
        conversation_id: Optional[str] = None,
        source_ids: Optional[Any] = None,
        timeout: int = 120,
        new_conversation: bool = False,
        max_attempts: Optional[int] = None,
        require_pro: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Executes a query with intelligent multi-account load balancing, in-flight concurrency
        tracking, Pro fleet equalization, and automatic multi-node failover.
        """
        # Detect if pro account is requested via flag or natural language in question
        if require_pro is None:
            q_lower = question.lower()
            pro_triggers = [
                "use pro", "pro account", "pro model", "pro tier", "via pro",
                "with pro", "using pro", "direct pro", "only pro", "pro engine",
                "require pro", "[pro]"
            ]
            require_pro = any(trigger in q_lower for trigger in pro_triggers)

        profiles = await self.get_active_profiles()
        limit_attempts = max_attempts or max(len(profiles), 2)

        # Multi-turn session pinning: if conversation_id is provided and known, pin to owner
        pinned_profile_id = None
        if conversation_id and not new_conversation:
            async with self._lock:
                pinned_profile_id = self._conversation_owners.get(conversation_id)

        excluded: Set[str] = set()
        attempt_history = []

        for attempt in range(1, limit_attempts + 1):
            if pinned_profile_id and pinned_profile_id not in excluded:
                profile = next((p for p in profiles if p.id == pinned_profile_id), None)
                if not profile:
                    profile, query_number = await self.pick_next_profile(
                        exclude_ids=excluded,
                        require_pro=bool(require_pro)
                    )
                else:
                    query_number = self._counter + 1
            else:
                profile, query_number = await self.pick_next_profile(
                    exclude_ids=excluded,
                    require_pro=bool(require_pro)
                )

            logger.info(
                f"[ROTATION #{query_number} | Attempt {attempt}/{limit_attempts}] Dispatching query to notebook '{notebook_id}' "
                f"using profile '{profile.id}' ({profile.email or 'no email'}, tier: {profile.tier}, inflight: {self._inflight.get(profile.id, 0)})"
            )

            # Track in-flight concurrency for this profile
            async with self._lock:
                self._acquire_inflight(profile.id)

            try:
                # 1. Ensure access
                await self.ensure_profile_has_access(notebook_id, profile)

                # 2. Run query
                res = await query_notebook(
                    profile_id=profile.id,
                    notebook_id=notebook_id,
                    question=question,
                    conversation_id=conversation_id,
                    source_ids=source_ids,
                    timeout=timeout,
                    new_conversation=new_conversation
                )
            finally:
                async with self._lock:
                    self._release_inflight(profile.id)

            # 3. Check for success
            if res.get("success"):
                self.record_success(profile.id)
                final_conv_id = res.get("conversationId") or conversation_id
                if final_conv_id:
                    async with self._lock:
                        self._conversation_owners[final_conv_id] = profile.id
                return {
                    "success": True,
                    "answer": res.get("answer"),
                    "citations": res.get("citations", []),
                    "conversation_id": final_conv_id,
                    "rotation_stats": {
                        "mode": "pro_fleet" if require_pro else "standard_rotation",
                        "global_query_count": query_number,
                        "executed_profile_id": profile.id,
                        "executed_profile_email": profile.email,
                        "executed_profile_tier": profile.tier,
                        "inflight_queries": self._inflight.get(profile.id, 0),
                        "attempts_count": attempt,
                        "quota_fallbacks_triggered": len(attempt_history)
                    }
                }

            # Handle failure & classify quota error
            err_msg = str(res.get("error") or "")
            quota_type = classify_quota_error(err_msg)

            attempt_history.append({
                "profile_id": profile.id,
                "email": profile.email,
                "error": err_msg,
                "quota_classification": quota_type
            })

            if quota_type:
                logger.warning(
                    f"Quota exhausted on profile '{profile.id}' [{quota_type.upper()}]: {err_msg}. "
                    f"Triggering seamless rotation fallback..."
                )
                self.mark_quota_exhausted(profile.id, error_type=quota_type, details=err_msg)
                excluded.add(profile.id)
                # Continue loop to next account
                continue
            else:
                self.record_error(profile.id)
                # Non-quota error (e.g. invalid query or notebook id)
                return {
                    "success": False,
                    "error": err_msg,
                    "conversation_id": conversation_id,
                    "rotation_stats": {
                        "global_query_count": query_number,
                        "executed_profile_id": profile.id,
                        "attempts_count": attempt,
                        "attempt_history": attempt_history
                    }
                }

        # If all attempts exhausted
        return {
            "success": False,
            "error": f"All account profiles exhausted quota or failed. Attempt history: {attempt_history}",
            "conversation_id": conversation_id,
            "rotation_stats": {
                "attempts_count": len(attempt_history),
                "attempt_history": attempt_history
            }
        }

    async def check_all_profiles_health(self) -> Dict[str, Any]:
        """
        Proactively probes all configured profiles to verify authentication and CLI connectivity.
        Returns a structured health report identifying active vs degraded accounts.
        """
        profiles = await get_profiles()
        cli_profiles = {}
        try:
            cli_profiles = await get_cli_profiles()
        except Exception as e:
            logger.warning(f"Could not read CLI profile list during health check: {e}")

        now = time.time()
        health_results = []
        healthy_count = 0

        for p in profiles:
            is_cli_known = p.id in cli_profiles or (p.email and p.email in cli_profiles.values())
            cooldown_info = self._cooldowns.get(p.id)
            is_cooling_down = False
            cooldown_reason = None
            remaining_seconds = 0.0

            if cooldown_info:
                remaining = cooldown_info["expires_at"] - now
                if remaining > 0:
                    is_cooling_down = True
                    cooldown_reason = cooldown_info.get("reason", "burst")
                    remaining_seconds = round(remaining, 1)
                else:
                    self._cooldowns.pop(p.id, None)

            if not is_cli_known and p.status != "connected":
                status = "auth_expired"
            elif is_cooling_down:
                status = "cooling_down"
            else:
                status = "healthy"
                healthy_count += 1

            health_results.append({
                "id": p.id,
                "displayName": p.displayName,
                "email": p.email or cli_profiles.get(p.id, ""),
                "tier": p.tier,
                "status": status,
                "is_cli_authenticated": is_cli_known,
                "inflight_queries": self._inflight.get(p.id, 0),
                "is_cooling_down": is_cooling_down,
                "cooldown_reason": cooldown_reason,
                "cooldown_remaining_seconds": remaining_seconds,
                "stats": self._stats.get(p.id, {
                    "queries_dispatched": 0,
                    "queries_succeeded": 0,
                    "burst_429_hits": 0,
                    "daily_cap_hits": 0,
                    "other_errors": 0
                })
            })

        return {
            "fleet_status": "optimal" if healthy_count == len(profiles) else "degraded" if healthy_count > 0 else "offline",
            "total_nodes": len(profiles),
            "healthy_nodes": healthy_count,
            "cooling_down_nodes": sum(1 for r in health_results if r["status"] == "cooling_down"),
            "auth_expired_nodes": sum(1 for r in health_results if r["status"] == "auth_expired"),
            "total_inflight_queries": sum(self._inflight.values()),
            "profiles": health_results
        }

    async def get_status(self) -> Dict[str, Any]:
        """Returns the current state of rotation, in-flight concurrency, cooldowns, and per-profile counts."""
        async with self._lock:
            now = time.time()
            profiles = await self.get_active_profiles()

            # Active cooldowns with remaining time & reason
            cooldown_info = {}
            for pid, info in self._cooldowns.items():
                remaining = max(0.0, info["expires_at"] - now)
                if remaining > 0:
                    cooldown_info[pid] = {
                        "reason": info.get("reason", "burst"),
                        "cooldown_remaining_seconds": round(remaining, 1),
                        "cooldown_remaining_hours": round(remaining / 3600, 2),
                        "expires_at": round(info["expires_at"], 1),
                        "details": info.get("details", "")
                    }

            pro_profiles = [p for p in profiles if getattr(p, "tier", "").lower() == "pro"]
            total_inflight = sum(self._inflight.values())

            return {
                "global_query_counter": self._counter,
                "burst_cooldown_duration_setting": self._burst_cooldown_duration,
                "total_profiles_in_pool": len(profiles),
                "pro_fleet_size": len(pro_profiles),
                "total_inflight_queries": total_inflight,
                "profiles": [
                    {
                        "id": p.id,
                        "displayName": p.displayName,
                        "email": p.email,
                        "tier": p.tier,
                        "isDefaultPro": p.isDefaultPro,
                        "inflight_queries": self._inflight.get(p.id, 0),
                        "is_cooling_down": p.id in cooldown_info,
                        "cooldown_type": cooldown_info[p.id]["reason"] if p.id in cooldown_info else None,
                        "cooldown": cooldown_info.get(p.id),
                        "stats": self._stats.get(p.id, {
                            "queries_dispatched": 0,
                            "queries_succeeded": 0,
                            "burst_429_hits": 0,
                            "daily_cap_hits": 0,
                            "other_errors": 0
                        })
                    }
                    for p in profiles
                ],
                "active_cooldowns": cooldown_info,
                "cached_shared_notebook_pairs_count": len(self._shared_cache)
            }

# Global singleton rotator instance
rotator = AccountRotator()
