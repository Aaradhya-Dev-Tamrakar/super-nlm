// Google Accounts Manager, auth alert banner, login polling, and focus reconciliation.
import { apiFetch, loadNotebooks, loadProfiles, setGlobalLoading } from './api.js';
import { partitionProfilesByTier, renderAccountPills, renderCategoryChips, renderNotebooksGrid } from './notebooks.js';
import { state } from './state.js';
import { escapeHtml, openModal, showToast } from './ui.js';

const PROFILE_COLOR_PRESETS = ['#8ab4f8', '#81c995', '#fdd663', '#f28b82', '#c58af9', '#78d9ec', '#ff8bc9', '#f9ab00'];

let accountHooks = {
  loadFleetUsage: () => {},
};

export function registerAccountHooks(hooks) {
  accountHooks = { ...accountHooks, ...hooks };
}

export function renderAuthAlertBanner() {
  const container = document.getElementById('auth-alert-container');
  if (!container) return;

  const expiredProfiles = state.profiles.filter(p => p.status === 'expired');

  if (expiredProfiles.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const isMany = expiredProfiles.length > 2;
  const previewNames = expiredProfiles
    .slice(0, 3)
    .map(p => escapeHtml(p.displayName || p.id))
    .join(', ');
  const summaryNames = expiredProfiles.length > 3
    ? `${previewNames} and +${expiredProfiles.length - 3} more`
    : previewNames;
  const inlineButtons = expiredProfiles.slice(0, 2);

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="auth-alert-banner p-4 relative overflow-hidden animate-m3-enter">
      <div class="flex ${isMany ? 'flex-col gap-3' : 'flex-col md:flex-row items-start md:items-center justify-between gap-3'}">
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div class="p-2.5 rounded-2xl bg-[var(--google-red-container)] text-[var(--google-red)] shrink-0 mt-0.5 md:mt-0 shadow-sm">
            <i data-lucide="alert-triangle" class="w-5 h-5"></i>
          </div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--google-red)] flex items-center gap-1.5">
                <span>Google Session Expired</span>
                <span class="px-2 py-0.2 rounded-full bg-[var(--google-red-container)] text-[var(--google-red-on-container)] font-mono text-[10px]">
                  ${expiredProfiles.length} ${expiredProfiles.length === 1 ? 'Account' : 'Accounts'} Need Relogin
                </span>
              </h3>
            </div>
            <p class="text-xs text-[var(--m3-on-surface)] leading-relaxed">
              Notebooks from <strong class="text-[var(--google-red)]">${summaryNames}</strong> cannot be displayed or queried until re-authenticated.
            </p>
            ${expiredProfiles.some(p => p.lastError) ? `
              <p class="text-[11px] font-mono text-[var(--m3-on-surface-subtle)] bg-[var(--m3-surface-container-low)] px-2.5 py-1 rounded-lg border border-[var(--m3-outline-variant)]/60 truncate max-w-2xl" title="${escapeHtml(expiredProfiles.slice(0, 5).map(p => `${p.displayName}: ${p.lastError || ''}`).join(' | '))}">
                Error: ${escapeHtml(expiredProfiles.slice(0, 2).map(p => `${p.displayName}: ${(p.lastError || 'Session expired').split('\n')[0]}`).join(' • '))}${expiredProfiles.length > 2 ? ` (+${expiredProfiles.length - 2} more)` : ''}
              </p>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap ${isMany ? 'pt-2 border-t border-[var(--m3-outline-variant)]/40' : 'self-end md:self-center w-full md:w-auto justify-end pt-2 md:pt-0 border-t md:border-t-0 border-[var(--m3-outline-variant)]/40'}">
          ${inlineButtons.map(p => `
            <button
              type="button"
              onclick="handleTriggerLogin('${escapeHtml(p.id)}')"
              class="google-btn-primary px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 bg-[var(--google-red)] hover:bg-[var(--google-red)]/90 text-white shadow-sm cursor-pointer"
              title="Authenticate ${escapeHtml(p.displayName)} with Chrome"
            >
              <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
              <span>Relogin ${escapeHtml(p.displayName)}</span>
            </button>
          `).join('')}
          ${isMany ? `
            <button
              type="button"
              id="btn-manage-expired-accounts"
              class="google-btn-primary px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 bg-[var(--google-red)] hover:bg-[var(--google-red)]/90 text-white shadow-sm cursor-pointer"
              title="Review all ${expiredProfiles.length} accounts needing login"
            >
              <i data-lucide="users" class="w-3.5 h-3.5"></i>
              <span>Manage Expired (${expiredProfiles.length})</span>
            </button>
          ` : ''}
          <button
            type="button"
            onclick="handleSyncAll()"
            class="google-btn-outlined px-3 py-1.5 text-xs font-medium flex items-center gap-1 cursor-pointer"
            title="Re-test and sync all accounts"
          >
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span class="hidden sm:inline">Retry Sync</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const manageExpiredBtn = document.getElementById('btn-manage-expired-accounts');
  if (manageExpiredBtn) {
    manageExpiredBtn.addEventListener('click', () => {
      state.accountsModalFilter = 'needs_login';
      openModal('modal-accounts');
      renderAccountsModalList();
    });
  }

  if (window.lucide) lucide.createIcons({ root: container });
}

export function initAccountsModalControls() {
  const searchInput = document.getElementById('accounts-modal-search');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', (e) => {
      state.accountsModalSearch = e.target.value || '';
      renderAccountsModalList();
    });
  }
  const filtersContainer = document.getElementById('accounts-modal-filters');
  if (filtersContainer && !filtersContainer.dataset.bound) {
    filtersContainer.dataset.bound = '1';
    filtersContainer.querySelectorAll('.accounts-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.accountsModalFilter = btn.getAttribute('data-accounts-filter') || 'all';
        renderAccountsModalList();
      });
    });
  }
}

export function updateAccountsModalToolbar() {
  const searchInput = document.getElementById('accounts-modal-search');
  if (searchInput && searchInput.value !== state.accountsModalSearch) {
    searchInput.value = state.accountsModalSearch;
  }

  const counts = {
    all: state.profiles.length,
    connected: state.profiles.filter(p => p.status === 'connected').length,
    pro: state.profiles.filter(p => p.isDefaultPro || p.tier === 'pro').length,
    needs_login: state.profiles.filter(p => p.status !== 'connected').length,
  };

  const filtersContainer = document.getElementById('accounts-modal-filters');
  if (!filtersContainer) return;
  filtersContainer.querySelectorAll('.accounts-filter-btn').forEach(btn => {
    const key = btn.getAttribute('data-accounts-filter');
    const countSpan = btn.querySelector(`[data-filter-count="${key}"]`);
    if (countSpan && key in counts) {
      countSpan.textContent = counts[key];
    }
    const isActive = state.accountsModalFilter === key;
    btn.className = `accounts-filter-btn px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition ${
      isActive
        ? 'bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)]'
        : 'm3-subcard text-[var(--m3-on-surface-variant)] hover:text-[var(--m3-on-surface)]'
    }`;
  });
}

export function renderAccountsModalList() {
  const container = document.getElementById('accounts-list');
  if (!container) return;
  initAccountsModalControls();
  updateAccountsModalToolbar();

  if (state.profiles.length === 0) {
    container.innerHTML = `
      <div class="p-4 rounded-2xl m3-subcard space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-full google-skeleton shrink-0"></div>
            <div class="h-3.5 w-32 rounded google-skeleton"></div>
          </div>
          <div class="h-6 w-16 rounded-full google-skeleton"></div>
        </div>
        <div class="h-2.5 w-48 rounded google-skeleton ml-7"></div>
      </div>
      <div class="p-4 rounded-2xl m3-subcard space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-full google-skeleton shrink-0"></div>
            <div class="h-3.5 w-28 rounded google-skeleton"></div>
          </div>
          <div class="h-6 w-16 rounded-full google-skeleton"></div>
        </div>
        <div class="h-2.5 w-40 rounded google-skeleton ml-7"></div>
      </div>
    `;
    return;
  }

  const renderProfileCard = (p) => {
    const isPro = p.isDefaultPro;
    const isEditing = state.editingProfileId === p.id;

    if (isEditing) {
      return `
        <div class="p-4 rounded-2xl m3-subcard border-2 border-[var(--google-blue)] bg-[var(--m3-surface-container-low)] space-y-3.5 shadow-md transition-all animate-m3-enter" data-edit-card="${escapeHtml(p.id)}">
          <div class="flex items-center justify-between pb-2.5 border-b border-[var(--m3-outline-variant)]">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-full bg-[var(--google-blue-container)] text-[var(--google-blue)]">
                <i data-lucide="user-cog" class="w-3.5 h-3.5"></i>
              </div>
              <div>
                <h4 class="text-xs font-semibold text-[var(--m3-on-surface)] flex items-center gap-1.5">
                  Edit Profile: <span class="text-[var(--google-blue)] font-medium">${escapeHtml(p.displayName)}</span>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[var(--m3-surface-container)] text-[var(--m3-on-surface-subtle)] border border-[var(--m3-outline-variant)]">${escapeHtml(p.id)}</span>
                </h4>
                <p class="text-[10px] text-[var(--m3-on-surface-subtle)]">Update display label, account email, tier, badge color, and default AI status</p>
              </div>
            </div>
            <button
              type="button"
              data-action="cancel-edit"
              class="btn-cancel-edit p-1.5 rounded-full text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] hover:bg-[var(--m3-surface-container-high)] transition cursor-pointer"
              title="Cancel editing"
            >
              <i data-lucide="x" class="w-4 h-4 pointer-events-none"></i>
            </button>
          </div>

          <form class="form-edit-profile space-y-3" data-profile-id="${escapeHtml(p.id)}">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1">
                  Display Label <span class="text-[var(--google-red)]">*</span>
                </label>
                <input
                  type="text"
                  name="displayName"
                  value="${escapeHtml(p.displayName)}"
                  required
                  placeholder="e.g. Personal, Work, College"
                  class="w-full px-3.5 py-2 bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] rounded-xl text-xs text-[var(--m3-on-surface)] placeholder-[var(--m3-on-surface-subtle)] focus:outline-none focus:border-[var(--google-blue)] focus:ring-1 focus:ring-[var(--google-blue)] transition"
                >
              </div>
              <div>
                <label class="block text-[11px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1">
                  Google Account Email
                </label>
                <input
                  type="email"
                  name="email"
                  value="${escapeHtml(p.email || '')}"
                  placeholder="e.g. user@gmail.com"
                  class="w-full px-3.5 py-2 bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] rounded-xl text-xs font-mono text-[var(--m3-on-surface)] placeholder-[var(--m3-on-surface-subtle)] focus:outline-none focus:border-[var(--google-blue)] focus:ring-1 focus:ring-[var(--google-blue)] transition"
                >
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-[11px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1">
                  Profile Key (Slug) <span class="text-[var(--google-red)]">*</span>
                </label>
                <input
                  type="text"
                  name="newId"
                  value="${escapeHtml(p.id)}"
                  required
                  pattern="^[a-zA-Z0-9_\\-]+$"
                  title="Alphanumeric characters, dashes, or underscores only"
                  class="w-full px-3.5 py-2 bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] rounded-xl text-xs font-mono text-[var(--m3-on-surface)] placeholder-[var(--m3-on-surface-subtle)] focus:outline-none focus:border-[var(--google-blue)] focus:ring-1 focus:ring-[var(--google-blue)] transition"
                >
              </div>
              <div>
                <label class="block text-[11px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1">
                  Account Tier
                </label>
                <select
                  name="tier"
                  class="select-edit-tier w-full px-3.5 py-2 bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] rounded-xl text-xs text-[var(--m3-on-surface)] focus:outline-none focus:border-[var(--google-blue)] focus:ring-1 focus:ring-[var(--google-blue)] transition cursor-pointer"
                >
                  <option value="standard" ${p.tier === 'standard' ? 'selected' : ''}>Standard Account</option>
                  <option value="pro" ${p.tier === 'pro' ? 'selected' : ''}>Pro AI Account</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1">
                  Badge Color
                </label>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    name="color"
                    value="${p.color || '#8ab4f8'}"
                    class="input-edit-color w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
                  >
                  <span class="edit-color-hex text-xs font-mono text-[var(--m3-on-surface-variant)]">${p.color || '#8ab4f8'}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 pt-0.5">
              <span class="text-[10px] text-[var(--m3-on-surface-subtle)] uppercase tracking-wider">Presets:</span>
              <div class="flex items-center gap-1.5">
                ${PROFILE_COLOR_PRESETS.map(c => `
                  <button
                    type="button"
                    data-color="${c}"
                    style="background-color: ${c};"
                    class="btn-color-preset w-4 h-4 rounded-full border border-black/20 hover:scale-125 transition-transform cursor-pointer"
                    title="${c}"
                  ></button>
                `).join('')}
              </div>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="check-pro-${escapeHtml(p.id)}"
                name="isDefaultPro"
                ${p.isDefaultPro ? 'checked' : ''}
                class="check-edit-pro rounded bg-[var(--m3-surface-container)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer"
              >
              <label for="check-pro-${escapeHtml(p.id)}" class="text-xs text-[var(--m3-on-surface-variant)] cursor-pointer select-none flex items-center gap-1.5">
                <i data-lucide="sparkles" class="w-3.5 h-3.5 text-[var(--google-yellow)]"></i>
                <span>Set as Default Pro Engine (Primary AI query synthesizer)</span>
              </label>
            </div>
            <div class="flex items-center gap-2 pt-0.5">
              <input type="checkbox" id="edit-receive-auto-share-${escapeHtml(p.id)}" name="receiveAutoShare" ${p.receiveAutoShare !== false ? 'checked' : ''} class="rounded bg-[var(--m3-surface-container)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0">
              <label for="edit-receive-auto-share-${escapeHtml(p.id)}" class="text-xs text-[var(--m3-on-surface-variant)] cursor-pointer select-none">
                <span>Auto-receive study &amp; course notebooks (manual sharing still works)</span>
              </label>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--m3-outline-variant)]">
              <button
                type="button"
                data-action="cancel-edit"
                class="btn-cancel-edit google-btn-outlined px-3.5 py-1.5 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn-save-edit google-btn-primary px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <i data-lucide="check" class="w-3.5 h-3.5 pointer-events-none"></i>
                <span>Save Changes</span>
              </button>
            </div>
          </form>
        </div>
      `;
    }

    const isExpired = p.status === 'expired';
    const isNotLoggedIn = p.status === 'not_logged_in';
    const isChecking = p.status === 'checking';

    return `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl m3-subcard transition-all gap-3 ${
        isExpired ? 'border-2 border-[var(--google-red)]/50 bg-[var(--google-red-container)]/10 shadow-sm' : 'hover:border-[var(--m3-outline)]'
      }">
        <div class="flex items-start sm:items-center gap-3 min-w-0">
          ${isExpired ? `
            <span class="w-3.5 h-3.5 rounded-full shrink-0 bg-[var(--google-red)] pulse-dot-red mt-1 sm:mt-0"></span>
          ` : `
            <span class="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm mt-1 sm:mt-0" style="background-color: ${p.color};"></span>
          `}
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-semibold text-[var(--m3-on-surface)] tracking-normal ${isExpired ? 'text-[var(--google-red)] font-bold' : ''}">${escapeHtml(p.displayName)}</span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--m3-surface-container)] text-[var(--m3-on-surface-subtle)] border border-[var(--m3-outline-variant)]">${escapeHtml(p.id)}</span>
              ${isExpired ? `
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--google-red-container)] text-[var(--google-red)] border border-[var(--google-red)]/30 flex items-center gap-1">
                  <i data-lucide="alert-triangle" class="w-2.5 h-2.5"></i> AUTH EXPIRED
                </span>
              ` : (isChecking ? `
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--google-blue-container)]/60 text-[var(--google-blue)] border border-[var(--google-blue)]/30 flex items-center gap-1">
                  <i data-lucide="loader-2" class="w-2.5 h-2.5 animate-spin"></i> SIGNING IN
                </span>
              ` : (isNotLoggedIn ? `
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-subtle)] border border-[var(--m3-outline-variant)] flex items-center gap-1">
                  NOT LOGGED IN
                </span>
              ` : ''))}
              ${isPro ? `
                <span class="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--google-yellow-container)]/50 text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 flex items-center gap-1">
                  <i data-lucide="sparkles" class="w-2.5 h-2.5"></i> DEFAULT PRO
                </span>
              ` : (p.tier === 'pro' ? `
                <span class="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--google-blue-container)]/50 text-[var(--google-blue)] border border-[var(--google-blue)]/30 flex items-center gap-1">
                  PRO
                </span>
              ` : '')}
              ${p.receiveAutoShare === false ? `
                <span class="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-subtle)] border border-[var(--m3-outline-variant)]">
                  NO AUTO-SHARE
                </span>
              ` : ''}
            </div>
            <p class="text-[11px] text-[var(--m3-on-surface-subtle)] font-mono mt-0.5 truncate">${escapeHtml(p.email || 'No email reported yet')}</p>
            ${isExpired && p.lastError ? `
              <p class="text-[10px] text-[var(--google-red)] font-mono mt-1 bg-[var(--m3-surface-container)] px-2 py-0.5 rounded border border-[var(--google-red)]/20 truncate max-w-sm" title="${escapeHtml(p.lastError)}">
                ${escapeHtml(p.lastError)}
              </p>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button
            type="button"
            data-action="edit"
            data-profile-id="${escapeHtml(p.id)}"
            title="Edit profile details"
            class="btn-account-edit google-btn-outlined px-2.5 py-1 text-xs font-medium cursor-pointer text-[var(--m3-on-surface)] hover:border-[var(--google-blue)] hover:text-[var(--google-blue)] flex items-center gap-1"
          >
            <i data-lucide="pencil" class="w-3 h-3 pointer-events-none"></i>
            <span class="pointer-events-none">Edit</span>
          </button>

          <button
            type="button"
            data-action="login"
            data-profile-id="${escapeHtml(p.id)}"
            title="Authenticate with Google Chrome (reuses existing browser profile)"
            class="btn-account-login ${
              isExpired
                ? 'google-btn-primary bg-[var(--google-red)] hover:bg-[var(--google-red)]/90 text-white shadow-sm'
                : 'google-btn-outlined'
            } px-2.5 py-1 text-xs font-medium cursor-pointer flex items-center gap-1"
          >
            <i data-lucide="log-in" class="w-3.5 h-3.5 inline pointer-events-none ${isExpired ? 'text-white' : 'text-[var(--m3-on-surface-subtle)]'}"></i>
            <span class="pointer-events-none">${isExpired ? 'Re-login' : 'Login'}</span>
          </button>

          <button
            type="button"
            data-action="fresh-login"
            data-profile-id="${escapeHtml(p.id)}"
            title="Clear Chrome profile data and sign in with a different Google account"
            class="btn-account-fresh-login google-btn-outlined px-2 py-1 text-xs font-medium cursor-pointer text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] flex items-center gap-1"
          >
            <i data-lucide="user-round-cog" class="w-3.5 h-3.5 inline pointer-events-none"></i>
            <span class="pointer-events-none">Switch</span>
          </button>

          ${!isPro ? `
            <button
              type="button"
              data-action="set-pro"
              data-profile-id="${escapeHtml(p.id)}"
              title="Set this account as the primary Pro AI synthesis engine"
              class="btn-account-set-pro google-btn-tonal px-2.5 py-1 text-xs text-[var(--google-yellow)] bg-[var(--google-yellow-container)]/40 hover:bg-[var(--google-yellow-container)]/70 border border-[var(--google-yellow)]/30 cursor-pointer"
            >
              Make Pro
            </button>
          ` : ''}

          <button
            type="button"
            data-action="delete"
            data-profile-id="${escapeHtml(p.id)}"
            title="Delete account profile"
            class="btn-account-delete p-1.5 rounded-full text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-red)] hover:bg-[var(--google-red-container)]/30 transition cursor-pointer"
          >
            <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
          </button>
        </div>
      </div>
    `;
  };

  const query = (state.accountsModalSearch || '').trim().toLowerCase();
  const filteredProfiles = state.profiles.filter(p => {
    if (state.accountsModalFilter === 'connected' && p.status !== 'connected') return false;
    if (state.accountsModalFilter === 'pro' && !(p.isDefaultPro || p.tier === 'pro')) return false;
    if (state.accountsModalFilter === 'needs_login' && p.status === 'connected') return false;
    if (query) {
      const hay = `${p.displayName || ''} ${p.email || ''} ${p.id || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (filteredProfiles.length === 0) {
    container.innerHTML = `
      <div class="p-6 rounded-2xl m3-subcard text-center space-y-1.5">
        <p class="text-xs font-medium text-[var(--m3-on-surface)]">No matching accounts</p>
        <p class="text-[11px] text-[var(--m3-on-surface-subtle)]">Adjust your search or filter selection to view other profiles.</p>
      </div>
    `;
    return;
  }

  const { proProfiles, standardProfiles } = partitionProfilesByTier(filteredProfiles);
  const sections = [];
  if (proProfiles.length > 0) {
    sections.push(`
      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
          <div class="flex items-center gap-1.5">
            <i data-lucide="sparkles" class="w-3.5 h-3.5 text-[var(--google-yellow)]"></i>
            <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--google-yellow)]">AI Pro · Family Plan</span>
            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full m3-subcard text-[var(--m3-on-surface-subtle)]">${proProfiles.length}</span>
          </div>
          <span class="text-[10px] text-[var(--m3-on-surface-subtle)]">Higher Power Access · 300 sources/notebook · Independent Pro quota per account</span>
        </div>
        <div class="space-y-2.5">${proProfiles.map(renderProfileCard).join('')}</div>
      </div>
    `);
  }
  if (standardProfiles.length > 0) {
    sections.push(`
      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 border-t border-[var(--m3-outline-variant)]">
          <div class="flex items-center gap-1.5">
            <i data-lucide="user" class="w-3.5 h-3.5 text-[var(--m3-on-surface-subtle)]"></i>
            <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--m3-on-surface-variant)]">Standard Accounts</span>
            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full m3-subcard text-[var(--m3-on-surface-subtle)]">${standardProfiles.length}</span>
          </div>
          <span class="text-[10px] text-[var(--m3-on-surface-subtle)]">50 sources/notebook · Independent standard quota per account</span>
        </div>
        <div class="space-y-2.5">${standardProfiles.map(renderProfileCard).join('')}</div>
      </div>
    `);
  }
  container.innerHTML = sections.join('');

  container.querySelectorAll('.btn-account-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingProfileId = btn.getAttribute('data-profile-id');
      renderAccountsModalList();
    });
  });
  container.querySelectorAll('.btn-cancel-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingProfileId = null;
      renderAccountsModalList();
    });
  });
  container.querySelectorAll('.input-edit-color').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const hex = inp.closest('form')?.querySelector('.edit-color-hex');
      if (hex) hex.textContent = e.target.value;
    });
  });
  container.querySelectorAll('.btn-color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = btn.closest('form');
      if (!form) return;
      const colorVal = btn.getAttribute('data-color');
      const colorInput = form.querySelector('.input-edit-color');
      const hexLabel = form.querySelector('.edit-color-hex');
      if (colorInput) colorInput.value = colorVal;
      if (hexLabel) hexLabel.textContent = colorVal;
    });
  });
  container.querySelectorAll('.select-edit-tier').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const form = sel.closest('form');
      const proCheck = form ? form.querySelector('.check-edit-pro') : null;
      if (e.target.value === 'standard' && proCheck) {
        proCheck.checked = false;
      } else if (e.target.value === 'pro' && proCheck && !proCheck.checked) {
        proCheck.checked = true;
      }
    });
  });
  container.querySelectorAll('.check-edit-pro').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const form = chk.closest('form');
      const tierSel = form ? form.querySelector('.select-edit-tier') : null;
      if (e.target.checked && tierSel) {
        tierSel.value = 'pro';
      }
    });
  });
  container.querySelectorAll('.form-edit-profile').forEach(form => {
    form.addEventListener('submit', handleEditProfileSubmit);
  });
  container.querySelectorAll('.btn-account-login').forEach(btn => {
    btn.addEventListener('click', () => handleTriggerLogin(btn.getAttribute('data-profile-id'), false));
  });
  container.querySelectorAll('.btn-account-fresh-login').forEach(btn => {
    btn.addEventListener('click', () => handleTriggerLogin(btn.getAttribute('data-profile-id'), true));
  });
  container.querySelectorAll('.btn-account-set-pro').forEach(btn => {
    btn.addEventListener('click', () => handleSetPro(btn.getAttribute('data-profile-id')));
  });
  container.querySelectorAll('.btn-account-delete').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteAccount(btn.getAttribute('data-profile-id')));
  });

  if (window.lucide) lucide.createIcons();
}

export async function handleEditProfileSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const oldProfileId = form.getAttribute('data-profile-id');
  const displayName = form.querySelector('input[name="displayName"]').value.trim();
  const email = form.querySelector('input[name="email"]').value.trim();
  const newId = form.querySelector('input[name="newId"]').value.trim();
  const tier = form.querySelector('select[name="tier"]').value;
  const color = form.querySelector('input[name="color"]').value;
  const isDefaultPro = form.querySelector('input[name="isDefaultPro"]').checked;
  const receiveAutoShareEl = form.querySelector('input[name="receiveAutoShare"]');
  const receiveAutoShare = receiveAutoShareEl ? receiveAutoShareEl.checked : true;

  if (!displayName) {
    showToast('Display Label is required', 'error');
    return;
  }
  if (!newId) {
    showToast('Profile Key is required', 'error');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  const originalHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin pointer-events-none"></i><span>Saving...</span>';
    if (window.lucide) lucide.createIcons({ root: submitBtn });
  }
  setGlobalLoading(true);

  try {
    const res = await apiFetch(`/api/profiles/${encodeURIComponent(oldProfileId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newId: newId !== oldProfileId ? newId : undefined,
        displayName,
        email,
        tier,
        color,
        isDefaultPro,
        receiveAutoShare,
      }),
    });

    if (res.ok) {
      const updated = await res.json();
      state.editingProfileId = null;
      if (state.activeProfileFilter === oldProfileId) {
        state.activeProfileFilter = updated.id;
      }
      await loadProfiles();
      await loadNotebooks();
      renderAccountsModalList();
      renderAccountPills();
      renderNotebooksGrid();
      showToast(`Profile '${displayName}' updated successfully`, 'success');
    } else {
      const err = await res.json();
      showToast('Failed to update profile: ' + (err.detail || 'Server error'), 'error');
    }
  } catch (err) {
    showToast('Error updating profile: ' + err.message, 'error');
  } finally {
    setGlobalLoading(false);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons({ root: submitBtn });
    }
  }
}

export async function handleAddAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-account-id').value.trim();
  const name = document.getElementById('input-account-name').value.trim();
  const tier = document.getElementById('select-account-tier').value;
  const color = document.getElementById('input-account-color').value;
  const launchLogin = document.getElementById('check-launch-login').checked;
  const receiveAutoShareEl = document.getElementById('check-receive-auto-share');
  const receiveAutoShare = receiveAutoShareEl ? receiveAutoShareEl.checked : true;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalSubmitHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Connecting Account...</span>';
    if (window.lucide) lucide.createIcons({ root: submitBtn });
  }
  setGlobalLoading(true);

  try {
    const res = await apiFetch(`/api/profiles?launch_login=${launchLogin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        displayName: name,
        tier,
        color,
        isDefaultPro: tier === 'pro' && state.profiles.length === 0,
        receiveAutoShare,
      }),
    });

    if (res.ok) {
      const createdProfile = await res.json();
      document.getElementById('form-add-account').reset();
      await loadProfiles();
      renderAccountsModalList();
      showToast(`Account profile '${name}' added. ${launchLogin ? 'Opening sign-in window...' : ''}`, 'success');
      if (launchLogin && createdProfile && createdProfile.id) {
        pollProfileAuthCompletion(createdProfile.id);
      }
    } else {
      const err = await res.json();
      showToast('Failed: ' + (err.detail || 'Could not add account'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    setGlobalLoading(false);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalSubmitHtml;
      if (window.lucide) lucide.createIcons({ root: submitBtn });
    }
  }
}

const _activeAuthPollers = new Set();
let _reconcileInFlight = false;
let _lastReconcileAt = 0;

export async function applyPostLoginRefresh(profileId, { notify = true } = {}) {
  try {
    await apiFetch(`/api/profiles/${encodeURIComponent(profileId)}/sync`, { method: 'POST' });
  } catch (syncErr) {
    console.warn(`Post-login sync failed for '${profileId}':`, syncErr);
  }
  await Promise.all([loadProfiles(), loadNotebooks()]);
  renderAccountsModalList();
  renderAccountPills();
  renderCategoryChips();
  renderNotebooksGrid();
  renderAuthAlertBanner();
  accountHooks.loadFleetUsage(true);
  if (notify) {
    showToast(`Account '${profileId}' signed in and synced!`, 'success');
  }
}

export async function reconcileProfilesOnFocus(force = false) {
  if (_reconcileInFlight) return;
  const hasPending = state.profiles.some(p => ['checking', 'expired', 'not_logged_in'].includes(p.status));
  const cooldownMs = hasPending ? 1500 : 15000;
  const now = Date.now();
  if (!force && (now - _lastReconcileAt) < cooldownMs) return;

  _reconcileInFlight = true;
  _lastReconcileAt = now;
  try {
    const res = await apiFetch('/api/profiles/reconcile', { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.changed || (data.newly_connected && data.newly_connected.length > 0)) {
      await Promise.all([loadProfiles(), loadNotebooks()]);
      renderAccountsModalList();
      renderAccountPills();
      renderCategoryChips();
      renderNotebooksGrid();
      renderAuthAlertBanner();
      accountHooks.loadFleetUsage(true);
      if (data.newly_connected && data.newly_connected.length > 0) {
        showToast(`New login detected for ${data.newly_connected.join(', ')} — notebooks synced!`, 'success');
      }
    }
  } catch (_) {
    // Ignore transient errors during background focus reconciliation
  } finally {
    _reconcileInFlight = false;
  }
}

export function initLoginReconcileListeners() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reconcileProfilesOnFocus();
    }
  });
  window.addEventListener('focus', () => {
    reconcileProfilesOnFocus();
  });
}

export function pollProfileAuthCompletion(profileId, maxAttempts = 100, intervalMs = 3000) {
  if (_activeAuthPollers.has(profileId)) return;
  _activeAuthPollers.add(profileId);

  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    if (state.profiles.length > 0 && !state.profiles.some(p => p.id === profileId)) {
      clearInterval(timer);
      _activeAuthPollers.delete(profileId);
      return;
    }
    try {
      const res = await apiFetch(`/api/profiles/${encodeURIComponent(profileId)}/check-auth`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.is_valid) {
          clearInterval(timer);
          _activeAuthPollers.delete(profileId);
          await applyPostLoginRefresh(profileId, { notify: true });
          return;
        }
      } else if (res.status === 404) {
        clearInterval(timer);
        _activeAuthPollers.delete(profileId);
        return;
      }
    } catch (_) {
      // Ignore transient errors while user completes browser login
    }
    if (attempts >= maxAttempts) {
      clearInterval(timer);
      _activeAuthPollers.delete(profileId);
    }
  }, intervalMs);
}

export async function handleTriggerLogin(profileId, clear = false) {
  const btn = document.querySelector(`.btn-account-login[data-profile-id="${profileId}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin pointer-events-none"></i><span class="pointer-events-none">Launching...</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }
  setGlobalLoading(true);

  try {
    const res = await apiFetch(`/api/profiles/${encodeURIComponent(profileId)}/login?clear=${clear ? 'true' : 'false'}`, { method: 'POST' });
    if (res.ok) {
      await loadProfiles();
      renderAccountsModalList();
      showToast(`Sign-in window launched for '${profileId}'`, 'info');
      pollProfileAuthCompletion(profileId);
    }
  } catch (err) {
    showToast('Failed to launch login: ' + err.message, 'error');
  } finally {
    setGlobalLoading(false);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  }
}

export async function handleSetPro(profileId) {
  const btn = document.querySelector(`.btn-account-set-pro[data-profile-id="${profileId}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin pointer-events-none"></i><span class="pointer-events-none">Setting Pro...</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }
  setGlobalLoading(true);

  try {
    const res = await apiFetch(`/api/profiles/${profileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefaultPro: true, tier: 'pro' }),
    });
    if (res.ok) {
      await loadProfiles();
      renderAccountsModalList();
      renderAccountPills();
      renderNotebooksGrid();
      showToast(`Profile '${profileId}' is now the primary Pro AI engine`, 'success');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    setGlobalLoading(false);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  }
}

export async function handleDeleteAccount(profileId) {
  if (!confirm(`Are you sure you want to remove profile '${profileId}'? This will unshare fleet notebooks from this account and remove its cached data.`)) return;
  try {
    const res = await apiFetch(`/api/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const summary = data.unshareSummary || {};
      await loadProfiles();
      await loadNotebooks();
      renderAccountsModalList();
      if (summary.failed > 0) {
        showToast(
          `Profile '${profileId}' removed (unshared ${summary.unshared || 0}, failed ${summary.failed})`,
          'warn'
        );
      } else if (summary.unshared > 0) {
        showToast(
          `Profile '${profileId}' removed and unshared from ${summary.unshared} notebook(s)`,
          'info'
        );
      } else {
        showToast(`Profile '${profileId}' removed`, 'info');
      }
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}
