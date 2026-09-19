import os
import re
import json
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from backend.config import (
    NLM_EXECUTABLE,
    NOTEBOOKLM_PRO_SOURCE_LIMIT,
    NOTEBOOKLM_STANDARD_SOURCE_LIMIT,
    NLM_NATIVE_DOCS,
    NLM_MEDIA_FORMATS,
    CODE_ADAPTER_EXTENSIONS,
    EXCEL_EXTENSIONS,
    IGNORED_EXTENSIONS
)
from backend.models import (
    FolderMapping, FolderFileItem, FolderStatusResponse,
    FolderSyncResponse, Notebook
)
from backend.storage import (
    get_folder_mapping, save_folder_mapping, delete_folder_mapping,
    get_cached_notebooks, save_cached_notebooks, get_profiles
)
from backend.nlm_client import run_nlm_cmd

logger = logging.getLogger(__name__)

# Regex patterns for Google Drive URL variations
DRIVE_FOLDER_REGEXES = [
    re.compile(r'drive\.google\.com/drive/(?:u/\d+/)?folders/([a-zA-Z0-9_-]{15,})', re.IGNORECASE),
    re.compile(r'drive\.google\.com/open\?id=([a-zA-Z0-9_-]{15,})', re.IGNORECASE),
    re.compile(r'^[a-zA-Z0-9_-]{25,50}$') # Raw Google Drive ID
]

def normalize_folder_target(target: str) -> Tuple[str, str]:
    """
    Determines if target is a local filesystem path or Google Drive Web Folder.
    Returns (folder_type: 'local_folder' | 'drive_web', cleaned_target: str).
    """
    target = target.strip()
    # Strip quotes if wrapped
    if (target.startswith('"') and target.endswith('"')) or (target.startswith("'") and target.endswith("'")):
        target = target[1:-1].strip()

    # Check local filesystem first
    p = Path(target)
    if p.exists() or p.is_dir() or re.match(r'^[a-zA-Z]:[\\/]', target) or target.startswith((".", "/", "\\")):
        return "local_folder", str(p.resolve() if p.exists() else target)

    # Check Google Drive URL patterns
    for regex in DRIVE_FOLDER_REGEXES:
        m = regex.search(target)
        if m:
            drive_id = m.group(1) if m.groups() else target
            return "drive_web", drive_id

    # Fallback to local_folder if not recognized
    return "local_folder", target

def categorize_file(filename: str) -> Tuple[str, str, bool]:
    """
    Returns (category, status, requires_code_adapter).
    Categories: 'document', 'media', 'code', 'spreadsheet', 'unsupported'.
    """
    ext = Path(filename).suffix.lower()
    if ext in NLM_NATIVE_DOCS:
        return "document", "new", False
    if ext in NLM_MEDIA_FORMATS:
        return "media", "new", False
    if ext in CODE_ADAPTER_EXTENSIONS:
        return "code", "new", True
    if ext in EXCEL_EXTENSIONS:
        return "spreadsheet", "new", True
    if ext in IGNORED_EXTENSIONS:
        return "unsupported", "unsupported", False

    # Default unknown files
    return "unsupported", "unsupported", False

def convert_ipynb_to_markdown(filepath: Path) -> str:
    """Extracts Markdown and Code cells from a Jupyter Notebook into clean Markdown text."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
        cells = data.get("cells", [])
        output = [f"# Jupyter Notebook: {filepath.name}\n"]
        for i, cell in enumerate(cells):
            cell_type = cell.get("cell_type", "")
            source = "".join(cell.get("source", []))
            if cell_type == "markdown":
                output.append(f"\n{source}\n")
            elif cell_type == "code":
                output.append(f"\n```python\n# [In {i+1}]\n{source}\n```\n")
        return "\n".join(output)
    except Exception as e:
        logger.warning(f"Error parsing .ipynb {filepath}: {e}")
        return f"# {filepath.name}\n(Failed to parse Jupyter notebook structure)\n"

def prepare_code_file_as_markdown(filepath: Path) -> str:
    """Wraps raw source code into a clean, annotated Markdown source."""
    ext = filepath.suffix.lower().lstrip(".")
    lang = {
        "py": "python", "c": "c", "cpp": "cpp", "h": "c",
        "m": "matlab", "v": "verilog", "vhd": "vhdl",
        "java": "java", "json": "json", "sql": "sql",
        "sh": "bash", "ts": "typescript", "js": "javascript"
    }.get(ext, ext)

    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return f"# Academic Source Code: {filepath.name}\n\n```{lang}\n{content}\n```\n"
    except Exception as e:
        logger.warning(f"Error reading code file {filepath}: {e}")
        return f"# {filepath.name}\n(Could not read file)\n"

class DriveSyncService:
    def __init__(self):
        self._sync_lock = asyncio.Lock()

    async def get_notebook_sources(self, notebook_id: str, profile_id: str = "default") -> List[Dict[str, Any]]:
        """Fetches current sources from NotebookLM."""
        res = await run_nlm_cmd(["source", "list", notebook_id, "--profile", profile_id, "--json"], timeout=45)
        if res.get("success") and res.get("stdout"):
            try:
                data = json.loads(res["stdout"])
                if isinstance(data, list):
                    return data
            except Exception as e:
                logger.warning(f"Failed to parse source list output for {notebook_id}: {e}")
        return []

    async def get_stale_drive_sources(self, notebook_id: str, profile_id: str = "default") -> List[str]:
        """Returns IDs or titles of stale Drive sources."""
        res = await run_nlm_cmd(["source", "stale", notebook_id, "--profile", profile_id, "--json"], timeout=30)
        stale_items = []
        if res.get("success") and res.get("stdout"):
            out = res["stdout"]
            try:
                data = json.loads(out)
                if isinstance(data, list):
                    for item in data:
                        stale_items.append(item.get("id") or item.get("title", ""))
            except Exception:
                # Text output fallback parsing
                if "stale" in out.lower() and "all drive sources are up to date" not in out.lower():
                    stale_items.append("drive_stale")
        return stale_items

    async def scan_local_folder(self, folder_path: str, recursive: bool = False) -> List[FolderFileItem]:
        """Scans local filesystem folder for files."""
        dir_path = Path(folder_path)
        if not dir_path.exists() or not dir_path.is_dir():
            return []

        files: List[FolderFileItem] = []
        pattern = "**/*" if recursive else "*"

        try:
            for entry in dir_path.glob(pattern):
                if entry.is_file() and not entry.name.startswith((".", "~$")):
                    category, status, req_adapter = categorize_file(entry.name)
                    stat = entry.stat()
                    mod_iso = datetime.fromtimestamp(stat.st_mtime).isoformat()
                    detail = ""
                    if req_adapter:
                        detail = "Auto-converted via Academic Code Adapter"
                    elif status == "unsupported":
                        detail = "Non-document format (skipped)"

                    files.append(FolderFileItem(
                        name=entry.name,
                        path_or_id=str(entry.resolve()),
                        extension=entry.suffix.lower(),
                        size_bytes=stat.st_size,
                        modified_at=mod_iso,
                        status=status,
                        category=category,
                        requires_code_adapter=req_adapter,
                        detail=detail
                    ))
        except Exception as e:
            logger.error(f"Error scanning local folder {folder_path}: {e}")

        # Sort files alphabetically by name
        files.sort(key=lambda x: x.name.lower())
        return files

    async def get_folder_status(self, notebook_id: str) -> FolderStatusResponse:
        """Compares mapped folder contents against live NotebookLM sources and quota limits."""
        mapping = await get_folder_mapping(notebook_id)
        cached_notebooks = await get_cached_notebooks()
        nb = next((n for n in cached_notebooks if n.id == notebook_id), None)
        nb_title = nb.title if nb else f"Notebook {notebook_id[:8]}"
        profile_id = nb.profileId if nb else "default"
        tier = nb.tier if nb else "pro"

        max_capacity = NOTEBOOKLM_PRO_SOURCE_LIMIT if tier == "pro" else NOTEBOOKLM_STANDARD_SOURCE_LIMIT

        # Fetch current notebook sources
        sources = await self.get_notebook_sources(notebook_id, profile_id=profile_id)
        current_source_count = len(sources) if sources else (nb.source_count if nb else 0)
        stale_source_indicators = await self.get_stale_drive_sources(notebook_id, profile_id=profile_id)

        # Build lookup set of existing source titles and IDs
        existing_titles = {s.get("title", "").strip().lower(): s for s in sources if s.get("title")}
        existing_ids = {s.get("id", "").strip(): s for s in sources if s.get("id")}

        files: List[FolderFileItem] = []
        if mapping:
            if mapping.folder_type == "local_folder":
                files = await self.scan_local_folder(mapping.target_path, recursive=mapping.recursive)
            elif mapping.folder_type == "drive_web":
                # For Drive web folders, display all current live notebook sources with Drive sync status
                for s in sources:
                    s_title = s.get("title") or "Drive Source"
                    s_id = s.get("id") or ""
                    s_ext = Path(s_title).suffix.lower() or ".pdf"
                    is_stale = s_id in stale_source_indicators or s_title.strip().lower() in stale_source_indicators
                    category, _, req_adapter = categorize_file(s_title)
                    files.append(FolderFileItem(
                        name=s_title,
                        path_or_id=s_id,
                        extension=s_ext,
                        size_bytes=0,
                        modified_at=datetime.now().isoformat(),
                        status="stale" if is_stale else "ingested",
                        category=category,
                        source_id=s_id,
                        requires_code_adapter=req_adapter,
                        detail="Modified in Google Drive, refresh needed" if is_stale else "Ingested from Google Drive"
                    ))

        # Diffing logic
        new_count = 0
        ingested_count = 0
        stale_count = 0
        unsupported_count = 0

        for f in files:
            if f.status == "unsupported":
                unsupported_count += 1
                continue

            # Check if matching source exists
            clean_name = f.name.strip().lower()
            matched_source = existing_titles.get(clean_name)

            if matched_source:
                source_id = matched_source.get("id")
                f.source_id = source_id
                # Check if stale
                if source_id in stale_source_indicators or clean_name in stale_source_indicators:
                    f.status = "stale"
                    f.detail = "Modified in Drive, refresh needed"
                    stale_count += 1
                else:
                    f.status = "ingested"
                    f.detail = "Already ingested in notebook"
                    ingested_count += 1
            else:
                f.status = "new"
                new_count += 1

        capacity_percent = round((current_source_count / max_capacity) * 100, 1) if max_capacity > 0 else 0.0

        return FolderStatusResponse(
            notebook_id=notebook_id,
            notebook_title=nb_title,
            profile_id=profile_id,
            tier=tier,
            max_capacity=max_capacity,
            current_source_count=current_source_count,
            capacity_percent=capacity_percent,
            mapping=mapping,
            files=files,
            new_count=new_count,
            ingested_count=ingested_count,
            stale_count=stale_count,
            unsupported_count=unsupported_count
        )

    async def sync_folder(
        self,
        notebook_id: str,
        action: str = "ingest_new",
        selected_files: Optional[List[str]] = None
    ) -> FolderSyncResponse:
        """
        Executes sequential ingestion of new folder files and stale refreshes.
        Includes a 1.5s delay between uploads to protect against HTTP 429 rate limits.
        """
        async with self._sync_lock:
            status_resp = await self.get_folder_status(notebook_id)
            mapping = status_resp.mapping
            if not mapping:
                return FolderSyncResponse(
                    success=False,
                    notebook_id=notebook_id,
                    message="No folder mapped to this notebook."
                )

            profile_id = status_resp.profile_id or "default"
            files_to_process = status_resp.files

            # Filter by selection if specified
            if selected_files:
                sel_set = set(selected_files)
                files_to_process = [f for f in files_to_process if f.path_or_id in sel_set or f.name in sel_set]

            ingested_count = 0
            stale_synced_count = 0
            failed_count = 0
            results: List[Dict[str, Any]] = []

            # 1. Process Stale Sync if requested
            if action in ("sync_stale", "full_sync"):
                stale_files = [f for f in files_to_process if f.status == "stale"]
                if stale_files or action == "sync_stale":
                    logger.info(f"Syncing stale sources for notebook {notebook_id}")
                    sync_res = await run_nlm_cmd(
                        ["source", "sync", notebook_id, "--profile", profile_id, "--confirm"],
                        timeout=120
                    )
                    if sync_res.get("success"):
                        stale_synced_count += len(stale_files) or 1
                        results.append({
                            "type": "sync_stale",
                            "status": "success",
                            "message": "Synced stale Drive sources"
                        })
                    else:
                        results.append({
                            "type": "sync_stale",
                            "status": "warning",
                            "message": sync_res.get("stderr", "Could not sync stale sources")
                        })

            # 2. Process New File Ingestions
            if action in ("ingest_new", "full_sync"):
                new_files = [f for f in files_to_process if f.status == "new"]
                current_sources = status_resp.current_source_count
                max_capacity = status_resp.max_capacity

                for idx, file_item in enumerate(new_files):
                    # Check capacity guardrail
                    if current_sources + ingested_count >= max_capacity:
                        results.append({
                            "file": file_item.name,
                            "status": "failed",
                            "error": f"Notebook reached capacity limit ({max_capacity} sources)."
                        })
                        failed_count += 1
                        break

                    file_path = Path(file_item.path_or_id)
                    if not file_path.exists():
                        results.append({
                            "file": file_item.name,
                            "status": "failed",
                            "error": "File not found on disk."
                        })
                        failed_count += 1
                        continue

                    # Rate-limiting throttle breather: 1.5s between consecutive uploads
                    if idx > 0:
                        await asyncio.sleep(1.5)

                    try:
                        cmd_args = []
                        temp_file_to_clean = None

                        if file_item.requires_code_adapter:
                            # Handle Jupyter notebook or source code adapter
                            if file_item.extension == ".ipynb":
                                content = convert_ipynb_to_markdown(file_path)
                            else:
                                content = prepare_code_file_as_markdown(file_path)

                            # Save to temporary text file for upload
                            temp_fd, temp_path = tempfile.mkstemp(prefix="nlm_code_", suffix=".txt")
                            with os.fdopen(temp_fd, "w", encoding="utf-8") as tf:
                                tf.write(content)
                            temp_file_to_clean = temp_path

                            cmd_args = [
                                "source", "add", notebook_id,
                                "--file", temp_path,
                                "--title", file_item.name,
                                "--profile", profile_id,
                                "--wait"
                            ]
                        else:
                            # Direct file upload
                            cmd_args = [
                                "source", "add", notebook_id,
                                "--file", str(file_path.resolve()),
                                "--profile", profile_id,
                                "--wait"
                            ]

                        logger.info(f"Ingesting folder file: {file_item.name} -> notebook {notebook_id}")
                        res = await run_nlm_cmd(cmd_args, timeout=180)

                        if temp_file_to_clean and os.path.exists(temp_file_to_clean):
                            try:
                                os.remove(temp_file_to_clean)
                            except Exception:
                                pass

                        if res.get("success"):
                            ingested_count += 1
                            results.append({
                                "file": file_item.name,
                                "status": "success",
                                "detail": "Successfully ingested"
                            })
                        else:
                            failed_count += 1
                            err = res.get("stderr") or res.get("stdout") or "Upload error"
                            results.append({
                                "file": file_item.name,
                                "status": "failed",
                                "error": err
                            })

                    except Exception as e:
                        failed_count += 1
                        logger.error(f"Failed to ingest {file_item.name}: {e}")
                        results.append({
                            "file": file_item.name,
                            "status": "failed",
                            "error": str(e)
                        })

            # Update mapping's last_scanned timestamp
            mapping.last_scanned = datetime.now().isoformat()
            await save_folder_mapping(mapping)

            # Update cached notebook source count
            cached_notebooks = await get_cached_notebooks()
            for n in cached_notebooks:
                if n.id == notebook_id:
                    n.source_count = (n.source_count or 0) + ingested_count
            await save_cached_notebooks(cached_notebooks)

            msg = f"Synced folder: {ingested_count} newly ingested, {stale_synced_count} stale refreshed, {failed_count} failed."
            return FolderSyncResponse(
                success=failed_count == 0,
                notebook_id=notebook_id,
                ingested_count=ingested_count,
                stale_synced_count=stale_synced_count,
                failed_count=failed_count,
                results=results,
                message=msg
            )

# Global singleton
drive_sync_service = DriveSyncService()
