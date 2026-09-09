import sys
import asyncio
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.nlm_client import synthesize_with_gemini
import backend.config as config

async def run_synthesis_tests():
    print("--- Running Cross-Notebook Synthesis Tests ---")

    # Sample retrieved multi-notebook evidence
    sample_sub_results = [
        {
            "notebookId": "nb-1",
            "profileId": "default",
            "title": "BiasAperture - Repo State",
            "result": {
                "success": True,
                "answer": (
                    "- FairFace released dataset has exactly 97,698 images (86,744 train + 10,954 val), "
                    "not the 108,501 pre-discard scrape.\n"
                    "- UTKFace was formally cut under Tier #2 due to DEX age label noise and race taxonomy mismatch.\n"
                    "- Operational explainability engine uses additive linear Shapley surrogate over demographic dummy variables; full spatial SHAP deferred."
                )
            }
        },
        {
            "notebookId": "nb-2",
            "profileId": "default",
            "title": "BiasAperture - Source And Specs",
            "result": {
                "success": True,
                "answer": (
                    "- FairFace 108,501 figure represents pre-annotation count; benchmark run was verified on 10,954 validation split.\n"
                    "- UTKFace formally cut per Cut-List #2; only FairFace is ingested in data_ingestion.py.\n"
                    "- LaTeX specs referenced classes like DirectInferenceAdapter and TestMatrixBuilder that do not exist in src/."
                )
            }
        }
    ]

    question = "diff the sources and summarize discrepancies"

    # Test 1: Live Gemini synthesis (if API key available)
    if config.GEMINI_API_KEY:
        print("\n1. Testing live 2nd-stage synthesis via Gemini...")
        res = await synthesize_with_gemini(question, sample_sub_results)
        assert res["success"] is True, f"Expected success=True, got {res}"
        assert res["synthesizedBrief"] is not None, "synthesizedBrief should not be None"
        assert len(res["synthesizedBrief"]) > 50, "synthesizedBrief is too short"
        print(f"   [OK] Live synthesis passed with model: {res.get('model')}")
        print(f"   Sample output preview:\n   {res['synthesizedBrief'][:250]}...\n")
    else:
        print("\n1. [SKIP] GEMINI_API_KEY not found in config.")

    # Test 2: Fallback handling when GEMINI_API_KEY is empty
    print("2. Testing fallback handling when GEMINI_API_KEY is unset...")
    res_empty = await synthesize_with_gemini(question, sample_sub_results, api_key="")
    assert res_empty["success"] is False
    assert "not configured" in res_empty["error"]
    print("   [OK] Gracefully handled missing GEMINI_API_KEY.")

    # Test 3: Handling empty / failed notebook results
    print("3. Testing handling of empty notebook results...")
    res_no_data = await synthesize_with_gemini(question, [
        {"notebookId": "nb-empty", "profileId": "default", "result": {"success": False, "error": "timeout"}}
    ])
    assert res_no_data["success"] is False
    assert "No valid notebook answers" in res_no_data["error"]
    print("   [OK] Handled empty notebook inputs gracefully.")

    print("\nALL CROSS-NOTEBOOK SYNTHESIS TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(run_synthesis_tests())
