import sys
import os
import json
import tempfile
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.app import app
from backend.drive_sync_service import (
    normalize_folder_target,
    categorize_file,
    convert_ipynb_to_markdown,
    prepare_code_file_as_markdown,
    drive_sync_service
)
from backend.models import FolderMapping
from backend.storage import (
    save_folder_mapping,
    get_folder_mapping,
    delete_folder_mapping,
    get_folder_mappings
)

client = TestClient(app)

def test_normalize_folder_target():
    # Local paths
    t1, p1 = normalize_folder_target(r"C:\Users\Aaradhya\Documents")
    assert t1 == "local_folder"

    # Drive web folder URLs
    t2, p2 = normalize_folder_target("https://drive.google.com/drive/folders/1AbC-xYz_1234567890abcdef")
    assert t2 == "drive_web"
    assert p2 == "1AbC-xYz_1234567890abcdef"

    # Drive web u/0 folder URLs
    t3, p3 = normalize_folder_target("https://drive.google.com/drive/u/1/folders/1FolderID_Example-12345?usp=sharing")
    assert t3 == "drive_web"
    assert p3 == "1FolderID_Example-12345"

    # Raw Drive ID
    t4, p4 = normalize_folder_target("1a2b3c4d5e6f7g8h9i0j_k-lmnoPQR")
    assert t4 == "drive_web"
    assert p4 == "1a2b3c4d5e6f7g8h9i0j_k-lmnoPQR"

def test_categorize_file():
    # Native docs
    cat, status, req = categorize_file("lecture1.pdf")
    assert cat == "document" and status == "new" and not req

    cat, status, req = categorize_file("syllabus.docx")
    assert cat == "document" and status == "new" and not req

    cat, status, req = categorize_file("notes.md")
    assert cat == "document" and status == "new" and not req

    # Audio/Media
    cat, status, req = categorize_file("recording.mp3")
    assert cat == "media" and status == "new" and not req

    # Academic Code requiring adapter
    cat, status, req = categorize_file("lab1.py")
    assert cat == "code" and status == "new" and req

    cat, status, req = categorize_file("simulation.m")
    assert cat == "code" and status == "new" and req

    cat, status, req = categorize_file("analysis.ipynb")
    assert cat == "code" and status == "new" and req

    # Ignored non-docs
    cat, status, req = categorize_file("data.zip")
    assert cat == "unsupported" and status == "unsupported" and not req

    cat, status, req = categorize_file("installer.exe")
    assert cat == "unsupported" and status == "unsupported" and not req

def test_code_adapter_and_ipynb():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        
        # Test code file
        code_file = tmp_path / "filter.py"
        code_file.write_text("import numpy as np\nprint('DSP Filter')", encoding="utf-8")
        md_code = prepare_code_file_as_markdown(code_file)
        assert "```python" in md_code
        assert "DSP Filter" in md_code

        # Test ipynb file
        ipynb_file = tmp_path / "dsp_lab.ipynb"
        ipynb_data = {
            "cells": [
                {"cell_type": "markdown", "source": ["# Lab 1: Sampling Theorem\n", "Intro text."]},
                {"cell_type": "code", "source": ["fs = 8000\n", "print(fs)"]}
            ]
        }
        ipynb_file.write_text(json.dumps(ipynb_data), encoding="utf-8")
        md_ipynb = convert_ipynb_to_markdown(ipynb_file)
        assert "# Lab 1: Sampling Theorem" in md_ipynb
        assert "```python" in md_ipynb
        assert "fs = 8000" in md_ipynb

import asyncio

def test_folder_mapping_persistence():
    async def _test():
        test_nb_id = "test-nb-folder-uuid-1234"
        mapping = FolderMapping(
            notebook_id=test_nb_id,
            folder_type="local_folder",
            target_path=r"F:\College\Semester 7\CT704",
            display_name="CT704 Lectures",
            recursive=False
        )
        await save_folder_mapping(mapping)

        loaded = await get_folder_mapping(test_nb_id)
        assert loaded is not None
        assert loaded.notebook_id == test_nb_id
        assert loaded.display_name == "CT704 Lectures"

        all_maps = await get_folder_mappings()
        assert test_nb_id in all_maps

        deleted = await delete_folder_mapping(test_nb_id)
        assert deleted is True

        loaded_after = await get_folder_mapping(test_nb_id)
        assert loaded_after is None

    asyncio.run(_test())

def test_api_endpoints():
    test_nb_id = "66c34505-a60d-4a24-98df-446d8df12a24" # CT704

    # 1. GET initial folder status
    res = client.get(f"/api/notebooks/{test_nb_id}/folder")
    assert res.status_code == 200
    data = res.json()
    assert data["notebook_id"] == test_nb_id
    assert data["max_capacity"] == 300 # Pro tier default

    # 2. POST create folder mapping
    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(tmpdir) / "Lecture-01-Test.pdf"
        test_pdf.write_bytes(b"%PDF-1.4 test content")

        post_res = client.post(
            f"/api/notebooks/{test_nb_id}/folder",
            json={
                "target_path": tmpdir,
                "display_name": "Test Course Dir",
                "recursive": False
            }
        )
        assert post_res.status_code == 200
        post_data = post_res.json()
        assert post_data["mapping"] is not None
        assert post_data["mapping"]["display_name"] == "Test Course Dir"
        assert len(post_data["files"]) >= 1
        assert any(f["name"] == "Lecture-01-Test.pdf" for f in post_data["files"])

        # 3. GET all folder mappings
        maps_res = client.get("/api/folders/mappings")
        assert maps_res.status_code == 200
        assert test_nb_id in maps_res.json()

        # 4. DELETE unlink folder
        del_res = client.delete(f"/api/notebooks/{test_nb_id}/folder")
        assert del_res.status_code == 200
        assert del_res.json()["success"] is True

        # Verify unlinked
        status_after = client.get(f"/api/notebooks/{test_nb_id}/folder").json()
        assert status_after["mapping"] is None
