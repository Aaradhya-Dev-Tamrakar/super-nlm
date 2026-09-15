import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from backend.models import Notebook
from backend.calendar_service import calendar_service, CalendarService
from backend.app import app

def test_calendar_service_matching():
    svc = CalendarService()
    
    mock_notebooks = [
        Notebook(
            id='nb-ct704',
            title='CT704 - Digital Signal Analysis and Processing',
            url='https://notebooklm.google.com/notebook/nb-ct704',
            profileId='main',
            profileName='Personal',
            profileEmail='user@gmail.com',
            course_code='CT704',
            is_study=True,
            category='study'
        ),
        Notebook(
            id='nb-ex751',
            title='EX751 - Wireless Communications',
            url='https://notebooklm.google.com/notebook/nb-ex751',
            profileId='main',
            profileName='Personal',
            profileEmail='user@gmail.com',
            course_code='EX751',
            is_study=True,
            category='study'
        ),
        Notebook(
            id='nb-ct653',
            title='CT653 - Artificial Intelligence',
            url='https://notebooklm.google.com/notebook/nb-ct653',
            profileId='main',
            profileName='Personal',
            profileEmail='user@gmail.com',
            course_code='CT653',
            is_study=True,
            category='study'
        ),
        Notebook(
            id='nb-me708',
            title='ME708 - Organization and Management',
            url='https://notebooklm.google.com/notebook/nb-me708',
            profileId='main',
            profileName='Personal',
            profileEmail='user@gmail.com',
            course_code='ME708',
            is_study=True,
            category='study'
        ),
    ]

    # Test 1: Direct course code match
    m1 = svc._match_event_to_notebook('Midterm Exam CT704 Room 201', '', mock_notebooks)
    assert m1 is not None
    assert m1.id == 'nb-ct704'
    assert m1.course_code == 'CT704'

    # Test 2: Acronym match (DSAP)
    m2 = svc._match_event_to_notebook('DSAP (GG) Lecture', '', mock_notebooks)
    assert m2 is not None
    assert m2.id == 'nb-ct704'

    # Test 3: Stemming overlap (Wireless Communication singular vs Wireless Communications plural)
    m3 = svc._match_event_to_notebook('BEI IV/I Board Exam: Wireless Communication', '', mock_notebooks)
    assert m3 is not None
    assert m3.id == 'nb-ex751'

    # Test 4: Ampersand vs and (Digital Signal Analysis & Processing)
    m4 = svc._match_event_to_notebook('BEI IV/I Board Exam: Digital Signal Analysis & Processing', '', mock_notebooks)
    assert m4 is not None
    assert m4.id == 'nb-ct704'

    # Test 5: Acronym match (AI Fellows)
    m5 = svc._match_event_to_notebook('TA Session Weekly Reflection | AI Fellows', '', mock_notebooks)
    assert m5 is not None
    assert m5.id == 'nb-ct653'

    # Test 6: Unrelated event (no match)
    m6 = svc._match_event_to_notebook('Dentist Appointment with Dr. Sharma', '', mock_notebooks)
    assert m6 is None

    # Test 7: Default CT704 notebook prioritization over copies
    nbs_with_copy = [
        Notebook(
            id='nb-copy-ct704',
            title='Copy 0 of CT704 - Digital Signal Analysis and Processing',
            profileId='project-01',
            profileName='Project',
            profileEmail='majorprj79001@gmail.com',
            course_code='CT704',
            is_study=True,
            category='study'
        ),
        Notebook(
            id='66c34505-a60d-4a24-98df-446d8df12a24',
            title='CT704 - Digital Signal Analysis and Processing',
            profileId='main',
            profileName='Personal',
            profileEmail='aaradhyadevtmr@gmail.com',
            course_code='CT704',
            is_study=True,
            category='study'
        ),
    ]
    m7 = svc._match_event_to_notebook('CT704 DSAP Midterm Exam', '', nbs_with_copy)
    assert m7 is not None
    assert m7.id == '66c34505-a60d-4a24-98df-446d8df12a24'
    assert m7.title == 'CT704 - Digital Signal Analysis and Processing'

def test_event_type_classification():
    svc = CalendarService()
    assert svc._determine_event_type('BEI IV/I Board Exam: AI') == 'exam'
    assert svc._determine_event_type('Microwave Engineering Lab Session') == 'lab'
    assert svc._determine_event_type('TA Session Weekly Reflection') == 'class'
    assert svc._determine_event_type('Lunch with friends') == 'general'

def test_calendar_api_endpoints():
    client = TestClient(app)
    
    # 1. GET /api/calendar/agenda
    res = client.get('/api/calendar/agenda?days=7')
    assert res.status_code == 200
    data = res.json()
    assert 'configured' in data
    assert 'today_count' in data
    assert 'upcoming_count' in data
    assert 'today_events' in data
    assert 'upcoming_events' in data
    print(f'[OK] GET /api/calendar/agenda passed (configured={data["configured"]}, today={data["today_count"]}, upcoming={data["upcoming_count"]})')

    # 2. POST /api/calendar/refresh
    res_refresh = client.post('/api/calendar/refresh?days=7')
    assert res_refresh.status_code == 200
    refresh_data = res_refresh.json()
    assert refresh_data['configured'] == data['configured']
    print('[OK] POST /api/calendar/refresh passed')
