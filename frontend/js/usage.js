// Google Account Fleet Usage & Quota Limits Controller.
import { handleSetPro } from './accounts.js';
import { apiFetch } from './api.js';
import { renderAccountPills, renderNotebooksGrid } from './notebooks.js';
import { state } from './state.js';
import { closeModal, escapeHtml, isModalOpen, openModal, showToast } from './ui.js';

export function formatResetCountdown(isoDate) {
  if (!isoDate) return 'Reset time pending';
  try {
    const target = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = target - now;
    if (diffMs <= 0) return 'Resets momentarily';
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const days = Math.floor(hours / 24);
    if (days >= 2) {
      return `Resets in ${days} days`;
    } else if (days === 1) {
      return `Resets in 1d ${hours % 24}h`;
    } else if (hours > 0) {
      return `Resets in ${hours}h ${mins}m`;
    } else {
      return `Resets in ${Math.max(1, mins)}m`;
    }
  } catch (e) {
    return 'Resets on cycle';
  }
}

export async function openUsageLimitsModal() {
  openModal('modal-usage');
  if (!state.fleetUsage || (Date.now() - (state.fleetUsageTimestamp || 0) > 45000)) {
    await loadFleetUsage(false);
  } else {
    renderUsageModal();
  }
}

export async function loadFleetUsage(forceRefresh = false) {
  state.isUsageLoading = true;
  const refreshIcon = document.getElementById('usage-refresh-icon');
  const refreshBtn = document.getElementById('btn-refresh-usage');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');
  if (refreshBtn) refreshBtn.disabled = true;

  if (isModalOpen('modal-usage') && !state.fleetUsage) {
    renderUsageSkeletons();
  }

  try {
    const endpoint = forceRefresh ? '/api/usage?force_refresh=true' : '/api/usage';
    const res = await apiFetch(endpoint);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    state.fleetUsage = data;
    state.fleetUsageTimestamp = Date.now();
    renderUsageModal();
    renderSidebarFleetQuota();
    if (forceRefresh) {
      showToast('Fleet quota & plan limits refreshed', 'success');
    }
  } catch (err) {
    console.error('Failed to load fleet usage:', err);
    showToast('Failed to load quota limits: ' + err.message, 'error');
  } finally {
    state.isUsageLoading = false;
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

export async function refreshProfileUsage(profileId) {
  const btn = document.querySelector(`.btn-refresh-single-usage[data-profile="${profileId}"]`);
  const icon = btn ? btn.querySelector('i') : null;
  if (icon) icon.classList.add('animate-spin');
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`/api/profiles/${encodeURIComponent(profileId)}/usage`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();

    if (state.fleetUsage && state.fleetUsage.profiles) {
      const idx = state.fleetUsage.profiles.findIndex(p => p.profile_id === profileId);
      if (idx !== -1) {
        state.fleetUsage.profiles[idx] = updated;
      }
    }
    renderUsageModal();
    renderSidebarFleetQuota();
    showToast(`Quota refreshed for ${updated.display_name || profileId}`, 'success');
  } catch (err) {
    showToast(`Failed to refresh quota for ${profileId}: ${err.message}`, 'error');
  } finally {
    if (icon) icon.classList.remove('animate-spin');
    if (btn) btn.disabled = false;
  }
}

export function renderSidebarFleetQuota() {
  const card = document.getElementById('sidebar-fleet-quota-card');
  const headroomBadge = document.getElementById('sidebar-quota-headroom-badge');
  const dotsContainer = document.getElementById('sidebar-quota-dots');
  const statusText = document.getElementById('sidebar-quota-status-text');
  if (!card) return;

  if (!state.fleetUsage || !state.fleetUsage.profiles) {
    if (statusText) statusText.textContent = `${state.profiles.length || 6} Accounts Loaded`;
    return;
  }

  const data = state.fleetUsage;
  const avgUsed = data.average_rolling_used || 0;
  const headroom = Math.max(0, 100 - avgUsed);

  if (headroomBadge) {
    headroomBadge.textContent = `${headroom.toFixed(0)}% Headroom`;
    if (headroom >= 40) {
      headroomBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--google-green-container)] text-[var(--google-green)] font-semibold';
    } else if (headroom >= 15) {
      headroomBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--google-yellow-container)] text-[var(--google-yellow)] font-semibold';
    } else {
      headroomBadge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--google-red-container)] text-[var(--google-red)] font-semibold';
    }
  }

  if (dotsContainer) {
    const maxDots = 12;
    const visibleProfiles = data.profiles.slice(0, maxDots);
    const overflowCount = Math.max(0, data.profiles.length - maxDots);
    dotsContainer.innerHTML = visibleProfiles.map(p => {
      const rolling = (p.windows || []).find(w => w.window === 'rolling');
      const used = rolling ? rolling.percent_used : 0;
      let statusColor = 'var(--google-green)';
      if (used >= 90) statusColor = 'var(--google-red)';
      else if (used >= 70) statusColor = 'var(--google-yellow)';

      return `<div class="quota-dot shrink-0 cursor-pointer" style="background-color: ${statusColor};" title="${escapeHtml(p.display_name)} (${escapeHtml(p.profile_id)}): ${used.toFixed(1)}% used"></div>`;
    }).join('') + (overflowCount > 0 ? `<span class="text-[10px] font-mono text-[var(--m3-on-surface-subtle)] ml-0.5">+${overflowCount}</span>` : '');
  }

  if (statusText) {
    if (data.critical_count > 0) {
      statusText.textContent = `${data.critical_count} account${data.critical_count > 1 ? 's' : ''} near limit`;
    } else if (data.warning_count > 0) {
      statusText.textContent = `${data.warning_count} account${data.warning_count > 1 ? 's' : ''} in use`;
    } else {
      statusText.textContent = `All ${data.total_accounts} accounts optimal`;
    }
  }
}

export function renderUsageModal() {
  const data = state.fleetUsage;
  if (!data) return;

  const healthEl = document.getElementById('usage-kpi-health');
  const healthSubEl = document.getElementById('usage-kpi-health-sub');
  const healthIconEl = document.getElementById('usage-kpi-health-icon');
  const rollingEl = document.getElementById('usage-kpi-rolling');
  const rollingSubEl = document.getElementById('usage-kpi-rolling-sub');
  const accountsEl = document.getElementById('usage-kpi-accounts');
  const accountsSubEl = document.getElementById('usage-kpi-accounts-sub');
  const lastUpdatedEl = document.getElementById('usage-last-updated-label');

  const avgUsed = data.average_rolling_used || 0;
  const headroom = Math.max(0, 100 - avgUsed);

  if (healthEl) {
    if (data.critical_count > 0) {
      healthEl.textContent = `${data.critical_count} Critical`;
      healthEl.className = 'text-base font-bold text-[var(--google-red)]';
      if (healthSubEl) healthSubEl.textContent = `${data.healthy_count} optimal, ${data.warning_count} warning`;
      if (healthIconEl) {
        healthIconEl.className = 'w-10 h-10 rounded-2xl bg-[var(--google-red-container)] text-[var(--google-red)] flex items-center justify-center shrink-0';
        healthIconEl.innerHTML = '<i data-lucide="alert-triangle" class="w-5 h-5"></i>';
      }
    } else if (data.warning_count > 0) {
      healthEl.textContent = `${data.warning_count} Warning`;
      healthEl.className = 'text-base font-bold text-[var(--google-yellow)]';
      if (healthSubEl) healthSubEl.textContent = `${data.healthy_count} accounts optimal headroom`;
      if (healthIconEl) {
        healthIconEl.className = 'w-10 h-10 rounded-2xl bg-[var(--google-yellow-container)] text-[var(--google-yellow)] flex items-center justify-center shrink-0';
        healthIconEl.innerHTML = '<i data-lucide="shield-alert" class="w-5 h-5"></i>';
      }
    } else {
      healthEl.textContent = 'All Optimal';
      healthEl.className = 'text-base font-bold text-[var(--google-green)]';
      if (healthSubEl) healthSubEl.textContent = 'Full capacity across fleet';
      if (healthIconEl) {
        healthIconEl.className = 'w-10 h-10 rounded-2xl bg-[var(--google-green-container)] text-[var(--google-green)] flex items-center justify-center shrink-0';
        healthIconEl.innerHTML = '<i data-lucide="shield-check" class="w-5 h-5"></i>';
      }
    }
  }

  if (rollingEl) {
    rollingEl.textContent = `${headroom.toFixed(1)}% Headroom`;
  }
  if (rollingSubEl) {
    rollingSubEl.textContent = `Fleet average: ${avgUsed.toFixed(1)}% used`;
  }

  if (accountsEl) {
    accountsEl.textContent = `${data.connected_accounts} / ${data.total_accounts} Ready`;
  }
  if (accountsSubEl) {
    accountsSubEl.textContent = 'Round-robin query pool active';
  }

  if (lastUpdatedEl && data.fetched_at) {
    const time = new Date(data.fetched_at).toLocaleTimeString();
    lastUpdatedEl.textContent = `Synced at ${time}`;
  }

  // Render Account Cards
  const container = document.getElementById('usage-accounts-grid');
  if (!container) return;

  container.innerHTML = (data.profiles || []).map(p => {
    const rolling = (p.windows || []).find(w => w.window === 'rolling') || { percent_used: 0, percent_remaining: 100 };
    const weekly = (p.windows || []).find(w => w.window === 'weekly') || { percent_used: 0, percent_remaining: 100 };
    const isDefaultPro = p.is_default_pro;

    const rollingUsed = rolling.percent_used;
    const rollingRemaining = rolling.percent_remaining;
    const rollingCountdown = formatResetCountdown(rolling.resets_at);

    const weeklyUsed = weekly.percent_used;
    const weeklyRemaining = weekly.percent_remaining;
    const weeklyCountdown = formatResetCountdown(weekly.resets_at);

    let rollingColorClass = 'healthy';
    let statusBadge = '<span class="text-[10px] font-medium text-[var(--google-green)] bg-[var(--google-green-container)]/50 px-2 py-0.5 rounded-full flex items-center gap-1 border border-[var(--google-green)]/20"><span class="w-1.5 h-1.5 rounded-full bg-[var(--google-green)]"></span>Ready</span>';
    if (rollingUsed >= 90) {
      rollingColorClass = 'critical';
      statusBadge = '<span class="text-[10px] font-medium text-[var(--google-red)] bg-[var(--google-red-container)]/50 px-2 py-0.5 rounded-full flex items-center gap-1 border border-[var(--google-red)]/20"><span class="w-1.5 h-1.5 rounded-full bg-[var(--google-red)]"></span>Throttled</span>';
    } else if (rollingUsed >= 70) {
      rollingColorClass = 'warning';
      statusBadge = '<span class="text-[10px] font-medium text-[var(--google-yellow)] bg-[var(--google-yellow-container)]/50 px-2 py-0.5 rounded-full flex items-center gap-1 border border-[var(--google-yellow)]/20"><span class="w-1.5 h-1.5 rounded-full bg-[var(--google-yellow)]"></span>Moderate</span>';
    }

    return `
      <div class="m3-card p-4 rounded-2xl flex flex-col justify-between space-y-3.5 hover:border-[var(--m3-outline)] transition-all animate-m3-enter relative overflow-hidden" data-profile-card="${escapeHtml(p.profile_id)}">
        
        <!-- Account Header Row -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs" style="background-color: ${p.color || '#8ab4f8'};"></div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h5 class="text-xs font-bold text-[var(--m3-on-surface)] truncate" title="${escapeHtml(p.display_name)}">
                  ${escapeHtml(p.display_name)}
                </h5>
                <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[var(--m3-surface-container)] text-[var(--m3-on-surface-subtle)] border border-[var(--m3-outline-variant)]">
                  ${escapeHtml(p.profile_id)}
                </span>
                ${isDefaultPro ? `
                  <span class="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-[var(--google-yellow-container)] text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 flex items-center gap-0.5">
                    <i data-lucide="star" class="w-2.5 h-2.5 fill-current"></i> Default Pro
                  </span>
                ` : ''}
              </div>
              <p class="text-[10px] text-[var(--m3-on-surface-subtle)] font-mono truncate max-w-[210px] mt-0.5" title="${escapeHtml(p.email)}">
                ${escapeHtml(p.email || 'No email associated')}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            ${statusBadge}
            <button
              type="button"
              class="btn-refresh-single-usage p-1 rounded-lg text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-blue)] hover:bg-[var(--m3-surface-container-high)] transition cursor-pointer"
              data-profile="${escapeHtml(p.profile_id)}"
              title="Refresh quota for ${escapeHtml(p.display_name)}"
            >
              <i data-lucide="refresh-cw" class="w-3 h-3"></i>
            </button>
          </div>
        </div>

        <!-- 24-Hour Rolling Quota Section -->
        <div class="p-3 rounded-xl bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)]/60 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="font-medium text-[var(--m3-on-surface)] flex items-center gap-1.5">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-[var(--google-blue)]"></i>
              24h Rolling Quota
            </span>
            <span class="font-mono text-xs font-semibold ${rollingUsed >= 90 ? 'text-[var(--google-red)]' : (rollingUsed >= 70 ? 'text-[var(--google-yellow)]' : 'text-[var(--google-green)]')}">
              ${rollingUsed.toFixed(1)}% used
            </span>
          </div>

          <!-- Progress Bar -->
          <div class="quota-meter-track">
            <div class="quota-meter-fill ${rollingColorClass}" style="width: ${Math.min(100, Math.max(0, rollingUsed))}%;"></div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-[var(--m3-on-surface-variant)] pt-0.5">
            <span class="font-mono text-[10px]">${rollingRemaining.toFixed(1)}% headroom left</span>
            <span class="text-[10px] text-[var(--m3-on-surface-subtle)] flex items-center gap-1" title="UTC Reset: ${escapeHtml(rolling.resets_at || 'N/A')}">
              <i data-lucide="history" class="w-3 h-3 text-[var(--google-blue)]"></i>
              ${escapeHtml(rollingCountdown)}
            </span>
          </div>
        </div>

        <!-- Weekly Plan Allocation Section -->
        <div class="space-y-1.5 px-1">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[var(--m3-on-surface-subtle)] flex items-center gap-1">
              <i data-lucide="calendar" class="w-3 h-3"></i>
              Weekly Plan
            </span>
            <span class="font-mono text-[10px] text-[var(--m3-on-surface)] font-medium">
              ${weeklyUsed.toFixed(1)}% (${weeklyRemaining.toFixed(1)}% left)
            </span>
          </div>
          <div class="quota-meter-track" style="height: 4px;">
            <div class="quota-meter-fill ${weeklyUsed >= 90 ? 'critical' : 'healthy'}" style="width: ${Math.min(100, Math.max(0, weeklyUsed))}%;"></div>
          </div>
          <div class="flex items-center justify-between text-[10px] text-[var(--m3-on-surface-subtle)]">
            <span>Tier: <span class="uppercase font-mono font-medium text-[var(--m3-on-surface-variant)]">${escapeHtml(p.tier)}</span></span>
            <span>${escapeHtml(weeklyCountdown)}</span>
          </div>
        </div>

        <!-- Quick Action Row -->
        <div class="pt-2 border-t border-[var(--m3-outline-variant)]/60 flex items-center justify-between">
          <button
            type="button"
            class="btn-usage-filter-notebooks text-[11px] text-[var(--google-blue)] hover:underline font-medium cursor-pointer flex items-center gap-1"
            data-profile="${escapeHtml(p.profile_id)}"
          >
            <i data-lucide="filter" class="w-3 h-3"></i>
            <span>View Notebooks</span>
          </button>
          ${!isDefaultPro ? `
            <button
              type="button"
              class="btn-usage-set-pro text-[11px] text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-yellow)] font-medium cursor-pointer flex items-center gap-1"
              data-profile="${escapeHtml(p.profile_id)}"
            >
              <i data-lucide="sparkles" class="w-3 h-3"></i>
              <span>Make Primary Pro</span>
            </button>
          ` : `
            <span class="text-[10px] text-[var(--google-yellow)] font-medium flex items-center gap-1">
              <i data-lucide="check-circle" class="w-3 h-3"></i> Primary AI
            </span>
          `}
        </div>

      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-refresh-single-usage').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.getAttribute('data-profile');
      if (pid) refreshProfileUsage(pid);
    });
  });

  container.querySelectorAll('.btn-usage-filter-notebooks').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.getAttribute('data-profile');
      if (pid) {
        state.activeProfileFilter = pid;
        renderAccountPills();
        renderNotebooksGrid();
        closeModal('modal-usage');
        showToast(`Filtered notebooks for ${pid}`, 'info');
      }
    });
  });

  container.querySelectorAll('.btn-usage-set-pro').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pid = btn.getAttribute('data-profile');
      if (pid) {
        await handleSetPro(pid);
        await loadFleetUsage(false);
      }
    });
  });

  if (window.lucide) lucide.createIcons({ root: container });
}

export function renderUsageSkeletons() {
  const container = document.getElementById('usage-accounts-grid');
  if (!container) return;
  container.innerHTML = Array(6).fill(0).map(() => `
    <div class="m3-card p-4 rounded-2xl space-y-4">
      <div class="flex items-center gap-3">
        <div class="w-3.5 h-3.5 rounded-full google-skeleton"></div>
        <div class="space-y-1.5 flex-1">
          <div class="h-4 w-28 rounded google-skeleton"></div>
          <div class="h-3 w-40 rounded google-skeleton"></div>
        </div>
      </div>
      <div class="p-3 rounded-xl m3-subcard space-y-2">
        <div class="h-3.5 w-full rounded google-skeleton"></div>
        <div class="h-2 w-full rounded-full google-skeleton"></div>
        <div class="h-3 w-2/3 rounded google-skeleton"></div>
      </div>
      <div class="h-8 w-full rounded-xl google-skeleton"></div>
    </div>
  `).join('');
}
