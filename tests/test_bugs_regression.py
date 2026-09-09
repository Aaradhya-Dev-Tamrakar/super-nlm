import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from backend.app import app
from backend.nlm_client import launch_cli_login, _run_subprocess_sync, query_notebook
from backend.models import ProfileCreateRequest
import backend.tunnel as tunnel

def test_regression_security():
    client = TestClient(app)
    
    # 1. Test command injection rejection
    malicious_ids = [
        'test & calc.exe',
        'test; whoami',
        'test | dir',
        'test$var',
        'test"quote',
        "test'single",
        'test>file',
    ]
    for bad_id in malicious_ids:
        res = client.post('/api/profiles?launch_login=false', json={
            'id': bad_id,
            'displayName': 'Malicious Profile'
        })
        assert res.status_code in [400, 422], f'Expected 400/422 for bad id {bad_id}, got {res.status_code}'
    print('  [PASS] Security: Command injection payloads successfully blocked by validator.')

    # 2. Test launch_cli_login rejection directly
    try:
        launch_cli_login('bad & id')
        assert False, 'Expected ValueError on bad profile_id'
    except ValueError:
        pass
    print('  [PASS] Security: launch_cli_login rejects invalid profile IDs.')

def test_regression_cache_sync():
    client = TestClient(app)
    # Create temp profile
    res = client.post('/api/profiles?launch_login=false', json={
        'id': 'cache_sync_test',
        'displayName': 'Original Name',
        'tier': 'standard',
        'color': '#ff0000'
    })
    assert res.status_code == 200

    # Update profile display name
    res_up = client.put('/api/profiles/cache_sync_test', json={
        'displayName': 'Updated Name',
        'color': '#00ff00'
    })
    assert res_up.status_code == 200
    updated_profile = res_up.json()
    assert updated_profile['displayName'] == 'Updated Name'
    assert updated_profile['color'] == '#00ff00'

    # Cleanup
    res_del = client.delete('/api/profiles/cache_sync_test')
    assert res_del.status_code == 200
    print('  [PASS] Cache Sync: Profile updates and deletions work reliably.')

def test_regression_qrcode():
    import qrcode
    qr = qrcode.QRCode(border=1)
    qr.add_data('https://example.com')
    assert qr is not None
    print('  [PASS] Dependencies: qrcode library is installed and functional.')

def test_regression_tunnel_stdout():
    # Verify tunnel does not use stdout=subprocess.PIPE to prevent deadlock
    import inspect
    src = inspect.getsource(tunnel.start_cloudflare_tunnel)
    assert 'stdout=subprocess.DEVNULL' in src
    print('  [PASS] Deadlock Prevention: Tunnel stdout is redirected to DEVNULL.')

def test_regression_query_error_extraction():
    import asyncio
    res = asyncio.run(query_notebook('default', 'non_existent_notebook_id_xyz', 'test question'))
    assert res['success'] is False
    assert 'NOT_FOUND' in res['error'] or 'API error' in res['error'] or 'not found' in res['error'].lower()
    print(f'  [PASS] Error Extraction: nlm stdout error cleanly parsed: \"{res["error"]}\"')

def test_regression_query_conversation_support():
    from backend.models import QueryRequest
    req = QueryRequest(profileId="default", notebookId="test_nb", question="test question", conversationId="conv_123")
    assert req.conversationId == "conv_123"
    print('  [PASS] Multi-turn: QueryRequest supports optional conversationId tracking.')

if __name__ == '__main__':
    print('Running Super-NLM Regression Tests...')
    test_regression_security()
    test_regression_cache_sync()
    test_regression_qrcode()
    test_regression_tunnel_stdout()
    test_regression_query_error_extraction()
    test_regression_query_conversation_support()
    print('\nALL REGRESSION TESTS PASSED!')
