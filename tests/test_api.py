import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.app import app

def test_api():
    client = TestClient(app)

    # 1. Test profiles
    res = client.get("/api/profiles")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    profiles = res.json()
    print(f"[OK] GET /api/profiles passed: {len(profiles)} profile(s) found.")
    for p in profiles:
        print(f"   * [{p['id']}] {p['displayName']} - {p['email']} (Tier: {p['tier']}, DefaultPro: {p['isDefaultPro']})")

    # 2. Test notebooks sync and listing
    res_sync = client.post("/api/notebooks/sync")
    assert res_sync.status_code == 200, f"Expected 200, got {res_sync.status_code}"
    synced_notebooks = res_sync.json()
    print(f"[OK] POST /api/notebooks/sync passed: Synced {len(synced_notebooks)} notebooks.")

    res2 = client.get("/api/notebooks")
    assert res2.status_code == 200, f"Expected 200, got {res2.status_code}"
    notebooks = res2.json()
    print(f"[OK] GET /api/notebooks passed: {len(notebooks)} cached notebooks.")

    # 3. Test profile creation
    res3 = client.post("/api/profiles?launch_login=false", json={
        "id": "test_account",
        "displayName": "Test Work Account",
        "tier": "standard",
        "color": "#10b981"
    })
    assert res3.status_code == 200, f"Expected 200, got {res3.status_code}"
    print("[OK] POST /api/profiles passed: Successfully created 'test_account'.")

    # 4. Clean up test profile
    res4 = client.delete("/api/profiles/test_account")
    assert res4.status_code == 200
    print("[OK] DELETE /api/profiles/test_account passed: Successfully removed 'test_account'.")

    print("\nALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_api()
