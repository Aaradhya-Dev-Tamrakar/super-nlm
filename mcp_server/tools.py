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
    get_cli_profiles,
    batch_share_notebooks_to_accounts,
    auto_share_study_notebooks
)
from backend.models import NotebookRef, detect_course_info
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
        new_conversation: bool = False,
        use_pro: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Ask questions to a Google NotebookLM notebook with automatic multi-account rotation
        or direct Pro account execution.

        By default, rotates between all authenticated Google accounts per query to preserve quota.
        If 'use_pro' is True, or if the query contains phrases like 'use pro', 'pro account',
        'pro model', 'with pro', etc., the query routes directly to your Pro AI account.

        Args:
            notebook_id: UUID or alias of the target Google Notebook.
            query: Question or instruction to send to the notebook.
            conversation_id: Optional conversation ID for continuing multi-turn chat.
            source_ids: Optional comma-separated source IDs to restrict focus (default: all sources).
            timeout: Query timeout in seconds (default: 120).
            new_conversation: Whether to start a fresh conversation instead of reusing context.
            use_pro: Set to True to directly route to the Pro AI account (bypassing round-robin).
                     If omitted/None, auto-detects mentions of 'pro' in the query string.
        """
        return await rotator.execute_query_rotated(
            notebook_id=notebook_id,
            question=query,
            conversation_id=conversation_id,
            source_ids=source_ids,
            timeout=timeout,
            new_conversation=new_conversation,
            require_pro=use_pro
        )

    @server.tool()
    async def list_notebooks(
        search: Optional[str] = None,
        profile_id: Optional[str] = None,
        category: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        List all notebooks across all connected Google accounts from the Super-NLM cache.
        Does not consume Google API quota.

        Args:
            search: Optional filter keyword matching notebook title, account name/email, or course code.
            profile_id: Optional filter to only show notebooks from a specific profile.
            category: Optional filter: "study" (course NLMs), "projects", or "all".
        """
        notebooks = await get_cached_notebooks()

        for n in notebooks:
            is_study, course_code, cat = detect_course_info(n.title, n.id)
            n.is_study = is_study
            n.course_code = course_code
            n.category = cat

        if category and category.lower() != "all":
            cat_lower = category.lower().strip()
            if cat_lower in ("study", "courses", "course"):
                notebooks = [n for n in notebooks if n.is_study]
            elif cat_lower in ("projects", "project", "other"):
                notebooks = [n for n in notebooks if not n.is_study]

        if profile_id and profile_id != "all":
            notebooks = [n for n in notebooks if n.profileId == profile_id]

        if search:
            s = search.lower().strip()
            notebooks = [
                n for n in notebooks
                if s in n.title.lower() or s in n.profileName.lower() or s in n.profileEmail.lower() or (n.course_code and s in n.course_code.lower())
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

    @server.tool()
    async def batch_share_notebooks(
        notebook_ids: List[str],
        target_profile_ids: Optional[List[str]] = None,
        role: str = "editor",
        auto_sync: bool = True
    ) -> Dict[str, Any]:
        """
        Batch shares one or more notebooks across specified (or all other registered) Google accounts.

        Args:
            notebook_ids: List of notebook UUIDs to share.
            target_profile_ids: Optional list of target profile IDs (e.g. ['dev83', 'project-01']).
                                If omitted, shares with all other registered accounts.
            role: Access role to grant ('editor' or 'viewer'). Default: 'editor'.
            auto_sync: Whether to trigger a cache sync after invitations are dispatched. Default: True.
        """
        res = await batch_share_notebooks_to_accounts(
            notebook_ids=notebook_ids,
            target_profile_ids=target_profile_ids,
            role=role
        )
        if auto_sync:
            try:
                profiles = await get_profiles()
                cached = await get_cached_notebooks()
                sync_result = await fetch_all_notebooks_concurrently(profiles, fallback_cached=cached)
                notebooks = sync_result["notebooks"]
                for p in profiles:
                    await save_profile(p)
                await save_cached_notebooks(notebooks)
                res["synced"] = True
                res["total_synced_notebooks"] = len(notebooks)
            except Exception as e:
                logger.warning(f"Post-batch-share sync failed: {e}")
                res["synced"] = False
        return res

    @server.tool()
    async def auto_share_study_courses(
        role: str = "editor",
        auto_sync: bool = True
    ) -> Dict[str, Any]:
        """
        Automatically detects all Study / Course notebooks (e.g. CT653, EX751, CT704, EX752, ME708, EX725)
        and ensures they are automatically shared across all configured Google accounts.

        Args:
            role: Access role to grant ('editor' or 'viewer'). Default: 'editor'.
            auto_sync: Whether to trigger a cache sync after invitations are dispatched. Default: True.
        """
        cached = await get_cached_notebooks()
        res = await auto_share_study_notebooks(cached, role=role)
        if auto_sync:
            try:
                profiles = await get_profiles()
                sync_result = await fetch_all_notebooks_concurrently(profiles, fallback_cached=cached)
                notebooks = sync_result["notebooks"]
                for p in profiles:
                    await save_profile(p)
                await save_cached_notebooks(notebooks)
                res["synced"] = True
                res["total_synced_notebooks"] = len(notebooks)
            except Exception as e:
                logger.warning(f"Post-auto-share sync failed: {e}")
                res["synced"] = False
        return res

    @server.tool()
    async def get_agenda(days: int = 7) -> Dict[str, Any]:
        """
        Retrieves upcoming events from Google Calendar (classes, labs, exams, deadlines)
        with smart automatic matching against Google NotebookLM course/project notebooks.

        Args:
            days: Number of days ahead to search for events (default: 7, max: 30).
        """
        from backend.calendar_service import calendar_service
        notebooks = await get_cached_notebooks()
        agenda = await calendar_service.get_agenda(notebooks, days=min(days, 30))
        return agenda.model_dump()

    @server.tool()
    async def schedule_batch_creation(
        notebook_ids: List[str],
        artifact_type: str = "video",
        format_option: str = "cinematic",
        style: str = "auto_select",
        custom_prompt: Optional[str] = None,
        quantity: Optional[int] = None,
        difficulty: Optional[str] = None,
        preferred_profile_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Schedules a batch of heavy studio generations (e.g. Cinematic Videos, Audio Overviews, Study Guides)
        across multiple notebooks. Jobs are placed into an autonomous rotating multi-account queue.

        Even if account 5-hour rolling limits are hit, jobs are accepted and automatically executed
        round-robin as accounts reset or become available, preventing 429 quota exhaustion.

        Args:
            notebook_ids: List of notebook UUIDs to generate artifacts for.
            artifact_type: Type of artifact ('video', 'audio', 'report', 'quiz', 'flashcards', 'mindmap', 'slides'). Default: 'video'.
            format_option: Format option (e.g., 'cinematic', 'explainer', 'deep_dive', 'study-guide'). Default: 'cinematic'.
            style: Visual style for videos ('auto_select', 'whiteboard', 'anime', etc.). Default: 'auto_select'.
            custom_prompt: Optional focus steering prompt or creative instruction.
            quantity: Optional question count (for quizzes).
            difficulty: Optional difficulty ('easy', 'medium', 'hard').
            preferred_profile_id: Optional specific Google account profile ID to target.
        """
        from backend.models import BatchScheduleRequest
        from backend.scheduler import scheduler

        cached = await get_cached_notebooks()
        nb_map = {n.id: n.title for n in cached}
        req = BatchScheduleRequest(
            notebook_ids=notebook_ids,
            artifact_type=artifact_type,
            format_option=format_option,
            style=style,
            custom_prompt=custom_prompt,
            quantity=quantity,
            difficulty=difficulty,
            preferred_profile_id=preferred_profile_id
        )
        res = await scheduler.schedule_batch(req, nb_map)
        return res.model_dump()

    @server.tool()
    async def get_scheduled_queue(status_filter: Optional[str] = None) -> Dict[str, Any]:
        """
        Returns the current state of the rotating multi-account creation queue,
        active worker accounts, and all pending, in-progress, and completed generation jobs.

        Args:
            status_filter: Optional filter ('queued', 'scheduled', 'in_progress', 'completed', 'failed', 'cancelled').
        """
        from backend.scheduler import scheduler
        status = scheduler.get_status()
        if status_filter:
            status.jobs = [j for j in status.jobs if j.status == status_filter]
        return status.model_dump()

    @server.tool()
    async def cancel_scheduled_job(job_id: str) -> Dict[str, Any]:
        """
        Cancels a queued or scheduled artifact generation job by its UUID.

        Args:
            job_id: Unique job UUID to cancel.
        """
        from backend.scheduler import scheduler
        success = await scheduler.cancel_job(job_id)
        return {"success": success, "job_id": job_id}

    # ----------------- HYBRID FOLDER MAPPING TOOLS -----------------

    @server.tool()
    async def map_notebook_folder(
        notebook_id: str,
        target_path: str,
        folder_type: Optional[str] = None,
        display_name: Optional[str] = None,
        auto_sync: bool = False,
        recursive: bool = False
    ) -> Dict[str, Any]:
        """
        Map a local filesystem folder (e.g. 'F:\\College\\Semester 7\\CT704') or a
        Google Drive Web Folder URL/ID to a NotebookLM notebook.

        Args:
            notebook_id: Notebook UUID to attach the folder to.
            target_path: Local folder path or Google Drive Web folder URL/ID.
            folder_type: Optional explicit type ('local_folder' or 'drive_web'). Auto-detected if omitted.
            display_name: Optional friendly display name for the folder.
            auto_sync: Whether to auto-check on schedule.
            recursive: Whether to scan nested subdirectories (default False).
        """
        from datetime import datetime
        from pathlib import Path
        from backend.models import FolderMapping
        from backend.storage import save_folder_mapping
        from backend.drive_sync_service import drive_sync_service, normalize_folder_target

        f_type, target = normalize_folder_target(target_path)
        if folder_type:
            f_type = folder_type

        mapping = FolderMapping(
            notebook_id=notebook_id,
            folder_type=f_type,
            target_path=target,
            display_name=display_name.strip() if display_name else Path(target).name,
            auto_sync=auto_sync,
            recursive=recursive,
            last_scanned=datetime.now().isoformat()
        )
        await save_folder_mapping(mapping)
        status = await drive_sync_service.get_folder_status(notebook_id)
        return status.model_dump()

    @server.tool()
    async def get_folder_status(notebook_id: str) -> Dict[str, Any]:
        """
        Check the status of a notebook's mapped folder, compare folder files against
        currently ingested notebook sources, list new un-ingested files and stale Drive docs,
        and show the 300-source capacity meter.

        Args:
            notebook_id: Notebook UUID to inspect.
        """
        from backend.drive_sync_service import drive_sync_service
        status = await drive_sync_service.get_folder_status(notebook_id)
        return status.model_dump()

    @server.tool()
    async def sync_notebook_folder(
        notebook_id: str,
        action: str = "ingest_new",
        selected_files: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Sequentially ingest new files from the mapped folder into the notebook,
        and/or refresh stale Google Drive sources, using a 1.5s delay to protect rate limits.

        Args:
            notebook_id: Target notebook UUID.
            action: Ingestion action: 'ingest_new' (only new files), 'sync_stale' (only stale docs), or 'full_sync'.
            selected_files: Optional list of filenames or paths to ingest. If omitted, processes all eligible files.
        """
        from backend.drive_sync_service import drive_sync_service
        res = await drive_sync_service.sync_folder(
            notebook_id=notebook_id,
            action=action,
            selected_files=selected_files
        )
        return res.model_dump()



