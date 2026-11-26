// Google Calendar Agenda & Study Copilot Controller.
import { apiFetch } from './api.js';
import { state } from './state.js';
import { escapeHtml, showToast } from './ui.js';

export const AGENDA_COLLAPSED_KEY = 'supernlm_agenda_collapsed';
export const UPCOMING_OPEN_KEY = 'supernlm_upcoming_open';

export async function loadCalendarAgenda(forceRefresh = false) {
  const section = document.getElementById('calendar-agenda-section');
  if (!section) return;

  const refreshIcon = document.getElementById('agenda-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const endpoint = forceRefresh ? '/api/calendar/refresh?days=14' : '/api/calendar/agenda?days=14';
    const method = forceRefresh ? 'POST' : 'GET';
    const res = await apiFetch(endpoint, { method });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.calendarAgenda = data;
    renderCalendarAgenda();
    if (forceRefresh) {
      showToast('Google Calendar agenda refreshed', 'success');
    }
  } catch (err) {
    console.warn('Could not load Google Calendar agenda:', err);
    if (section && (!state.calendarAgenda || !state.calendarAgenda.configured)) {
      section.classList.add('hidden');
    }
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

export function toggleAgendaCollapse(forceState = null) {
  const body = document.getElementById('agenda-content-body');
  const chevron = document.getElementById('agenda-chevron-icon');
  if (!body) return;

  const isCurrentlyCollapsed = body.classList.contains('hidden');
  const shouldCollapse = forceState !== null ? forceState : !isCurrentlyCollapsed;

  if (shouldCollapse) {
    body.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    localStorage.setItem(AGENDA_COLLAPSED_KEY, 'true');
  } else {
    body.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    localStorage.setItem(AGENDA_COLLAPSED_KEY, 'false');
  }
}

export function toggleUpcomingEvents() {
  const container = document.getElementById('agenda-upcoming-container');
  const chevron = document.getElementById('upcoming-chevron');
  if (!container) return;

  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    localStorage.setItem(UPCOMING_OPEN_KEY, 'true');
  } else {
    container.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    localStorage.setItem(UPCOMING_OPEN_KEY, 'false');
  }
}

export function renderCalendarAgenda() {
  const agenda = state.calendarAgenda;
  const section = document.getElementById('calendar-agenda-section');
  if (!section) return;

  if (!agenda || !agenda.configured) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  // Subtitle & badges
  const subtitleEl = document.getElementById('agenda-subtitle');
  const badgeCountEl = document.getElementById('agenda-badge-count');

  if (subtitleEl) {
    let emailDisplay = '';
    if (agenda.calendar_email) {
      const email = String(agenda.calendar_email);
      if (!email.includes('@group.calendar.google.com') && email.length <= 28) {
        emailDisplay = `${escapeHtml(email)} • `;
      }
    }
    const todayText = agenda.today_count === 1 ? '1 scheduled today' : `${agenda.today_count} scheduled today`;
    const upcomingText = agenda.upcoming_count > 0 ? `, ${agenda.upcoming_count} upcoming this week` : '';
    subtitleEl.textContent = `${emailDisplay}${todayText}${upcomingText}`;
  }
  if (badgeCountEl) {
    badgeCountEl.textContent = `${agenda.today_count} Today`;
  }

  // Render Today's Events
  const todayContainer = document.getElementById('agenda-today-container');
  if (todayContainer) {
    if (!agenda.today_events || agenda.today_events.length === 0) {
      todayContainer.innerHTML = `
        <div class="py-2.5 px-3.5 rounded-xl m3-subcard text-xs text-[var(--m3-on-surface-subtle)] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-[var(--google-green)]"></i>
            <span>No lectures or exams scheduled for today.</span>
          </div>
          ${agenda.upcoming_count > 0 ? `<span class="text-[11px] text-[var(--google-blue)] font-medium">${agenda.upcoming_count} upcoming this week</span>` : ''}
        </div>
      `;
    } else {
      todayContainer.innerHTML = agenda.today_events.map(e => renderAgendaEventItem(e, true)).join('');
    }
  }

  // Render Upcoming Events
  const upcomingSection = document.getElementById('agenda-upcoming-section');
  const upcomingContainer = document.getElementById('agenda-upcoming-container');
  const upcomingToggleText = document.getElementById('upcoming-events-toggle-text');

  if (upcomingSection && upcomingContainer) {
    if (!agenda.upcoming_events || agenda.upcoming_events.length === 0) {
      upcomingSection.classList.add('hidden');
    } else {
      upcomingSection.classList.remove('hidden');
      if (upcomingToggleText) {
        upcomingToggleText.textContent = `Show ${agenda.upcoming_count} Upcoming Events this Week`;
      }
      upcomingContainer.innerHTML = agenda.upcoming_events.map(e => renderAgendaEventItem(e, false)).join('');

      // Restore upcoming open state
      const wasOpen = localStorage.getItem(UPCOMING_OPEN_KEY) === 'true';
      const upcomingChevron = document.getElementById('upcoming-chevron');
      if (wasOpen) {
        upcomingContainer.classList.remove('hidden');
        if (upcomingChevron) upcomingChevron.style.transform = 'rotate(180deg)';
      } else {
        upcomingContainer.classList.add('hidden');
        if (upcomingChevron) upcomingChevron.style.transform = 'rotate(0deg)';
      }
    }
  }

  // Restore collapsed state (default expanded if today has events)
  const savedCollapsed = localStorage.getItem(AGENDA_COLLAPSED_KEY);
  const isCollapsed = savedCollapsed !== null ? (savedCollapsed === 'true') : false;
  toggleAgendaCollapse(isCollapsed);

  // Hook up event action buttons
  section.querySelectorAll('.btn-agenda-chat').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const nbId = btn.getAttribute('data-id');
      const pId = btn.getAttribute('data-profile');
      const title = btn.getAttribute('data-title');
      if (window.openChatModal) {
        window.openChatModal(nbId, pId, title);
      }
    };
  });

  if (window.lucide) lucide.createIcons({ root: section });
}

export function renderAgendaEventItem(event, isToday) {
  const typeTag = `<span class="agenda-type-tag ${event.event_type}">${event.event_type}</span>`;
  const timeStr = event.time_label || 'All Day';
  const dateStr = isToday ? 'Today' : (event.date_label || '');

  let matchedHtml = '';
  if (event.matched_notebook) {
    const nb = event.matched_notebook;
    const courseCodeBadge = nb.course_code ? `
      <span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[var(--google-green-container)] text-[var(--google-green)] border border-[var(--google-green)]/30">
        ${escapeHtml(nb.course_code)}
      </span>
    ` : '';

    matchedHtml = `
      <div class="agenda-matched-chip">
        <div class="flex items-center gap-1.5 min-w-0">
          <i data-lucide="book-marked" class="w-3.5 h-3.5 text-[var(--google-blue)] shrink-0"></i>
          ${courseCodeBadge}
          <span class="text-xs font-medium text-[var(--m3-on-surface)] truncate max-w-[200px] sm:max-w-xs" title="${escapeHtml(nb.title)}">
            ${escapeHtml(nb.title)}
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0 ml-auto">
          <button
            type="button"
            class="btn-agenda-chat google-btn-tonal text-xs px-2.5 py-1 flex items-center gap-1 cursor-pointer"
            data-id="${escapeHtml(nb.id)}"
            data-profile="${escapeHtml(nb.profile_id)}"
            data-title="${escapeHtml(nb.title)}"
            title="Ask AI questions about this course notebook"
          >
            <i data-lucide="message-square" class="w-3 h-3"></i>
            <span>Chat</span>
          </button>
          <a
            href="https://notebooklm.google.com/notebook/${escapeHtml(nb.id)}"
            target="_blank"
            rel="noopener noreferrer"
            class="google-btn-outlined p-1 text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-blue)] transition flex items-center justify-center rounded-lg"
            title="Open in NotebookLM (new tab)"
          >
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
          </a>
        </div>
      </div>
    `;
  }

  return `
    <div class="agenda-card p-3 rounded-2xl m3-subcard flex flex-col sm:flex-row sm:items-center justify-between gap-2.5" data-type="${event.event_type}">
      <div class="min-w-0 space-y-1 pl-1">
        <div class="flex items-center gap-2 flex-wrap">
          ${typeTag}
          <span class="text-[11px] font-mono text-[var(--google-blue)] font-medium bg-[var(--google-blue-container)]/40 px-2 py-0.5 rounded-full">
            ${escapeHtml(dateStr)} • ${escapeHtml(timeStr)}
          </span>
          ${event.location ? `<span class="text-[10px] text-[var(--m3-on-surface-subtle)] truncate max-w-[160px] flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3"></i> ${escapeHtml(event.location)}</span>` : ''}
        </div>
        <h4 class="text-xs font-semibold text-[var(--m3-on-surface)] leading-snug break-words">
          ${escapeHtml(event.summary)}
        </h4>
      </div>
      <div class="shrink-0">
        ${matchedHtml}
      </div>
    </div>
  `;
}
