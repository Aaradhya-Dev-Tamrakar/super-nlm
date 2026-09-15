import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.models import AccountProfile
from mcp_server.rotator import AccountRotator
from backend.app import app
from mcp_server.server import create_server

def get_mock_six_pro_profiles():
    return [
        AccountProfile(id="main", displayName="Personal", email="aaradhyadevtmr@gmail.com", tier="pro", isDefaultPro=True, status="connected"),
        AccountProfile(id="dev83", displayName="Secondary", email="devtamrakaraaradhya83@gmail.com", tier="pro", isDefaultPro=False, status="connected"),
        AccountProfile(id="project-01", displayName="Project", email="majorprj79001@gmail.com", tier="pro", isDefaultPro=False, status="connected"),
        AccountProfile(id="adt2061", displayName="Games", email="adtgames2061@gmail.com", tier="pro", isDefaultPro=False, status="connected"),
        AccountProfile(id="bei79001", displayName="College", email="aaradhya.bei79001@gmail.com", tier="pro", isDefaultPro=False, status="connected"),
        AccountProfile(id="adtmr", displayName="Tertiary", email="aaradhyadtmr@gmail.com", tier="pro", isDefaultPro=False, status="connected"),
    ]

def test_pro_fleet_round_robin_equalization():
    async def _run():
        rotator = AccountRotator()
        profiles = get_mock_six_pro_profiles()
        
        with patch.object(rotator, "get_active_profiles", return_value=profiles):
            dispatched_nodes = []
            for _ in range(6):
                profile, q_num = await rotator.pick_next_profile(require_pro=True)
                dispatched_nodes.append(profile.id)
                
            # Verify all 6 distinct Pro nodes were picked across 6 dispatches
            assert len(set(dispatched_nodes)) == 6
            assert set(dispatched_nodes) == {"main", "dev83", "project-01", "adt2061", "bei79001", "adtmr"}

    asyncio.run(_run())

def test_pro_to_pro_429_failover():
    async def _run():
        rotator = AccountRotator()
        profiles = get_mock_six_pro_profiles()
        
        # Simulate first profile hitting 429 quota, second profile succeeding
        async def mock_query(profile_id, *args, **kwargs):
            if profile_id == "main":
                return {"success": False, "error": "HTTP 429: Resource has been exhausted (rate limit exceeded)"}
            return {"success": True, "answer": f"Success on {profile_id}", "conversationId": "conv-123"}

        with patch.object(rotator, "get_active_profiles", return_value=profiles), \
             patch("mcp_server.rotator.query_notebook", side_effect=mock_query), \
             patch.object(rotator, "ensure_profile_has_access", return_value=True):
            
            res = await rotator.execute_query_rotated(
                notebook_id="test-nb-id",
                question="Analyze the research paper using pro",
                require_pro=True
            )
            
            assert res["success"] is True
            assert "Success on" in res["answer"]
            assert res["rotation_stats"]["executed_profile_id"] != "main"
            assert res["rotation_stats"]["quota_fallbacks_triggered"] == 1
            assert "main" in rotator._cooldowns
            assert rotator._cooldowns["main"]["reason"] == "burst"

    asyncio.run(_run())

def test_inflight_concurrency_load_balancing():
    async def _run():
        rotator = AccountRotator()
        profiles = get_mock_six_pro_profiles()
        
        with patch.object(rotator, "get_active_profiles", return_value=profiles):
            # Manually simulate node 'main' and 'dev83' having 2 in-flight queries
            rotator._inflight["main"] = 2
            rotator._inflight["dev83"] = 2
            
            # Next picks should go to the zero in-flight nodes first
            selected_1, _ = await rotator.pick_next_profile(require_pro=True)
            assert selected_1.id in {"project-01", "adt2061", "bei79001", "adtmr"}
            
            rotator._inflight[selected_1.id] = 2
            selected_2, _ = await rotator.pick_next_profile(require_pro=True)
            assert selected_2.id in ({"project-01", "adt2061", "bei79001", "adtmr"} - {selected_1.id})

    asyncio.run(_run())

def test_multi_turn_session_pinning():
    async def _run():
        rotator = AccountRotator()
        profiles = get_mock_six_pro_profiles()
        
        async def mock_query(profile_id, *args, **kwargs):
            return {"success": True, "answer": f"Turn response from {profile_id}", "conversationId": "conv-pinned-456"}

        with patch.object(rotator, "get_active_profiles", return_value=profiles), \
             patch("mcp_server.rotator.query_notebook", side_effect=mock_query), \
             patch.object(rotator, "ensure_profile_has_access", return_value=True):
            
            # Turn 1
            res1 = await rotator.execute_query_rotated(
                notebook_id="test-nb-id",
                question="Turn 1: Introduce topic"
            )
            assert res1["success"] is True
            assigned_profile = res1["rotation_stats"]["executed_profile_id"]
            
            # Turn 2: Providing conversation_id should pin to the exact same profile
            res2 = await rotator.execute_query_rotated(
                notebook_id="test-nb-id",
                question="Turn 2: Follow up question",
                conversation_id="conv-pinned-456"
            )
            assert res2["success"] is True
            assert res2["rotation_stats"]["executed_profile_id"] == assigned_profile

    asyncio.run(_run())

def test_fleet_api_routes():
    client = TestClient(app)
    
    # 1. Test /api/fleet/health
    res_health = client.get("/api/fleet/health")
    assert res_health.status_code == 200
    data_health = res_health.json()
    assert "fleet_status" in data_health
    assert "total_nodes" in data_health
    assert "profiles" in data_health
    
    # 2. Test /api/fleet/metrics
    res_metrics = client.get("/api/fleet/metrics")
    assert res_metrics.status_code == 200
    data_metrics = res_metrics.json()
    assert "pro_fleet_size" in data_metrics
    assert "fleet_utilization_percent" in data_metrics
    assert "total_inflight_queries" in data_metrics

def test_mcp_check_fleet_health_tool_registered():
    server = create_server()
    tool_names = list(server._tool_manager._tools.keys())
    assert "check_fleet_health" in tool_names
    assert "rotation_status" in tool_names