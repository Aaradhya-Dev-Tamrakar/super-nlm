import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
import pytest
from fastapi.testclient import TestClient
from backend.models import (
    ScheduledJob, BatchScheduleRequest, SingleScheduleRequest,
    SchedulerStatusResponse
)
from backend.scheduler import JobScheduler, sanitize_filename
from backend.app import app
from mcp_server.server import create_server

def test_sanitize_filename():
    raw = 'CT704: Digital Signal Analysis / Unit 3: FFT <version 1>'
    cleaned = sanitize_filename(raw)
    assert ':' not in cleaned
    assert '/' not in cleaned
    assert '<' not in cleaned
    assert '>' not in cleaned

def test_scheduler_batch_queue():
    async def _run():
        sched = JobScheduler()
        
        nb_map = {
            'nb-1': 'CT653 - Artificial Intelligence',
            'nb-2': 'EX751 - Wireless Communications',
            'nb-3': 'CT704 - Digital Signal Analysis',
            'nb-4': 'EX752 - RF and Microwave Engineering'
        }
        
        req = BatchScheduleRequest(
            notebook_ids=['nb-1', 'nb-2', 'nb-3', 'nb-4'],
            artifact_type='video',
            format_option='cinematic',
            style='auto_select',
            custom_prompt='Focus on high-yield exam concepts'
        )
        
        res = await sched.schedule_batch(req, nb_map)
        assert res.success is True
        assert res.total_queued == 4
        assert len(res.queued_jobs) == 4
        
        jobs = sched.get_jobs()
        assert len(jobs) == 4
        assert all(j.status == 'queued' for j in jobs)
        assert all(j.artifact_type == 'video' for j in jobs)
        assert all(j.format_option == 'cinematic' for j in jobs)

        # Test cancellation
        first_job_id = jobs[0].id
        cancel_ok = await sched.cancel_job(first_job_id)
        assert cancel_ok is True
        assert sched.get_job(first_job_id).status == 'cancelled'

        # Test force run now
        run_ok = await sched.run_job_now(first_job_id)
        assert run_ok is True
        assert sched.get_job(first_job_id).status == 'queued'

        # Test deletion
        del_ok = await sched.delete_job(first_job_id)
        assert del_ok is True
        assert sched.get_job(first_job_id) is None
        assert len(sched.get_jobs()) == 3

    asyncio.run(_run())

def test_mcp_scheduler_tools():
    server = create_server()
    tool_names = list(server._tool_manager._tools.keys())
    assert 'schedule_batch_creation' in tool_names
    assert 'get_scheduled_queue' in tool_names
    assert 'cancel_scheduled_job' in tool_names

def test_scheduler_api_routes():
    client = TestClient(app)
    
    # 1. Test status route
    res = client.get('/api/scheduler/status')
    assert res.status_code == 200
    data = res.json()
    assert 'total_jobs' in data
    assert 'queued_count' in data
    assert 'in_progress_count' in data

    # 2. Test batch creation endpoint
    batch_payload = {
        'notebook_ids': ['test-nb-1', 'test-nb-2'],
        'artifact_type': 'video',
        'format_option': 'cinematic',
        'style': 'auto_select',
        'trigger_type': 'immediate'
    }
    batch_res = client.post('/api/scheduler/batch', json=batch_payload)
    assert batch_res.status_code == 200
    batch_data = batch_res.json()
    assert batch_data['success'] is True
    assert batch_data['total_queued'] == 2

    # 3. Test list jobs route
    jobs_res = client.get('/api/scheduler/jobs')
    assert jobs_res.status_code == 200
    jobs_data = jobs_res.json()
    assert len(jobs_data) >= 2
