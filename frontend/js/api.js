// Network layer, remote auth key management, progress indicators, and core data loaders.
import { state } from './state.js';
import { closeModal, openModal, showToast } from './ui.js';

const REMOTE_API_KEY_STORAGE_KEY = 'super_nlm_api_key';
let activeLoadingOperations = 0;

let uiHooks = {
  renderAuthAlertBanner: () => {},
  renderAccountPills: () => {},
  renderCategoryChips: () => {},
  renderNotebooksGrid: () => {},
};

export function registerApiRenderHooks(hooks) {
  uiHooks = { ...uiHooks, ...hooks };
}

export function setGlobalLoading(isLoading, _label = '') {
  if (isLoading) {
    activeLoadingOperations++;
  } else {
    activeLoadingOperations = Math.max(0, activeLoadingOperations - 1);
  }

  const progressBar = document.getElementById('global-progress-bar');
  if (progressBar) {
    if (activeLoadingOperations > 0) {
      progressBar.classList.remove('hidden');
    } else {
      progressBar.classList.add('hidden');
    }
  }
}

export function setSyncStatus(isSyncing, message = '', submessage = '') {
  const indicator = document.getElementById('sync-status-indicator');
  const textEl = document.getElementById('sync-status-text');
  const subtextEl = document.getElementById('sync-status-subtext');
  if (!indicator) return;

  if (isSyncing) {
    if (textEl && message) textEl.textContent = message;
    if (subtextEl && submessage) subtextEl.textContent = submessage;
    indicator.classList.remove('hidden');
    indicator.classList.add('flex');
  } else {
    indicator.classList.add('hidden');
    indicator.classList.remove('flex');
  }
}

export function showSkeletons(show) {
  const skeletonGrid = document.getElementById('skeleton-grid');
  const notebooksGrid = document.getElementById('notebooks-grid');
  if (!skeletonGrid || !notebooksGrid) return;
  if (show) {
    skeletonGrid.classList.remove('hidden');
    skeletonGrid.classList.add('grid');
    notebooksGrid.classList.add('hidden');
  } else {
    skeletonGrid.classList.add('hidden');
    skeletonGrid.classList.remove('grid');
    notebooksGrid.classList.remove('hidden');
  }
}

export function getStoredApiKey() {
  try {
    return localStorage.getItem(REMOTE_API_KEY_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setStoredApiKey(value) {
  try {
    if (!value) {
      localStorage.removeItem(REMOTE_API_KEY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(REMOTE_API_KEY_STORAGE_KEY, value);
  } catch (_) {}
}

export function updateRemoteApiKeyBadge() {
  const btn = document.getElementById('btn-open-auth-key-modal');
  const status = document.getElementById('auth-key-status');
  const apiKey = getStoredApiKey();
  if (status) {
    status.textContent = apiKey ? 'Configured' : 'Not set';
    status.classList.toggle('bg-[var(--google-green-container)]', !!apiKey);
    status.classList.toggle('text-[var(--google-green)]', !!apiKey);
    status.classList.toggle('bg-[var(--m3-surface-container)]', !apiKey);
    status.classList.toggle('text-[var(--m3-on-surface-subtle)]', !apiKey);
  }
  if (btn) {
    btn.title = apiKey ? 'Remote access key is configured' : 'Set your remote access key';
  }
}

export async function apiFetch(url, options = {}) {
  const requestOptions = { ...options, headers: new Headers(options.headers || {}) };
  const apiKey = getStoredApiKey();
  if (apiKey) {
    requestOptions.headers.set('Authorization', `Bearer ${apiKey}`);
  }
  const response = await fetch(url, requestOptions);
  if (response.status === 401) {
    openRemoteAuthModal();
  }
  return response;
}

export function openRemoteAuthModal() {
  const modal = document.getElementById('auth-key-modal');
  const input = document.getElementById('auth-key-input');
  if (modal) {
    if (input) input.value = getStoredApiKey();
    openModal('auth-key-modal');
  }
}

export function closeRemoteAuthModal() {
  closeModal('auth-key-modal');
}

export async function handleRemoteAuthSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('auth-key-input');
  const key = input ? input.value.trim() : '';
  setStoredApiKey(key);
  updateRemoteApiKeyBadge();
  closeRemoteAuthModal();
  showToast(key ? 'Remote access key saved locally.' : 'Remote access key cleared.', key ? 'success' : 'info');
}

export async function loadProfiles() {
  setGlobalLoading(true);
  try {
    const res = await apiFetch('/api/profiles');
    if (res.ok) {
      state.profiles = await res.json();

      const accountsCount = document.getElementById('accounts-count');
      if (accountsCount) accountsCount.textContent = state.profiles.length;

      const telemetryProfiles = document.getElementById('telemetry-profiles');
      if (telemetryProfiles) telemetryProfiles.textContent = state.profiles.length;

      const proProfile = state.profiles.find(p => p.isDefaultPro);
      if (proProfile && proProfile.email) {
        const proLabel = document.getElementById('pro-email-label');
        if (proLabel) proLabel.textContent = proProfile.email;
        const sidebarProEmail = document.getElementById('sidebar-pro-email');
        if (sidebarProEmail) sidebarProEmail.textContent = proProfile.email;
        const crossEngineLabel = document.getElementById('cross-engine-label');
        if (crossEngineLabel) crossEngineLabel.textContent = `Pro AI Node: ${proProfile.email}`;
      }
      uiHooks.renderAuthAlertBanner();
      uiHooks.renderAccountPills();
    }
  } catch (err) {
    console.error('Failed to load profiles:', err);
  } finally {
    setGlobalLoading(false);
  }
}

export async function loadFolderMappings() {
  try {
    const res = await apiFetch('/api/folders/mappings');
    if (res.ok) {
      state.folderMappings = await res.json();
    }
  } catch (err) {
    console.warn('Failed to load folder mappings:', err);
  }
}

export async function loadNotebooks() {
  setGlobalLoading(true);
  try {
    const [nbRes] = await Promise.all([
      apiFetch('/api/notebooks'),
      loadFolderMappings(),
    ]);
    if (nbRes.ok) {
      state.notebooks = await nbRes.json();

      const telemetryNotebooks = document.getElementById('telemetry-notebooks');
      if (telemetryNotebooks) telemetryNotebooks.textContent = new Set(state.notebooks.map(n => n.id)).size;

      uiHooks.renderAuthAlertBanner();
      uiHooks.renderAccountPills();
      uiHooks.renderCategoryChips();
      uiHooks.renderNotebooksGrid();
    }
  } catch (err) {
    console.error('Failed to load notebooks:', err);
  } finally {
    setGlobalLoading(false);
  }
}

export async function handleSyncAll() {
  const syncBtn = document.getElementById('btn-sync');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<i data-lucide="refresh-cw" id="sync-icon" class="w-3.5 h-3.5 animate-spin"></i> <span class="hidden sm:inline">Syncing...</span>';
    if (window.lucide) lucide.createIcons({ root: syncBtn });
  }
  setGlobalLoading(true, 'Syncing notebooks across accounts...');
  setSyncStatus(true, 'Synchronizing notebooks across Google accounts...', 'Fetching manifests, source metadata, and authentication sessions');
  showSkeletons(true);

  try {
    const startTime = performance.now();
    const res = await apiFetch('/api/notebooks/sync', { method: 'POST' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errData.detail || `Server error (${res.status})`);
    }
    const synced = await res.json();
    state.notebooks = synced;
    await loadProfiles();

    const telemetryNotebooks = document.getElementById('telemetry-notebooks');
    if (telemetryNotebooks) telemetryNotebooks.textContent = new Set(state.notebooks.map(n => n.id)).size;

    uiHooks.renderAuthAlertBanner();
    uiHooks.renderAccountPills();
    uiHooks.renderCategoryChips();
    uiHooks.renderNotebooksGrid();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const expiredProfiles = state.profiles.filter(p => p.status === 'expired');
    if (expiredProfiles.length > 0) {
      const names = expiredProfiles.map(p => p.displayName || p.id).join(', ');
      showToast(`⚠️ Sync notice: Auth expired for ${names}. Re-login required.`, 'error', 8000);
    } else {
      showToast(`Synced ${synced.length} notebooks across ${state.profiles.length} accounts (${elapsed}s)`, 'success');
    }
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Sync error: ' + err.message, 'error');
  } finally {
    showSkeletons(false);
    setSyncStatus(false);
    setGlobalLoading(false);
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '<i data-lucide="refresh-cw" id="sync-icon" class="w-3.5 h-3.5"></i> <span class="hidden sm:inline">Sync All</span>';
      if (window.lucide) lucide.createIcons({ root: syncBtn });
    }
  }
}
