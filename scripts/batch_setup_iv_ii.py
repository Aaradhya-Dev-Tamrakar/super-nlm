#!/usr/bin/env python3
"""
batch_setup_iv_ii.py
Automated Super-NLM fleet orchestrator script for provisioning IV-II core subject notebooks.
Executes batch creation, folder mapping, local exam hub creation, source ingestion,
and cross-profile sharing across the multi-account fleet.
"""

import os
import sys
import json
import time
import shutil
import subprocess
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.config import NLM_EXECUTABLE

DATA_DIR = PROJECT_ROOT / "data"
FOLDER_MAPPINGS_FILE = DATA_DIR / "folder_mappings.json"
NOTEBOOKS_CACHE_FILE = DATA_DIR / "notebooks_cache.json"
PROFILES_FILE = DATA_DIR / "profiles.json"
BASE_IV_II = Path(r"D:\Misc Aaradhya\Electronics (NEW 075-079)\[IV-II]")
DOWNLOADS_ROOT = Path(r"C:\Users\Aaradhya\Downloads")

CORE_SUBJECTS = [
    {
        "code": "EX756",
        "title": "EX756 - Telecommunications",
        "local_folder": BASE_IV_II / "Telecommunication",
        "download_hub": DOWNLOADS_ROOT / "EX756 Exam",
        "sources": [
            BASE_IV_II / "Telecommunication" / "Telecommunication_BEIE_IV_II_Syllabus.md",
            BASE_IV_II / "Telecommunication" / "StudyHub.md"
        ]
    },
    {
        "code": "CE752",
        "title": "CE752 - Engineering Professional Practice",
        "local_folder": BASE_IV_II / "Engineering Professional Practice",
        "download_hub": DOWNLOADS_ROOT / "CE752 Exam",
        "sources": [
            BASE_IV_II / "Engineering Professional Practice" / "EPP_BEIE_IV_II_Syllabus.md",
            BASE_IV_II / "Engineering Professional Practice" / "StudyHub.md"
        ]
    },
    {
        "code": "EX758",
        "title": "EX758 - Energy, Environment and Society",
        "local_folder": BASE_IV_II / "Energy, Environment and Society",
        "download_hub": DOWNLOADS_ROOT / "EX758 Exam",
        "sources": [
            BASE_IV_II / "Energy, Environment and Society" / "EES_BEIE_IV_II_Syllabus.md",
            BASE_IV_II / "Energy, Environment and Society" / "StudyHub.md"
        ]
    },
    {
        "code": "CT751",
        "title": "CT751 - Information Systems",
        "local_folder": BASE_IV_II / "Information System",
        "download_hub": DOWNLOADS_ROOT / "CT751 Exam",
        "sources": [
            BASE_IV_II / "Information System" / "Information_Systems_BEIE_IV_II_Syllabus.md",
            BASE_IV_II / "Information System" / "StudyHub.md"
        ]
    }
]

def run_cmd(args: list, timeout: int = 60) -> dict:
    cmd = [NLM_EXECUTABLE] + args
    print(f"[CMD] {' '.join(cmd)}")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return {"code": res.returncode, "stdout": res.stdout.strip(), "stderr": res.stderr.strip()}

def main(dry_run: bool = False):
    print("=== Super-NLM: IV-II Core Notebooks Fleet Setup ===")
    print(f"Owner Profile: default (aaradhyadevtmr@gmail.com)")
    print(f"Dry Run: {dry_run}")

    # Load existing folder mappings
    folder_mappings = {}
    if FOLDER_MAPPINGS_FILE.exists():
        try:
            folder_mappings = json.loads(FOLDER_MAPPINGS_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Warning: could not read folder_mappings.json: {e}")

    # Load existing notebooks for default profile to avoid re-creation
    existing_notebooks = {}
    res = run_cmd(["notebook", "list", "-p", "default", "--json"], timeout=45)
    if res["code"] == 0 and res["stdout"]:
        try:
            items = json.loads(res["stdout"])
            for it in items:
                existing_notebooks[it.get("title", "").strip()] = it.get("id")
        except Exception:
            pass

    # Discover collaborator emails from profiles.json
    collaborators = []
    if PROFILES_FILE.exists():
        try:
            p_data = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
            for p in p_data:
                em = p.get("email", "").strip()
                if em and em != "aaradhyadevtmr@gmail.com":
                    collaborators.append(em)
        except Exception:
            pass

    collaborator_str = ",".join(collaborators)
    print(f"Discovered {len(collaborators)} fleet collaborators: {collaborator_str}")

    results = []

    for subj in CORE_SUBJECTS:
        title = subj["title"]
        print(f"\n--- Processing {title} ---")

        # 1. Ensure Local Exam Download Hub exists
        hub_dir = subj["download_hub"]
        if not hub_dir.exists():
            print(f"Creating local exam download hub: {hub_dir}")
            if not dry_run:
                hub_dir.mkdir(parents=True, exist_ok=True)
        else:
            print(f"Exam download hub ready: {hub_dir}")

        # 2. Check or Create Notebook
        notebook_id = existing_notebooks.get(title)
        if not notebook_id:
            # Check cache file directly
            if NOTEBOOKS_CACHE_FILE.exists():
                try:
                    c_data = json.loads(NOTEBOOKS_CACHE_FILE.read_text(encoding="utf-8"))
                    for it in c_data:
                        if it.get("title", "").strip() == title:
                            notebook_id = it.get("id")
                            break
                except Exception:
                    pass

        if notebook_id:
            print(f"Found active notebook for '{title}': ID = {notebook_id}")
        else:
            print(f"Creating notebook '{title}' on default profile...")
            if not dry_run:
                create_res = run_cmd(["notebook", "create", title, "-p", "default", "--json"])
                if create_res["code"] == 0:
                    try:
                        c_data = json.loads(create_res["stdout"])
                        notebook_id = c_data.get("id") or c_data.get("notebook_id")
                        print(f"Created notebook '{title}' -> ID: {notebook_id}")
                    except Exception as e:
                        print(f"Failed to parse create response: {create_res['stdout']}")
                else:
                    print(f"ERROR creating notebook: {create_res['stderr']}")
                    continue
            else:
                notebook_id = f"dry-run-id-{subj['code'].lower()}"
                print(f"[DRY-RUN] Would create notebook '{title}' -> {notebook_id}")

        if not notebook_id:
            print(f"ERROR: Could not resolve notebook ID for '{title}'")
            continue

        # 3. Bind to folder_mappings.json
        folder_mappings[notebook_id] = {
            "notebook_id": notebook_id,
            "folder_type": "local_folder",
            "target_path": str(subj["local_folder"]),
            "display_name": f"{subj['code']} Study Hub",
            "last_scanned": datetime.now(timezone.utc).isoformat(),
            "auto_sync": True,
            "recursive": True
        }
        print(f"Registered folder mapping for {subj['code']} -> {subj['local_folder']}")

        # 4. Ingest High-Yield Sources (Syllabus & StudyHub)
        if not dry_run:
            for src_path in subj["sources"]:
                if src_path.exists():
                    print(f"Ingesting source: {src_path.name} into notebook {notebook_id}...")
                    add_res = run_cmd(["source", "add", notebook_id, "--file", str(src_path), "-p", "default", "--wait"])
                    if add_res["code"] == 0:
                        print(f"  -> Ingested {src_path.name} successfully.")
                    else:
                        print(f"  -> Warning adding source {src_path.name}: {add_res['stderr']}")
                    time.sleep(2)  # Cooldown between uploads
                else:
                    print(f"Warning: source file not found: {src_path}")

        # 5. Auto-Share with Fleet Collaborators
        if not dry_run and collaborator_str and not notebook_id.startswith("dry-run"):
            print(f"Sharing notebook {notebook_id} with fleet collaborators: {collaborator_str}...")
            share_res = run_cmd(["share", "batch", notebook_id, collaborator_str, "--role", "editor", "-p", "default"])
            if share_res["code"] == 0:
                print(f"  -> Shared successfully with editor role.")
            else:
                print(f"  -> Warning during share batch: {share_res['stderr']}")

        results.append({"code": subj["code"], "title": title, "notebook_id": notebook_id})

    # Save updated folder_mappings.json
    if not dry_run:
        with open(FOLDER_MAPPINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(folder_mappings, f, indent=2)
        print(f"\nSaved updated {FOLDER_MAPPINGS_FILE}")

        # Refresh local cache
        print("\nRefreshing notebooks cache...")
        ref_res = run_cmd(["notebook", "list", "-p", "default", "--json"])
        if ref_res["code"] == 0:
            try:
                c_items = json.loads(ref_res["stdout"])
                with open(NOTEBOOKS_CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(c_items, f, indent=2)
                print(f"Successfully updated {NOTEBOOKS_CACHE_FILE}")
            except Exception as e:
                print(f"Could not update cache file: {e}")

    print("\n=== Super-NLM Batch Setup Complete ===")
    for r in results:
        print(f"  * {r['code']}: {r['title']} -> {r['notebook_id']}")

if __name__ == "__main__":
    is_dry = "--dry-run" in sys.argv
    main(dry_run=is_dry)
