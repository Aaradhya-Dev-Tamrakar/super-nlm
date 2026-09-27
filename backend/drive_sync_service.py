import os
import re
import json
import time
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import httpx

from backend.config import (
    NLM_EXECUTABLE,
    NOTEBOOKLM_PRO_SOURCE_LIMIT,
    NOTEBOOKLM_STANDARD_SOURCE_LIMIT,
    NLM_NATIVE_DOCS,
    NLM_MEDIA_FORMATS,
    CODE_ADAPTER_EXTENSIONS,
    EXCEL_EXTENSIONS,
    IGNORED_EXTENSIONS,
    GDRIVE_CREDENTIALS_PATH,
    GDRIVE_OAUTH_PATH
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

async def get_drive_access_token() -> Optional[str]:
    """
    Retrieves or refreshes a valid Google Drive OAuth access token using
    the configured GDRIVE_CREDENTIALS_PATH and GDRIVE_OAUTH_PATH.
    """
    cred_file = Path(GDRIVE_CREDENTIALS_PATH)
    oauth_file = Path(GDRIVE_OAUTH_PATH)

    if not cred_file.exists():
        logger.debug(f"Drive credentials not found at {cred_file}")
        return None

    try:
        with open(cred_file, "r", encoding="utf-8") as f:
            creds = json.load(f)

        expiry = creds.get("expiry_date", 0)
        # Check if expired or expiring within 60s
        if expiry and expiry < (time.time() * 1000 + 60000):
            if not oauth_file.exists():
                logger.warning(f"OAuth client secret file not found at {oauth_file}, cannot refresh Drive token")
                return creds.get("access_token")

            with open(oauth_file, "r", encoding="utf-8") as f:
                oauth = json.load(f)
            keys = oauth.get("installed") or oauth.get("web")
            if not keys:
                return creds.get("access_token")

            refresh_data = {
                "client_id": keys["client_id"],
                "client_secret": keys["client_secret"],
                "refresh_token": creds["refresh_token"],
                "grant_type": "refresh_token",
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post("https://oauth2.googleapis.com/token", data=refresh_data)
                if res.status_code == 200:
                    token_data = res.json()
                    creds["access_token"] = token_data["access_token"]
                    if "expires_in" in token_data:
                        creds["expiry_date"] = int((time.time() + token_data["expires_in"]) * 1000)
                    with open(cred_file, "w", encoding="utf-8") as f:
                        json.dump(creds, f, indent=2)
                else:
                    logger.warning(f"Failed to refresh Drive token: {res.text}")

        return creds.get("access_token")
    except Exception as e:
        logger.warning(f"Error obtaining Drive access token: {e}")
        return None

def normalize_title_for_matching(title: str) -> str:
    """Normalizes title for fuzzy matching across spaces, underscores, hyphens, and dashes."""
    t = title.strip().lower()
    return re.sub(r'[\s_\-–—]+', ' ', t)

class DriveSyncService:
    def __init__(self):
        self._sync_lock = asyncio.Lock()

    async def scan_drive_folder(self, folder_id: str, recursive: bool = False) -> List[FolderFileItem]:
        """
        Scans a remote Google Drive folder for files via Google Drive REST API.
        """
        token = await get_drive_access_token()
        if not token:
            logger.warning("No Google Drive access token available to scan folder.")
            return []

        headers = {"Authorization": f"Bearer {token}"}
        items_found: List[FolderFileItem] = []
        page_token = None

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                while True:
                    params: Dict[str, Any] = {
                        "q": f"'{folder_id}' in parents and trashed = false",
                        "fields": "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
                        "pageSize": 100
                    }
                    if page_token:
                        params["pageToken"] = page_token

                    res = await client.get("https://www.googleapis.com/drive/v3/files", params=params, headers=headers)
                    if res.status_code != 200:
                        logger.error(f"Drive API returned {res.status_code}: {res.text}")
                        break

                    data = res.json()
                    files = data.get("files", [])

                    for f in files:
                        mime = f.get("mimeType", "")
                        name = f.get("name", "")
                        f_id = f.get("id", "")

                        if mime == "application/vnd.google-apps.folder":
                            if recursive:
                                sub_files = await self.scan_drive_folder(f_id, recursive=True)
                                items_found.extend(sub_files)
                            continue

                        ext = Path(name).suffix.lower()
                        if not ext:
                            if mime == "application/vnd.google-apps.document":
                                ext = ".gdoc"
                            elif mime == "application/vnd.google-apps.spreadsheet":
                                ext = ".gsheet"
                            elif mime == "application/vnd.google-apps.presentation":
                                ext = ".gslides"

                        category, status, req_adapter = categorize_file(name if ext else f"{name}{ext}")
                        if mime.startswith("application/vnd.google-apps."):
                            if "document" in mime or "presentation" in mime:
                                category = "document"
                                status = "new"
                            elif "spreadsheet" in mime:
                                category = "spreadsheet"
                                status = "new"

                        size_b = int(f.get("size") or 0)
                        mod_iso = f.get("modifiedTime") or datetime.now().isoformat()

                        items_found.append(FolderFileItem(
                            name=name,
                            path_or_id=f_id,
                            extension=ext,
                            size_bytes=size_b,
                            modified_at=mod_iso,
                            status=status,
                            category=category,
                            requires_code_adapter=req_adapter,
                            detail="Drive file"
                        ))

                    page_token = data.get("nextPageToken")
                    if not page_token:
                        break

        except Exception as e:
            logger.error(f"Error scanning Drive folder {folder_id}: {e}")

        items_found.sort(key=lambda x: x.name.lower())
        return items_found

    async def download_drive_file(self, file_id: str, dest_path: Path) -> bool:
        """Downloads a file's raw bytes from Google Drive to a local destination path."""
        token = await get_drive_access_token()
        if not token:
            return False
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                res = await client.get(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media", headers=headers)
                if res.status_code == 200:
                    dest_path.write_bytes(res.content)
                    return True
                else:
                    logger.warning(f"Failed to download Drive file {file_id}: HTTP {res.status_code}")
                    return False
        except Exception as e:
            logger.error(f"Error downloading Drive file {file_id}: {e}")
            return False

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

        # Build lookup sets and normalized dictionaries of existing source titles and IDs
        existing_titles = {s.get("title", "").strip().lower(): s for s in sources if s.get("title")}
        existing_ids = {s.get("id", "").strip(): s for s in sources if s.get("id")}
        norm_titles = {normalize_title_for_matching(s.get("title", "")): s for s in sources if s.get("title")}
        norm_stems = {normalize_title_for_matching(Path(s.get("title", "")).stem): s for s in sources if s.get("title")}

        files: List[FolderFileItem] = []
        if mapping:
            if mapping.folder_type == "local_folder":
                files = await self.scan_local_folder(mapping.target_path, recursive=mapping.recursive)
            elif mapping.folder_type == "drive_web":
                drive_files = await self.scan_drive_folder(mapping.target_path, recursive=mapping.recursive)
                if drive_files:
                    files = drive_files
                else:
                    # Fallback to existing notebook sources if Drive credentials not configured or folder scan yielded no files
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

            # Robust matching: exact, normalized name, normalized stem, or Drive/source ID
            clean_name = f.name.strip().lower()
            norm_name = normalize_title_for_matching(f.name)
            norm_stem = normalize_title_for_matching(Path(f.name).stem)

            matched_source = (
                existing_titles.get(clean_name)
                or norm_titles.get(norm_name)
                or norm_stems.get(norm_stem)
                or existing_ids.get(f.path_or_id)
            )

            if matched_source:
                source_id = matched_source.get("id")
                f.source_id = source_id
                # Check if stale
                if source_id in stale_source_indicators or clean_name in stale_source_indicators or norm_name in stale_source_indicators:
                    f.status = "stale"
                    f.detail = "Modified in Drive, refresh needed"
                    stale_count += 1
                else:
                    f.status = "ingested"
                    f.detail = "Already ingested in notebook"
                    ingested_count += 1
            else:
                f.status = "new"
                f.detail = "New file in Google Drive, ready to ingest" if mapping and mapping.folder_type == "drive_web" else "New file on disk"
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

                    # Rate-limiting throttle breather: 1.5s between consecutive uploads
                    if idx > 0:
                        await asyncio.sleep(1.5)

                    if mapping.folder_type == "drive_web":
                        temp_dl_file = None
                        try:
                            # For native Google Docs, Sheets, Slides, link via --drive
                            if file_item.extension in (".gdoc", ".gsheet", ".gslides"):
                                cmd_args = [
                                    "source", "add", notebook_id,
                                    "--drive", file_item.path_or_id,
                                    "--title", file_item.name,
                                    "--profile", profile_id,
                                    "--wait"
                                ]
                            else:
                                # For Markdown, PDFs, text, code, download content first to ensure flawless ingestion
                                ext = file_item.extension or ".txt"
                                temp_fd, temp_dl_path = tempfile.mkstemp(prefix="nlm_drive_dl_", suffix=ext)
                                os.close(temp_fd)
                                temp_dl_file = Path(temp_dl_path)
                                ok = await self.download_drive_file(file_item.path_or_id, temp_dl_file)
                                if not ok:
                                    cmd_args = [
                                        "source", "add", notebook_id,
                                        "--drive", file_item.path_or_id,
                                        "--title", file_item.name,
                                        "--profile", profile_id,
                                        "--wait"
                                    ]
                                else:
                                    if file_item.requires_code_adapter:
                                        if file_item.extension == ".ipynb":
                                            adapted_content = convert_ipynb_to_markdown(temp_dl_file)
                                        else:
                                            adapted_content = prepare_code_file_as_markdown(temp_dl_file)
                                        temp_dl_file.write_text(adapted_content, encoding="utf-8")

                                    cmd_args = [
                                        "source", "add", notebook_id,
                                        "--file", str(temp_dl_file.resolve()),
                                        "--title", file_item.name,
                                        "--profile", profile_id,
                                        "--wait"
                                    ]

                            logger.info(f"Ingesting Drive file: {file_item.name} ({file_item.path_or_id}) -> notebook {notebook_id}")
                            res = await run_nlm_cmd(cmd_args, timeout=180)
                            if res.get("success"):
                                ingested_count += 1
                                results.append({
                                    "file": file_item.name,
                                    "status": "success",
                                    "detail": "Successfully ingested from Google Drive"
                                })
                            else:
                                failed_count += 1
                                err = res.get("stderr") or res.get("stdout") or "Drive ingestion error"
                                results.append({
                                    "file": file_item.name,
                                    "status": "failed",
                                    "error": err
                                })
                        except Exception as e:
                            failed_count += 1
                            logger.error(f"Failed to ingest Drive file {file_item.name}: {e}")
                            results.append({
                                "file": file_item.name,
                                "status": "failed",
                                "error": str(e)
                            })
                        finally:
                            if temp_dl_file and temp_dl_file.exists():
                                try:
                                    temp_dl_file.unlink()
                                except Exception:
                                    pass
                        continue

                    file_path = Path(file_item.path_or_id)
                    if not file_path.exists():
                        results.append({
                            "file": file_item.name,
                            "status": "failed",
                            "error": "File not found on disk."
                        })
                        failed_count += 1
                        continue

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
