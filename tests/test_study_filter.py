import sys
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.app import app
from backend.models import (
    Notebook,
    COURSE_NOTEBOOK_IDS,
    COURSE_CODE_REGEX,
    detect_course_info
)

COURSE_CASES = [
    ("96a12a04-073e-43ca-9f6d-ca0048d63486", "CT653 - Artificial Intelligence", "CT653"),
    ("c627a211-552e-496b-9ebb-42d22ac05a95", "EX751 - Wireless Communications", "EX751"),
    ("bc8653c3-a1d3-42b7-bca1-cd8e4effc038", "CT704 - Digital Signal Analysis and Processing", "CT704"),
    ("c3c8ecd4-2884-42a1-aa49-c4de168c1ec7", "EX752 - RF and Microwave Engineering", "EX752"),
    ("94cd4e14-802d-4231-b27d-6a4f4a2e6182", "ME708 - Organization and Management", "ME708"),
    ("56cdad30-13d3-4621-a0b7-8f841858476b", "EX725 04 - Aeronautical Telecommunication", "EX725 04"),
]

NON_COURSE_CASES = [
    ("6e9505f0-2d5c-4655-8bc7-9f97cf9620b9", "BiasAperture - Repo State"),
    ("07352cb7-f40a-420d-b744-fad53fb66863", "Super-NLM"),
    ("95a79d26-2f87-42cd-8cb9-8361a1e56059", "Aaradhya — Engineer's Personal Notebook"),
    ("c9eaef66-766b-4d32-a5d2-8ba82ff87340", "SPARK ML Pipeline Tutorial"),
]

def test_course_detection_logic():
    for nb_id, title, expected_code in COURSE_CASES:
        is_study, code, cat = detect_course_info(title, nb_id)
        assert is_study is True, f"Expected {title} to be detected as study"
        assert code == expected_code, f"Expected code {expected_code}, got {code}"
        assert cat == "study"

    for nb_id, title in NON_COURSE_CASES:
        is_study, code, cat = detect_course_info(title, nb_id)
        assert is_study is False, f"Expected {title} to not be study"
        assert code is None
        assert cat == "general"

def test_notebook_model_post_init():
    for nb_id, title, expected_code in COURSE_CASES:
        nb = Notebook(
            id=nb_id,
            title=title,
            profileId="default",
            profileName="Personal / Student",
            profileEmail="test@gmail.com"
        )
        assert nb.is_study is True
        assert nb.course_code == expected_code
        assert nb.category == "study"

    nb_non_course = Notebook(
        id="sample-id",
        title="My Custom Project",
        profileId="default",
        profileName="Personal / Student",
        profileEmail="test@gmail.com"
    )
    assert nb_non_course.is_study is False
    assert nb_non_course.course_code is None
    assert nb_non_course.category == "general"

def test_api_category_filter():
    client = TestClient(app)

    res_all = client.get("/api/notebooks")
    assert res_all.status_code == 200
    all_nbs = res_all.json()
    assert len(all_nbs) > 0

    res_study = client.get("/api/notebooks?category=study")
    assert res_study.status_code == 200
    study_nbs = res_study.json()
    assert len(study_nbs) > 0
    for n in study_nbs:
        assert n["is_study"] is True
        assert n["category"] == "study"
        assert n["course_code"] is not None

    study_ids = {n["id"] for n in study_nbs}
    for expected_id, _, _ in COURSE_CASES:
        assert expected_id in study_ids, f"Expected {expected_id} to be in study notebooks"

    res_proj = client.get("/api/notebooks?category=projects")
    assert res_proj.status_code == 200
    proj_nbs = res_proj.json()
    assert len(proj_nbs) > 0
    for n in proj_nbs:
        assert n["is_study"] is False
        assert n["category"] == "general"

    res_search = client.get("/api/notebooks?search=CT653")
    assert res_search.status_code == 200
    search_nbs = res_search.json()
    assert any("CT653" in n["title"] or n.get("course_code") == "CT653" for n in search_nbs)

def test_frontend_markup_and_scripts():
    html_path = Path(__file__).resolve().parent.parent / "frontend" / "index.html"
    html = html_path.read_text(encoding="utf-8")

    assert "category-pills-container" in html, "category-pills-container missing in index.html"
    assert "telemetry-courses" in html, "telemetry-courses missing in index.html"
    assert "btn-telemetry-courses" in html, "btn-telemetry-courses missing in index.html"
    assert "Toggle Study / Course NLMs filter" in html, "U shortcut missing in shortcuts modal"

    js_path = Path(__file__).resolve().parent.parent / "frontend" / "app.js"
    js = js_path.read_text(encoding="utf-8")

    assert "activeCategoryFilter" in js, "activeCategoryFilter state missing in app.js"
    assert "isStudyNotebook" in js, "isStudyNotebook function missing in app.js"
    assert "getCourseCode" in js, "getCourseCode function missing in app.js"
    assert "renderCategoryChips" in js, "renderCategoryChips function missing in app.js"
    assert "toggleStudyFilter" in js, "toggleStudyFilter function missing in app.js"
    assert "e.key.toLowerCase() === 'u'" in js, "U key shortcut missing in app.js"

if __name__ == "__main__":
    test_course_detection_logic()
    test_notebook_model_post_init()
    test_api_category_filter()
    test_frontend_markup_and_scripts()
    print("ALL STUDY FILTER TESTS PASSED SUCCESSFULLY!")
