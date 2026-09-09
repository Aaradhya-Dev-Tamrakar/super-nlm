import logging
from typing import List, Optional, Dict, Any

from mcp.server.mcpserver import MCPServer
from backend.storage import (
    get_profiles,
    get_cached_notebooks,
    save_cached_notebooks,
    save_profile
)
from backend.nlm_client import (
    fetch_all_notebooks_concurrently,
    synthesize_cross_notebook,
    get_cli_profiles
)
from backend.models import NotebookRef
from mcp_server.rotator import rotator

logger = logging.getLogger("super_nlm.tools")

def register_tools(server: MCPServer):
    """Registers all Super-NLM tools onto the MCPServer instance."""

    @server.tool()
    async def query_notebook(
        notebook_id: str,
        query: str,
        conversation_id: Optional[str] = None,
        source_ids: Optional[str] = None,
        timeout: int = 120,
        new_conversation: bool = False
    ) -> Dict[str, Any]:
        """
        Ask questions to a Google NotebookLM notebook with automatic multi-account rotation.
        Rotates between all authenticated Google accounts per query to preserve quota across
        parallel agents. If an account encounters a rate limit / 429, it automatically places
        that account in cooldown and transparently retries on the next available account.

        Args:
            notebook_id: UUID or alias of the target Google Notebook.
            query: Question or instruction to send to the notebook.
            conversation_id: Optional conversation ID for continuing multi-turn chat.
            source_ids: Optional comma-separated source IDs to restrict focus (default: all sources).
            timeout: Query timeout in seconds (default: 120).
            new_conversation: Whether to start a fresh conversation instead of reusing context.
        """
        return await rotator.execute_query_rotated(
            notebook_id=notebook_id,
            question=query,
            conversation_id=conversation_id,
            source_ids=source_ids,
            timeout=timeout,
            new_conversation=new_conversation
        )

    @server.tool()
    async def list_notebooks(
        search: Optional[str] = None,
        profile_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        List all notebooks across all connected Google accounts from the Super-NLM cache.
        Does not consume Google API quota.

        Args:
            search: Optional filter keyword matching notebook title or account name/email.
            profile_id: Optional filter to only show notebooks from a specific profile.
        """
        notebooks = await get_cached_notebooks()

        if profile_id and profile_id != "all":
            notebooks = [n for n in notebooks if n.profileId == profile_id]

        if search:
            s = search.lower().strip()
            notebooks = [
                n for n in notebooks
                if s in n.title.lower() or s in n.profileName.lower() or s in n.profileEmail.lower()
            ]

        return [n.model_dump() for n in notebooks]

    @server.tool()
    async def list_profiles() -> List[Dict[str, Any]]:
        """
        List all configured Google accounts in Super-NLM with their tiers, emails,
        and connection statuses.
        """
        profiles = await rotator.get_active_profiles()
        return [p.model_dump() for p in profiles]

    @server.tool()
    async def sync_notebooks() -> Dict[str, Any]:
        """
        Force a fresh sync of all notebooks from Google across every authenticated profile.
        Updates the local notebook cache and profile stats.
        """
        profiles = await get_profiles()
        cached = await get_cached_notebooks()
        result = await fetch_all_notebooks_concurrently(profiles, fallback_cached=cached)
        notebooks = result["notebooks"]
        for p in profiles:
            await save_profile(p)
        await save_cached_notebooks(notebooks)
        return {
            "total_notebooks_synced": len(notebooks),
            "profile_counts": result.get("profile_counts", {})
        }

    @server.tool()
    async def cross_query(
        notebook_ids: List[str],
        query: str,
        synthesizer_profile_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Query multiple notebooks across different accounts simultaneously and synthesize the
        findings into a cohesive summary. Each notebook query is automatically routed and rotated.

        Args:
            notebook_ids: List of notebook UUIDs to consult.
            query: The question to ask across all chosen notebooks.
            synthesizer_profile_id: Optional profile to use for final synthesis (defaults to Pro AI).
        """
        cached_notebooks = await get_cached_notebooks()
        refs: List[NotebookRef] = []
        for nid in notebook_ids:
            found = next((n for n in cached_notebooks if n.id == nid), None)
            if found:
                refs.append(NotebookRef(notebookId=nid, profileId=found.profileId, title=found.title))
            else:
                refs.append(NotebookRef(notebookId=nid, profileId="default", title=nid))

        # Select synthesizer profile
        synthesizer = synthesizer_profile_id
        if not synthesizer:
            profiles = await get_profiles()
            pro_profile = next((p for p in profiles if p.isDefaultPro), None)
            synthesizer = pro_profile.id if pro_profile else (profiles[0].id if profiles else "default")

        return await synthesize_cross_notebook(refs, query, synthesizer)

    @server.tool()
    async def rotation_status() -> Dict[str, Any]:
        """
        Get real-time diagnostic information on the account rotation engine, including:
        - Monotonic global query counter
        - Per-account query/success/quota exhaustion statistics
        - Active cooldown timers for throttled accounts
        - Number of auto-shared notebook pairs cached
        """
        return await rotator.get_status()
