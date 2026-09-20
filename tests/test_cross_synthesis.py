import pytest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backend.nlm_client as nlm_client
import backend.config as config
from backend.models import NotebookRef

SAMPLE_RESULTS = [{
    "notebookId": "nb-1",
    "profileId": "default",
    "title": "BiasAperture - Repo State",
    "result": {"success": True, "answer": "FairFace validation contains 10,954 images."},
}, {
    "notebookId": "nb-2",
    "profileId": "default",
    "title": "BiasAperture - Source And Specs",
    "result": {"success": True, "answer": "The source scrape contains 108,501 images."},
}]


def test_cross_synthesis_live_gemini():
    if not config.GEMINI_API_KEY:
        pytest.skip("GEMINI_API_KEY is not configured")

    import asyncio
    result = asyncio.run(nlm_client.synthesize_with_gemini("diff the sources", SAMPLE_RESULTS))
    assert result["success"] is True
    assert len(result["synthesizedBrief"]) > 50


def test_cross_synthesis_missing_api_key():
    import asyncio
    result = asyncio.run(
        nlm_client.synthesize_with_gemini("diff the sources", SAMPLE_RESULTS, api_key="")
    )
    assert result["success"] is False
    assert "not configured" in result["error"]


def test_cross_synthesis_empty_notebook_results():
    import asyncio
    result = asyncio.run(nlm_client.synthesize_with_gemini(
        "diff the sources",
        [{"notebookId": "nb-empty", "profileId": "default",
          "result": {"success": False, "error": "timeout"}}],
    ))
    assert result["success"] is False
    assert "No valid notebook answers" in result["error"]


def test_cross_synthesis_evidence_ordering_determinism(monkeypatch):
    import asyncio

    async def fake_query(**kwargs):
        return {"success": True, "answer": kwargs["notebook_id"]}

    async def fake_synthesis(*args, **kwargs):
        return {"success": True, "synthesizedBrief": "brief", "model": "test"}

    monkeypatch.setattr(nlm_client, "query_notebook_with_pro_fallback", fake_query)
    monkeypatch.setattr(nlm_client, "synthesize_with_gemini", fake_synthesis)
    refs = [
        NotebookRef(notebookId="z", profileId="default", title="Zeta"),
        NotebookRef(notebookId="a", profileId="default", title="Alpha"),
    ]
    result = asyncio.run(nlm_client.synthesize_cross_notebook(refs, "question", "default"))
    assert [item["notebookId"] for item in result["notebookResults"]] == ["a", "z"]
