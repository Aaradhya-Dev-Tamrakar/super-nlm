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
        "email": "test@example.com",
        "tier": "standard",
        "color": "#10b981"
    })
    assert res3.status_code == 200, f"Expected 200, got {res3.status_code}"
    print("[OK] POST /api/profiles passed: Successfully created 'test_account'.")

    # 4. Test profile update (editing display name, email, tier, color, isDefaultPro)
    res_update = client.put("/api/profiles/test_account", json={
        "displayName": "Updated Work Account",
        "email": "updated@example.com",
        "tier": "pro",
        "color": "#f28b82",
        "isDefaultPro": True
    })
    assert res_update.status_code == 200, f"Expected 200, got {res_update.status_code}"
    updated_p = res_update.json()
    assert updated_p["displayName"] == "Updated Work Account"
    assert updated_p["email"] == "updated@example.com"
    assert updated_p["tier"] == "pro"
    assert updated_p["color"] == "#f28b82"
    assert updated_p["isDefaultPro"] is True
    print("[OK] PUT /api/profiles/test_account passed: Successfully updated profile details.")

    # 5. Test profile key rename (editing newId)
    res_rename = client.put("/api/profiles/test_account", json={
        "newId": "test_renamed_account",
        "displayName": "Renamed Account"
    })
    assert res_rename.status_code == 200, f"Expected 200, got {res_rename.status_code}"
    renamed_p = res_rename.json()
    assert renamed_p["id"] == "test_renamed_account"
    assert renamed_p["displayName"] == "Renamed Account"
    print("[OK] PUT /api/profiles/test_account passed: Successfully renamed profile key to 'test_renamed_account'.")

    # Verify via GET that old ID is gone and new ID exists
    res_get_all = client.get("/api/profiles")
    assert res_get_all.status_code == 200
    all_p = res_get_all.json()
    assert not any(p["id"] == "test_account" for p in all_p)
    assert any(p["id"] == "test_renamed_account" for p in all_p)
    print("[OK] Verified renamed profile in profile list.")

    # 6. Clean up test profile
    res4 = client.delete("/api/profiles/test_renamed_account")
    assert res4.status_code == 200
    print("[OK] DELETE /api/profiles/test_renamed_account passed: Successfully removed test profile.")

    # 7. Restore main profile default pro if main exists
    if any(p["id"] == "main" for p in all_p):
        client.put("/api/profiles/main", json={"isDefaultPro": True, "tier": "pro"})

    print("\nALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_api()
