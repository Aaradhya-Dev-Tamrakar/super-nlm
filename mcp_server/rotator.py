import asyncio
import logging
import time
from typing import List, Dict, Any, Optional, Set, Tuple

from backend.models import AccountProfile, Notebook
from backend.storage import get_profiles, get_cached_notebooks
from backend.nlm_client import (
    query_notebook,
    ensure_notebook_shared,
    is_rate_limit_or_quota_error,
    get_cli_profiles
)

logger = logging.getLogger("super_nlm.rotator")

class AccountRotator:
    """
    Manages round-robin account rotation for Super-NLM notebook queries.
    Distributes query workload across all authenticated Google accounts to
    prevent single-account quota exhaustion during parallel agent execution.
    """

    def __init__(self, cooldown_duration: float = 120.0):
        self._lock = asyncio.Lock()
        self._counter: int = 0
        self._cooldown_duration = cooldown_duration
        # profile_id -> epoch timestamp when cooldown expires
        self._cooldowns: Dict[str, float] = {}
        # (notebook_id, target_email) -> True if sharing has been verified
        self._shared_cache: Set[Tuple[str, str]] = set()
        # profile_id -> stats
        self._stats: Dict[str, Dict[str, int]] = {}

    def _ensure_stats_entry(self, profile_id: str):
        if profile_id not in self._stats:
            self._stats[profile_id] = {
                "queries_dispatched": 0,
                "queries_succeeded": 0,
                "quota_exhausted_hits": 0,
                "other_errors": 0
            }

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

    async def pick_next_profile(self, exclude_ids: Optional[Set[str]] = None) -> Tuple[AccountProfile, int]:
        """
        Atomically selects the next account profile in round-robin order.
        Skips profiles that are currently under quota cooldown.
        If all accounts are cooling down, selects the one that recovers soonest.
        """
        async with self._lock:
            profiles = await self.get_active_profiles()
            if not profiles:
                raise RuntimeError("No Google account profiles configured in Super-NLM.")

            exclude = exclude_ids or set()
            now = time.time()

            # Clean expired cooldowns
            expired = [pid for pid, expiry in self._cooldowns.items() if now >= expiry]
            for pid in expired:
                del self._cooldowns[pid]

            # Filter out explicitly excluded profiles (e.g. from current retry chain)
            available = [p for p in profiles if p.id not in exclude]
            if not available:
                # If everything excluded, fallback to any profile
                available = profiles

            # Identify candidates that are not in cooldown
            active_candidates = [p for p in available if p.id not in self._cooldowns]

            if active_candidates:
                idx = self._counter % len(active_candidates)
                selected = active_candidates[idx]
                self._counter += 1
                curr_idx = self._counter
                self._ensure_stats_entry(selected.id)
                self._stats[selected.id]["queries_dispatched"] += 1
                return selected, curr_idx

            # If all available accounts are in cooldown, pick the one recovering soonest
            logger.warning("All eligible profiles are currently in cooldown! Picking closest recovery candidate.")
            soonest_profile = min(
                available,
                key=lambda p: self._cooldowns.get(p.id, float("inf"))
            )
            self._counter += 1
            curr_idx = self._counter
            self._ensure_stats_entry(soonest_profile.id)
            self._stats[soonest_profile.id]["queries_dispatched"] += 1
            return soonest_profile, curr_idx

    def mark_quota_exhausted(self, profile_id: str, cooldown_duration: Optional[float] = None):
        """Places an account into cooldown after a 429 or quota limit error."""
        duration = cooldown_duration or self._cooldown_duration
        expiry = time.time() + duration
        self._cooldowns[profile_id] = expiry
        self._ensure_stats_entry(profile_id)
        self._stats[profile_id]["quota_exhausted_hits"] += 1
        logger.warning(f"Profile '{profile_id}' placed in quota cooldown for {duration:.0f}s (until {expiry})")

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
        if cache_key in self._shared_cache:
            return True

        try:
            cached_notebooks = await get_cached_notebooks()
            notebook_entry = next((n for n in cached_notebooks if n.id == notebook_id), None)

            # If the profile itself is the owner, access is granted
            if notebook_entry and notebook_entry.profileId == profile.id:
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
                    self._shared_cache.add(cache_key)
                return success
        except Exception as e:
            logger.warning(f"Error checking or auto-sharing notebook {notebook_id}: {e}")

        # Fallback: assume access exists
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
        max_attempts: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Executes a query by rotating through available accounts.
        If an account hits quota / 429, it is placed in cooldown and the query
        is transparently retried on the next available account.
        """
        profiles = await self.get_active_profiles()
        limit_attempts = max_attempts or max(len(profiles), 2)

        excluded: Set[str] = set()
        attempt_history = []

        for attempt in range(1, limit_attempts + 1):
            profile, query_number = await self.pick_next_profile(exclude_ids=excluded)
            logger.info(
                f"[ROTATION #{query_number}] Dispatching query to notebook '{notebook_id}' "
                f"using profile '{profile.id}' ({profile.email or 'no email'}, tier: {profile.tier})"
            )

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

            # 3. Check for quota / rate limit error
            if res.get("success"):
                self.record_success(profile.id)
                return {
                    "success": True,
                    "answer": res.get("answer"),
                    "citations": res.get("citations", []),
                    "conversation_id": res.get("conversationId") or conversation_id,
                    "rotation_stats": {
                        "global_query_count": query_number,
                        "executed_profile_id": profile.id,
                        "executed_profile_email": profile.email,
                        "executed_profile_tier": profile.tier,
                        "attempts_count": attempt,
                        "quota_fallbacks_triggered": len(attempt_history)
                    }
                }

            # Handle failure
            err_msg = str(res.get("error") or "")
            is_quota = is_rate_limit_or_quota_error(err_msg)

            attempt_history.append({
                "profile_id": profile.id,
                "email": profile.email,
                "error": err_msg,
                "is_quota_exhausted": is_quota
            })

            if is_quota:
                logger.warning(
                    f"Quota exhausted on profile '{profile.id}' ({err_msg}). "
                    f"Triggering seamless rotation fallback..."
                )
                self.mark_quota_exhausted(profile.id)
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

    async def get_status(self) -> Dict[str, Any]:
        """Returns the current state of rotation, cooldowns, and per-profile counts."""
        async with self._lock:
            now = time.time()
            profiles = await self.get_active_profiles()

            # Active cooldowns with remaining time
            cooldown_info = {}
            for pid, expiry in self._cooldowns.items():
                remaining = max(0.0, expiry - now)
                if remaining > 0:
                    cooldown_info[pid] = {
                        "cooldown_remaining_seconds": round(remaining, 1),
                        "expires_at": round(expiry, 1)
                    }

            return {
                "global_query_counter": self._counter,
                "active_cooldown_duration_setting": self._cooldown_duration,
                "total_profiles_in_pool": len(profiles),
                "profiles": [
                    {
                        "id": p.id,
                        "displayName": p.displayName,
                        "email": p.email,
                        "tier": p.tier,
                        "isDefaultPro": p.isDefaultPro,
                        "is_cooling_down": p.id in cooldown_info,
                        "cooldown": cooldown_info.get(p.id),
                        "stats": self._stats.get(p.id, {
                            "queries_dispatched": 0,
                            "queries_succeeded": 0,
                            "quota_exhausted_hits": 0,
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
