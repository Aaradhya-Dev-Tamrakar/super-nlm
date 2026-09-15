import re
import logging
import asyncio
from datetime import datetime, date, time, timedelta, timezone
from typing import List, Optional, Dict, Any, Tuple
import httpx
import icalendar
import recurring_ical_events
from dateutil import tz

from backend.config import GOOGLE_CALENDAR_ICAL_URL, CALENDAR_CACHE_TTL_SECONDS
from backend.models import (
    CalendarAgendaResponse, CalendarAgendaEvent, MatchedNotebookSummary, Notebook,
    DEFAULT_COURSE_NOTEBOOK_MAP
)

logger = logging.getLogger("super_nlm.calendar")

# Standard course acronym mapping to match university syllabus notebooks
ACRONYM_TO_KEYWORDS = {
    "AI": ["artificial intelligence", "ct653"],
    "DSAP": ["digital signal analysis", "dsap", "ct704"],
    "RF": ["rf and microwave", "microwave engineering", "ex752"],
    "OM": ["organization and management", "me708"],
    "O&M": ["organization and management", "me708"],
    "WC": ["wireless communications", "ex751"],
    "AERO": ["aeronautical telecommunication", "ex725"],
}

COURSE_CODE_REGEX = re.compile(r'\b([A-Z]{2,4}\s*\d{3}(?:\s*\d{2})?)\b', re.IGNORECASE)

class CalendarService:
    def __init__(self):
        self._cache_raw_ics: Optional[str] = None
        self._last_fetch_time: float = 0.0
        self._lock = asyncio.Lock()

    def is_configured(self) -> bool:
        return bool(GOOGLE_CALENDAR_ICAL_URL and GOOGLE_CALENDAR_ICAL_URL.startswith("http"))

    def get_calendar_email(self) -> str:
        """Extract email from Google Calendar iCal URL if present."""
        if not self.is_configured():
            return ""
        try:
            parts = GOOGLE_CALENDAR_ICAL_URL.split("/ical/")
            if len(parts) > 1:
                ident = parts[1].split("/")[0]
                ident = ident.replace("%40", "@")
                if "@" in ident:
                    return ident
        except Exception:
            pass
        return "aaradhyadevtmr@gmail.com"

    async def fetch_raw_ics(self, force_refresh: bool = False) -> str:
        """Fetch the .ics calendar string, using in-memory cache when within TTL."""
        if not self.is_configured():
            raise ValueError("Google Calendar iCal URL is not configured in .env")

        now_ts = datetime.now().timestamp()
        async with self._lock:
            if not force_refresh and self._cache_raw_ics and (now_ts - self._last_fetch_time < CALENDAR_CACHE_TTL_SECONDS):
                return self._cache_raw_ics

            logger.info("Fetching fresh Google Calendar iCal feed...")
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                resp = await client.get(GOOGLE_CALENDAR_ICAL_URL, headers={
                    "User-Agent": "SuperNLM-Calendar-Sync/1.0",
                    "Accept": "text/calendar, text/plain, */*"
                })
                resp.raise_for_status()
                raw_ics = resp.text

            self._cache_raw_ics = raw_ics
            self._last_fetch_time = now_ts
            return raw_ics

    def _match_event_to_notebook(self, summary: str, description: str, notebooks: List[Notebook]) -> Optional[MatchedNotebookSummary]:
        """
        Smart matching of an event to a notebook using:
        1. Explicit course codes (e.g. CT704, EX751)
        2. Known academic acronyms (AI, DSAP, RF, O&M)
        3. Title keyword matching
        Prioritizes default/canonical course notebooks and non-copy notebooks.
        """
        if not notebooks:
            return None

        combined_text = f"{summary} {description}".lower()

        def _is_copy(title: str) -> bool:
            t = title.lower().strip()
            return t.startswith("copy ") or t.startswith("copy of")

        # 1. Match by Course Code in event text (e.g. CT653, EX751, ME708, CT704)
        found_codes = COURSE_CODE_REGEX.findall(combined_text)
        if found_codes:
            normalized_codes = {c.replace(" ", "").upper() for c in found_codes}
            candidates = [
                n for n in notebooks
                if (n.course_code or "").replace(" ", "").upper() in normalized_codes
            ]
            if candidates:
                def _code_sort_key(nb):
                    nb_id = getattr(nb, 'id', '')
                    title = getattr(nb, 'title', '')
                    is_canonical = any(DEFAULT_COURSE_NOTEBOOK_MAP.get(c) == nb_id for c in normalized_codes)
                    return (not is_canonical, _is_copy(title))

                candidates.sort(key=_code_sort_key)
                best = candidates[0]
                return MatchedNotebookSummary(
                    id=best.id,
                    title=best.title,
                    profile_id=getattr(best, "profileId", getattr(best, "profile_id", "")),
                    course_code=best.course_code,
                    color=best.color,
                    match_reason=f"Course Code: {best.course_code}"
                )

        # 2. Match by Acronyms (e.g. DSAP, AI, RF, O&M)
        words = set(re.findall(r'\b[A-Za-z0-9&]+\b', summary.upper()))
        for acronym, keywords in ACRONYM_TO_KEYWORDS.items():
            if acronym in words or (acronym == "O&M" and ("O&M" in summary.upper() or "OM" in words)):
                candidates = []
                for n in notebooks:
                    n_title_lower = n.title.lower()
                    n_code_lower = (n.course_code or "").lower()
                    for kw in keywords:
                        if kw in n_title_lower or kw in n_code_lower:
                            candidates.append(n)
                            break
                if candidates:
                    canonical_id = DEFAULT_COURSE_NOTEBOOK_MAP.get(acronym)
                    def _acronym_sort_key(nb):
                        nb_id = getattr(nb, 'id', '')
                        title = getattr(nb, 'title', '')
                        is_canonical = (nb_id == canonical_id)
                        return (not is_canonical, _is_copy(title))

                    candidates.sort(key=_acronym_sort_key)
                    best = candidates[0]
                    return MatchedNotebookSummary(
                        id=best.id,
                        title=best.title,
                        profile_id=getattr(best, "profileId", getattr(best, "profile_id", "")),
                        course_code=best.course_code,
                        color=best.color,
                        match_reason=f"Matched Acronym: {acronym}"
                    )

        # 3. Fuzzy title keyword and token overlap matching
        STOP_WORDS = {"and", "&", "the", "in", "of", "for", "to", "a", "an", "at", "by", "exam", "board", "lab", "bei", "iv", "i", "ii", "iii"}
        
        def tokenize(text: str) -> set:
            t = text.lower().replace("&", " and ")
            words = re.findall(r'\b[a-z0-9]+\b', t)
            stems = set()
            for w in words:
                if w not in STOP_WORDS and len(w) >= 3:
                    stem = w[:-1] if (w.endswith("s") and len(w) > 4 and not w.endswith("ss")) else w
                    stems.add(stem)
            return stems

        event_tokens = tokenize(combined_text)

        fuzzy_candidates = []
        for n in notebooks:
            clean_title = re.sub(r'^[A-Z]{2,4}\s*\d{3}(?:\s*\d{2})?\s*[-:]\s*', '', n.title, flags=re.IGNORECASE).strip().lower()
            nb_tokens = tokenize(clean_title)
            
            # Direct phrase match
            if len(clean_title) >= 4 and clean_title in combined_text:
                fuzzy_candidates.append((n, "Title Keyword Match"))
                continue

            # Significant token overlap: if all key words of notebook subject are in event
            if nb_tokens and len(nb_tokens) >= 2 and nb_tokens.issubset(event_tokens):
                fuzzy_candidates.append((n, "Course Topic Match"))
                continue

        if fuzzy_candidates:
            def _fuzzy_sort_key(item):
                nb, _ = item
                nb_id = getattr(nb, 'id', '')
                title = getattr(nb, 'title', '')
                is_canonical = any(nb_id == cid for cid in DEFAULT_COURSE_NOTEBOOK_MAP.values())
                return (not is_canonical, _is_copy(title))

            fuzzy_candidates.sort(key=_fuzzy_sort_key)
            best_nb, reason = fuzzy_candidates[0]
            return MatchedNotebookSummary(
                id=best_nb.id,
                title=best_nb.title,
                profile_id=getattr(best_nb, "profileId", getattr(best_nb, "profile_id", "")),
                course_code=best_nb.course_code,
                color=best_nb.color,
                match_reason=reason
            )

        return None

    def _determine_event_type(self, summary: str) -> str:
        s = summary.lower()
        if any(w in s for w in ["exam", "board", "midterm", "final", "test", "quiz", "assessment"]):
            return "exam"
        if any(w in s for w in ["lab", "practical", "workshop", "hands-on"]):
            return "lab"
        if any(w in s for w in ["lecture", "class", "session", "tutorial", "ta session"]):
            return "class"
        return "general"

    async def get_agenda(self, notebooks: List[Notebook], days: int = 7, force_refresh: bool = False) -> CalendarAgendaResponse:
        """
        Fetch and parse events for [today, today + days], matching events with notebooks.
        """
        if not self.is_configured():
            return CalendarAgendaResponse(
                configured=False,
                calendar_email="",
                today_count=0,
                upcoming_count=0,
                matched_count=0,
                today_events=[],
                upcoming_events=[]
            )

        raw_ics = await self.fetch_raw_ics(force_refresh=force_refresh)
        cal = icalendar.Calendar.from_ical(raw_ics)

        local_tz = tz.tzlocal()
        now = datetime.now(local_tz)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        window_end = today_start + timedelta(days=days + 1)

        events_in_range = recurring_ical_events.of(cal).between(today_start, window_end)

        today_events: List[CalendarAgendaEvent] = []
        upcoming_events: List[CalendarAgendaEvent] = []
        matched_counter = 0

        for comp in events_in_range:
            if comp.name != "VEVENT":
                continue

            summary = str(comp.get("SUMMARY", "Untitled Event")).strip()
            description = str(comp.get("DESCRIPTION", "")).strip()
            location = str(comp.get("LOCATION", "")).strip()
            uid = str(comp.get("UID", f"{summary}_{datetime.now().timestamp()}"))

            dtstart_prop = comp.get("DTSTART")
            dtend_prop = comp.get("DTEND")

            if not dtstart_prop:
                continue

            raw_start = dtstart_prop.dt
            all_day = False

            if isinstance(raw_start, datetime):
                if raw_start.tzinfo is None:
                    start_dt = raw_start.replace(tzinfo=local_tz)
                else:
                    start_dt = raw_start.astimezone(local_tz)
            elif isinstance(raw_start, date):
                all_day = True
                start_dt = datetime.combine(raw_start, time(0, 0, 0), tzinfo=local_tz)
            else:
                continue

            if dtend_prop:
                raw_end = dtend_prop.dt
                if isinstance(raw_end, datetime):
                    end_dt = raw_end.replace(tzinfo=local_tz) if raw_end.tzinfo is None else raw_end.astimezone(local_tz)
                elif isinstance(raw_end, date):
                    end_dt = datetime.combine(raw_end, time(23, 59, 59), tzinfo=local_tz)
                else:
                    end_dt = start_dt + timedelta(hours=1)
            else:
                end_dt = start_dt + timedelta(hours=1) if not all_day else start_dt + timedelta(days=1)

            event_date = start_dt.date()
            today_date = now.date()
            days_until = (event_date - today_date).days

            if days_until < 0:
                continue

            is_today = (days_until == 0)
            is_upcoming = (days_until > 0)

            if is_today:
                date_label = "Today"
            elif days_until == 1:
                date_label = "Tomorrow"
            else:
                date_label = start_dt.strftime("%A, %b %d")

            if all_day:
                time_label = "All Day"
            else:
                time_label = f"{start_dt.strftime('%I:%M %p').lstrip('0')} - {end_dt.strftime('%I:%M %p').lstrip('0')}"

            matched_nb = self._match_event_to_notebook(summary, description, notebooks)
            if matched_nb:
                matched_counter += 1

            event_obj = CalendarAgendaEvent(
                id=uid,
                summary=summary,
                start=start_dt.isoformat(),
                end=end_dt.isoformat(),
                all_day=all_day,
                location=location,
                description=description,
                is_today=is_today,
                is_upcoming=is_upcoming,
                days_until=days_until,
                time_label=time_label,
                date_label=date_label,
                event_type=self._determine_event_type(summary),
                matched_notebook=matched_nb
            )

            if is_today:
                today_events.append(event_obj)
            elif is_upcoming and days_until <= days:
                upcoming_events.append(event_obj)

        today_events.sort(key=lambda x: x.start)
        upcoming_events.sort(key=lambda x: x.start)

        return CalendarAgendaResponse(
            configured=True,
            calendar_email=self.get_calendar_email(),
            last_synced=datetime.now(timezone.utc).isoformat(),
            today_count=len(today_events),
            upcoming_count=len(upcoming_events),
            matched_count=matched_counter,
            today_events=today_events,
            upcoming_events=upcoming_events
        )

calendar_service = CalendarService()
