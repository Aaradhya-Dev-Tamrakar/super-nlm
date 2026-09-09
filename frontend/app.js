// Super-NLM Hub Studio Frontend Application Logic
// Calibrated under design-taste-frontend standards: Variance 8, Motion 6, Density 4

let state = {
  profiles: [],
  notebooks: [],
  activeProfileFilter: 'all',
  searchQuery: '',
  selectedNotebooks: new Map(), // key: notebookId, value: { notebookId, profileId, title }
  activeChat: null, // { notebookId, profileId, title }
  chatHistories: new Map(), // key: notebookId, value: array of message objects
  isLoading: false,
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  loadAllChatHistories();
  setupEventListeners();
  showSkeletons(true);
  await loadProfiles();
  await loadNotebooks();
  showSkeletons(false);
  if (window.lucide) lucide.createIcons();
});

// ----------------- THEME CONTROLLER (Google Light / Dark / System) -----------------
const THEME_STORAGE_KEY = 'supernlm_theme_mode';

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
  applyTheme(savedTheme, false);

  // Listen for OS system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const currentTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    if (currentTheme === 'system') {
      applyTheme('system', false);
    }
  });
}

function applyTheme(theme, save = true) {
  if (save) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  const htmlEl = document.documentElement;
  const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveDark = theme === 'dark' || (theme === 'system' && isSystemDark);

  if (effectiveDark) {
    htmlEl.classList.add('dark');
  } else {
    htmlEl.classList.remove('dark');
  }

  // Update theme trigger button icon
  const iconEl = document.getElementById('theme-active-icon');
  if (iconEl) {
    const iconName = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'laptop';
    iconEl.setAttribute('data-lucide', iconName);
  }

  // Update active state in theme dropdown menu
  document.querySelectorAll('.m3-menu-item[data-theme]').forEach(btn => {
    const btnTheme = btn.getAttribute('data-theme');
    const checkIcon = btn.querySelector('.theme-check-icon');
    if (btnTheme === theme) {
      btn.classList.add('active');
      if (checkIcon) checkIcon.classList.remove('hidden');
    } else {
      btn.classList.remove('active');
      if (checkIcon) checkIcon.classList.add('hidden');
    }
  });

  if (window.lucide) lucide.createIcons();
}

function setupEventListeners() {
  // Global search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderNotebooksGrid();
    });
  }

  // Ctrl+K keyboard shortcut
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // Sync All button
  const syncBtn = document.getElementById('btn-sync');
  if (syncBtn) syncBtn.addEventListener('click', handleSyncAll);

  // Empty state sync button
  const emptySyncBtn = document.getElementById('btn-empty-sync');
  if (emptySyncBtn) emptySyncBtn.addEventListener('click', handleSyncAll);

  // Sidebar add account button
  const sidebarAddBtn = document.getElementById('btn-sidebar-add-account');
  if (sidebarAddBtn) {
    sidebarAddBtn.addEventListener('click', () => {
      openModal('modal-accounts');
      renderAccountsModalList();
    });
  }

  // Manage Accounts Modal triggers
  const manageAccountsBtn = document.getElementById('btn-manage-accounts');
  if (manageAccountsBtn) {
    manageAccountsBtn.addEventListener('click', () => {
      openModal('modal-accounts');
      renderAccountsModalList();
    });
  }
  const closeAccountsBtn = document.getElementById('close-modal-accounts');
  if (closeAccountsBtn) closeAccountsBtn.addEventListener('click', () => closeModal('modal-accounts'));

  // Chat Modal close & actions
  const closeChatBtn = document.getElementById('close-modal-chat');
  if (closeChatBtn) closeChatBtn.addEventListener('click', () => closeModal('modal-chat'));
  const clearChatBtn = document.getElementById('btn-clear-chat');
  if (clearChatBtn) clearChatBtn.addEventListener('click', handleClearCurrentChat);
  const chatForm = document.getElementById('form-chat');
  if (chatForm) chatForm.addEventListener('submit', handleChatSubmit);

  // Cross Synthesis Modal
  const openCrossBtn = document.getElementById('btn-open-cross-modal');
  if (openCrossBtn) openCrossBtn.addEventListener('click', openCrossSynthesisModal);
  const closeCrossBtn = document.getElementById('close-modal-cross');
  if (closeCrossBtn) closeCrossBtn.addEventListener('click', () => closeModal('modal-cross'));
  const synthSelectedBtn = document.getElementById('btn-synthesize-selected');
  if (synthSelectedBtn) synthSelectedBtn.addEventListener('click', openCrossSynthesisModal);
  const clearSelectionBtn = document.getElementById('btn-clear-selection');
  if (clearSelectionBtn) clearSelectionBtn.addEventListener('click', clearSelection);
  const runCrossBtn = document.getElementById('btn-run-cross-synthesis');
  if (runCrossBtn) runCrossBtn.addEventListener('click', handleRunCrossSynthesis);

  // Add Account Form
  const addAccountForm = document.getElementById('form-add-account');
  if (addAccountForm) addAccountForm.addEventListener('submit', handleAddAccountSubmit);

  // Color picker sync
  const colorPicker = document.getElementById('input-account-color');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
      const hexLabel = document.getElementById('color-hex-label');
      if (hexLabel) hexLabel.textContent = e.target.value;
    });
  }

  // Theme Dropdown Toggle
  const themeToggleBtn = document.getElementById('btn-theme-toggle');
  const themeDropdown = document.getElementById('theme-dropdown');
  if (themeToggleBtn && themeDropdown) {
    themeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = themeDropdown.classList.contains('hidden');
      if (isHidden) {
        themeDropdown.classList.remove('hidden');
        themeToggleBtn.setAttribute('aria-expanded', 'true');
      } else {
        themeDropdown.classList.add('hidden');
        themeToggleBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('click', (e) => {
      if (!themeDropdown.contains(e.target) && e.target !== themeToggleBtn) {
        themeDropdown.classList.add('hidden');
        themeToggleBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Theme option clicks
    document.querySelectorAll('.m3-menu-item[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        applyTheme(theme, true);
        themeDropdown.classList.add('hidden');
        themeToggleBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Close modals on outside click
  ['modal-accounts', 'modal-chat', 'modal-cross'].forEach(id => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(id);
      });
    }
  });
}

function showSkeletons(show) {
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

// ----------------- API CALLS -----------------

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
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
      renderAccountPills();
    }
  } catch (err) {
    console.error('Failed to load profiles:', err);
  }
}

async function loadNotebooks() {
  try {
    const res = await fetch('/api/notebooks');
    if (res.ok) {
      state.notebooks = await res.json();
      
      const telemetryNotebooks = document.getElementById('telemetry-notebooks');
      if (telemetryNotebooks) telemetryNotebooks.textContent = state.notebooks.length;

      renderAccountPills();
      renderNotebooksGrid();
    }
  } catch (err) {
    console.error('Failed to load notebooks:', err);
  }
}

async function handleSyncAll() {
  const syncBtn = document.getElementById('btn-sync');
  const syncIcon = document.getElementById('sync-icon');
  if (syncBtn) syncBtn.disabled = true;
  if (syncIcon) syncIcon.classList.add('animate-spin');
  showSkeletons(true);

  try {
    const startTime = performance.now();
    const res = await fetch('/api/notebooks/sync', { method: 'POST' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errData.detail || `Server error (${res.status})`);
    }
    const synced = await res.json();
    state.notebooks = synced;
    await loadProfiles();
    
    const telemetryNotebooks = document.getElementById('telemetry-notebooks');
    if (telemetryNotebooks) telemetryNotebooks.textContent = state.notebooks.length;

    renderAccountPills();
    renderNotebooksGrid();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    showToast(`Synced ${synced.length} notebooks across ${state.profiles.length} accounts (${elapsed}s)`, 'success');
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Sync error: ' + err.message, 'error');
  } finally {
    showSkeletons(false);
    if (syncBtn) syncBtn.disabled = false;
    if (syncIcon) syncIcon.classList.remove('animate-spin');
  }
}

// ----------------- RENDERING -----------------

function renderAccountPills() {
  const container = document.getElementById('account-pills-container');
  if (!container) return;
  container.innerHTML = '';

  // "All Accounts" pill
  const totalCount = state.notebooks.length;
  const allPill = createPill({
    id: 'all',
    label: 'All Accounts',
    count: totalCount,
    isActive: state.activeProfileFilter === 'all',
    isPro: false
  });
  allPill.addEventListener('click', () => {
    state.activeProfileFilter = 'all';
    renderAccountPills();
    renderNotebooksGrid();
  });
  container.appendChild(allPill);

  // Individual Account Pills
  state.profiles.forEach(p => {
    const count = state.notebooks.filter(n => n.profileId === p.id).length;
    const pill = createPill({
      id: p.id,
      label: p.displayName || p.id,
      count: count,
      color: p.color,
      isActive: state.activeProfileFilter === p.id,
      isPro: p.isDefaultPro || p.tier === 'pro'
    });
    pill.addEventListener('click', () => {
      state.activeProfileFilter = p.id;
      renderAccountPills();
      renderNotebooksGrid();
    });
    container.appendChild(pill);
  });

  // Add Account shortcut button
  const addBtn = document.createElement('button');
  addBtn.className = 'google-btn-outlined flex items-center gap-1.5 px-3 py-1.5 text-xs transition whitespace-nowrap';
  addBtn.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5 text-[#8ab4f8]"></i> <span>Add Account</span>';
  addBtn.addEventListener('click', () => {
    openModal('modal-accounts');
    renderAccountsModalList();
  });
  container.appendChild(addBtn);

  if (window.lucide) lucide.createIcons();
}

function createPill({ id, label, count, color, isActive, isPro }) {
  const btn = document.createElement('button');
  const baseClasses = 'm3-chip flex items-center gap-2 px-3.5 py-1.5 text-xs transition whitespace-nowrap cursor-pointer';
  const activeClasses = isActive ? 'active' : 'hover:text-[var(--m3-on-surface)]';

  btn.className = `${baseClasses} ${activeClasses}`;
  
  let dotHtml = '';
  if (color) {
    dotHtml = `<span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color};"></span>`;
  }

  let badgeHtml = '';
  if (isPro) {
    badgeHtml = `<span class="text-[9px] font-medium px-1.5 py-0.2 rounded-full bg-[var(--google-yellow-container)] text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 flex items-center gap-1"><i data-lucide="sparkles" class="w-2.5 h-2.5 text-[var(--google-yellow)]"></i> PRO</span>`;
  }

  btn.innerHTML = `
    ${dotHtml}
    <span class="tracking-tight">${escapeHtml(label)}</span>
    ${badgeHtml}
    <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard text-[var(--m3-on-surface-subtle)] font-mono">${count}</span>
  `;
  return btn;
}

function renderNotebooksGrid() {
  const grid = document.getElementById('notebooks-grid');
  const emptyState = document.getElementById('empty-state');
  const visibleCountLabel = document.getElementById('visible-count');
  const filterLabel = document.getElementById('active-filter-label');

  if (!grid || !emptyState) return;

  // Filter notebooks
  let filtered = state.notebooks.filter(n => {
    const matchesAccount = state.activeProfileFilter === 'all' || n.profileId === state.activeProfileFilter;
    const matchesSearch = !state.searchQuery || 
      (n.title && n.title.toLowerCase().includes(state.searchQuery)) ||
      (n.profileName && n.profileName.toLowerCase().includes(state.searchQuery)) ||
      (n.profileEmail && n.profileEmail.toLowerCase().includes(state.searchQuery));
    return matchesAccount && matchesSearch;
  });

  if (visibleCountLabel) visibleCountLabel.textContent = filtered.length;
  if (filterLabel) {
    if (state.activeProfileFilter === 'all') {
      filterLabel.textContent = 'All Accounts';
    } else {
      const p = state.profiles.find(x => x.id === state.activeProfileFilter);
      filterLabel.textContent = p ? p.displayName : state.activeProfileFilter;
    }
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.classList.add('flex');
    return;
  }

  emptyState.classList.add('hidden');
  emptyState.classList.remove('flex');

  grid.innerHTML = filtered.map((notebook, idx) => {
    const isSelected = state.selectedNotebooks.has(notebook.id);
    const dateFormatted = notebook.updated_at ? new Date(notebook.updated_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : 'Recent';

    const isPro = notebook.tier === 'pro';

    return `
      <div 
        class="m3-card animate-m3-stagger p-5 flex flex-col justify-between group relative ${isSelected ? 'selected' : ''}"
        style="animation-delay: ${Math.min(idx * 20, 200)}ms;"
      >
        
        <!-- Top row: Selection Checkbox, Account Tag, Pro Tier Badge -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              data-id="${notebook.id}"
              data-profile="${notebook.profileId}"
              data-title="${escapeHtml(notebook.title)}"
              class="notebook-select-checkbox rounded bg-[var(--m3-surface)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer w-4 h-4 transition-transform active:scale-95"
              ${isSelected ? 'checked' : ''}
            >
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)]">
              <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${notebook.color}"></span>
              <span>${escapeHtml(notebook.profileName)}</span>
            </span>
          </div>

          ${isPro ? `
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-yellow-container)]/50 text-[var(--google-yellow)] border border-[var(--google-yellow)]/30">
              <i data-lucide="sparkles" class="w-3 h-3 text-[var(--google-yellow)]"></i> PRO AI
            </span>
          ` : `
            <span class="text-[10px] font-mono text-[var(--m3-on-surface-subtle)]">${escapeHtml(notebook.profileId)}</span>
          `}
        </div>

        <!-- Notebook Title & Meta -->
        <div class="mb-4 flex-1">
          <h3 class="text-[15px] font-medium text-[var(--m3-on-surface)] group-hover:text-[var(--google-blue)] transition-colors line-clamp-2 leading-snug tracking-normal">
            ${escapeHtml(notebook.title)}
          </h3>
          <div class="flex items-center gap-3 mt-2 text-xs text-[var(--m3-on-surface-subtle)]">
            <span class="flex items-center gap-1.5">
              <i data-lucide="file-text" class="w-3.5 h-3.5 text-[var(--m3-on-surface-subtle)]"></i>
              <span class="font-mono text-[var(--m3-on-surface)] font-medium">${notebook.source_count || 0}</span> sources
            </span>
            <span class="text-[var(--m3-outline-variant)]">•</span>
            <span class="flex items-center gap-1.5">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-[var(--m3-on-surface-subtle)]"></i>
              <span>${dateFormatted}</span>
            </span>
          </div>
        </div>

        <!-- Bottom Action Row -->
        <div class="flex items-center justify-between pt-3 border-t border-[var(--m3-outline-variant)] gap-2">
          <!-- Query Notebook Button -->
          <button
            onclick="openChatModal('${notebook.id}', '${notebook.profileId}', '${escapeHtml(notebook.title)}')"
            class="google-btn-tonal flex items-center gap-1.5 px-3.5 py-1.5 text-xs shadow-sm"
          >
            <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            <span>Query</span>
          </button>

          <!-- Deep Link to NotebookLM Web -->
          <a
            href="https://notebooklm.google.com/notebook/${notebook.id}"
            target="_blank"
            rel="noopener noreferrer"
            title="Open in official NotebookLM web interface"
            class="google-btn-outlined flex items-center gap-1.5 text-xs text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] py-1 px-2.5"
          >
            <span>Open Web</span>
            <i data-lucide="external-link" class="w-3 h-3 text-[var(--m3-on-surface-subtle)]"></i>
          </a>
        </div>

      </div>
    `;
  }).join('');

  // Wire up checkbox listeners
  grid.querySelectorAll('.notebook-select-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const profile = e.target.getAttribute('data-profile');
      const title = e.target.getAttribute('data-title');
      if (e.target.checked) {
        state.selectedNotebooks.set(id, { notebookId: id, profileId: profile, title: title });
      } else {
        state.selectedNotebooks.delete(id);
      }
      updateSelectionBanner();
    });
  });

  if (window.lucide) lucide.createIcons();
}

function updateSelectionBanner() {
  const banner = document.getElementById('selection-banner');
  if (!banner) return;
  const count = state.selectedNotebooks.size;
  if (count > 0) {
    banner.classList.remove('hidden');
    banner.classList.add('flex');
    const textEl = document.getElementById('selection-text');
    if (textEl) textEl.textContent = `${count} notebook${count > 1 ? 's' : ''} selected across accounts for cross-synthesis`;
  } else {
    banner.classList.add('hidden');
    banner.classList.remove('flex');
  }
}

function clearSelection() {
  state.selectedNotebooks.clear();
  updateSelectionBanner();
  renderNotebooksGrid();
}

// ----------------- ACCOUNTS MANAGER MODAL -----------------

function renderAccountsModalList() {
  const container = document.getElementById('accounts-list');
  if (!container) return;
  
  container.innerHTML = state.profiles.map(p => {
    const isPro = p.isDefaultPro;
    return `
      <div class="flex items-center justify-between p-3.5 rounded-2xl m3-subcard hover:border-[var(--m3-outline)] transition-all">
        <div class="flex items-center gap-3">
          <span class="w-3.5 h-3.5 rounded-full shrink-0" style="background-color: ${p.color};"></span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--m3-on-surface)] tracking-normal">${escapeHtml(p.displayName)}</span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--m3-surface-container)] text-[var(--m3-on-surface-subtle)] border border-[var(--m3-outline-variant)]">${p.id}</span>
              ${isPro ? `
                <span class="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--google-yellow-container)]/50 text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 flex items-center gap-1">
                  <i data-lucide="sparkles" class="w-2.5 h-2.5"></i> DEFAULT PRO
                </span>
              ` : ''}
            </div>
            <p class="text-[11px] text-[var(--m3-on-surface-subtle)] font-mono mt-0.5">${escapeHtml(p.email || 'No email reported yet')}</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Re-login button -->
          <button
            onclick="handleTriggerLogin('${p.id}')"
            title="Authenticate with Google Chrome"
            class="google-btn-outlined px-3 py-1 text-xs font-medium"
          >
            <i data-lucide="log-in" class="w-3.5 h-3.5 inline text-[var(--m3-on-surface-subtle)]"></i>
            <span>Login</span>
          </button>

          <!-- Toggle Pro button -->
          ${!isPro ? `
            <button
              onclick="handleSetPro('${p.id}')"
              title="Set this account as the primary Pro AI synthesis engine"
              class="google-btn-tonal px-3 py-1 text-xs text-[var(--google-yellow)] bg-[var(--google-yellow-container)]/40 hover:bg-[var(--google-yellow-container)]/70 border border-[var(--google-yellow)]/30"
            >
              Make Pro
            </button>
          ` : ''}

          <!-- Delete account button -->
          <button
            onclick="handleDeleteAccount('${p.id}')"
            title="Delete account profile"
            class="p-2 rounded-full text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-red)] hover:bg-[var(--google-red-container)]/30 transition"
          >
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

async function handleAddAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-account-id').value.trim();
  const name = document.getElementById('input-account-name').value.trim();
  const tier = document.getElementById('select-account-tier').value;
  const color = document.getElementById('input-account-color').value;
  const launchLogin = document.getElementById('check-launch-login').checked;

  try {
    const res = await fetch(`/api/profiles?launch_login=${launchLogin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        displayName: name,
        tier: tier,
        color: color,
        isDefaultPro: tier === 'pro' && state.profiles.length === 0
      })
    });

    if (res.ok) {
      document.getElementById('form-add-account').reset();
      await loadProfiles();
      renderAccountsModalList();
      showToast(`Account profile '${name}' added. ${launchLogin ? 'Opening sign-in window...' : ''}`, 'success');
    } else {
      const err = await res.json();
      showToast('Failed: ' + (err.detail || 'Could not add account'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function handleTriggerLogin(profileId) {
  try {
    const res = await fetch(`/api/profiles/${profileId}/login`, { method: 'POST' });
    if (res.ok) {
      showToast(`Sign-in window launched for '${profileId}'`, 'info');
    }
  } catch (err) {
    showToast('Failed to launch login: ' + err.message, 'error');
  }
}

async function handleSetPro(profileId) {
  try {
    const res = await fetch(`/api/profiles/${profileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefaultPro: true, tier: 'pro' })
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
  }
}

async function handleDeleteAccount(profileId) {
  if (!confirm(`Are you sure you want to remove profile '${profileId}' and its cached data?`)) return;
  try {
    const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadProfiles();
      await loadNotebooks();
      renderAccountsModalList();
      showToast(`Profile '${profileId}' removed`, 'info');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ----------------- CHAT STORAGE & MARKDOWN HELPERS -----------------

const CHAT_STORAGE_PREFIX = 'supernlm_chat_';

function loadAllChatHistories() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CHAT_STORAGE_PREFIX)) {
        const notebookId = key.substring(CHAT_STORAGE_PREFIX.length);
        const stored = localStorage.getItem(key);
        if (stored) {
          state.chatHistories.set(notebookId, JSON.parse(stored));
        }
      }
    }
  } catch (err) {
    console.warn('Could not read chat histories from localStorage:', err);
  }
}

function saveNotebookChatHistory(notebookId) {
  try {
    const history = state.chatHistories.get(notebookId) || [];
    localStorage.setItem(CHAT_STORAGE_PREFIX + notebookId, JSON.stringify(history));
  } catch (err) {
    console.warn(`Could not save chat history for ${notebookId}:`, err);
  }
}

function clearNotebookChatHistory(notebookId) {
  state.chatHistories.delete(notebookId);
  try {
    localStorage.removeItem(CHAT_STORAGE_PREFIX + notebookId);
  } catch (err) {
    console.warn(`Could not remove chat history for ${notebookId}:`, err);
  }
}

function renderMarkdown(text) {
  if (!text) return '';
  if (window.marked && window.DOMPurify) {
    try {
      const rawHtml = marked.parse(text, { breaks: true, gfm: true });
      return DOMPurify.sanitize(rawHtml);
    } catch (e) {
      console.warn('Markdown parsing error:', e);
    }
  }
  return escapeHtml(text);
}

function renderCitationsHtml(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return '';
  const chips = citations.map((cite, idx) => {
    let title = '';
    if (typeof cite === 'string') {
      title = cite;
    } else if (typeof cite === 'object' && cite !== null) {
      title = cite.title || cite.source_title || cite.text || `Source ${idx + 1}`;
    } else {
      title = `Source ${idx + 1}`;
    }
    return `
      <span class="citation-chip" title="${escapeHtml(title)}">
        <i data-lucide="file-text"></i>
        <span>[${idx + 1}] ${escapeHtml(title)}</span>
      </span>
    `;
  }).join('');

  return `
    <div class="citation-container">
      <div class="w-full text-[10px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1 flex items-center gap-1">
        <i data-lucide="bookmark" class="w-3 h-3 text-[var(--google-blue)]"></i>
        <span>Cited Sources (${citations.length})</span>
      </div>
      ${chips}
    </div>
  `;
}

function renderChatMessageBubble(msg) {
  if (msg.role === 'user') {
    return `
      <div class="flex justify-end animate-m3-enter">
        <div class="max-w-md p-3.5 rounded-2xl rounded-tr-sm bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)] text-xs leading-relaxed shadow-sm font-medium">
          ${escapeHtml(msg.content)}
        </div>
      </div>
    `;
  } else {
    const fallbackBadge = msg.handledByProFallback ? `
      <div class="mb-2.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-yellow-container)] text-[var(--google-yellow)] border border-[var(--google-yellow)]/30">
        <i data-lucide="sparkles" class="w-3 h-3 text-[var(--google-yellow)]"></i>
        <span>${escapeHtml(msg.fallbackReason || 'Handled via Pro AI Fallback')}</span>
      </div>
    ` : '';

    const formattedAnswer = renderMarkdown(msg.content);
    const citationsHtml = renderCitationsHtml(msg.citations);

    return `
      <div class="flex items-start gap-2.5 animate-m3-enter">
        <div class="w-8 h-8 rounded-full bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] flex items-center justify-center text-[var(--google-blue)] shadow-sm shrink-0">
          <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
        </div>
        <div class="flex-1 p-4 rounded-2xl rounded-tl-sm m3-subcard text-[var(--m3-on-surface)] text-xs leading-relaxed shadow-sm">
          ${fallbackBadge}
          <div class="nlm-markdown">${formattedAnswer}</div>
          ${citationsHtml}
        </div>
      </div>
    `;
  }
}

// ----------------- CHAT MODAL -----------------

window.openChatModal = function(notebookId, profileId, title) {
  state.activeChat = { notebookId, profileId, title };
  document.getElementById('chat-modal-title').textContent = title;
  document.getElementById('chat-modal-subtitle').textContent = `Account: ${profileId}`;
  
  const thread = document.getElementById('chat-thread');
  
  // Introductory system card
  const introCard = `
    <div class="p-4 rounded-2xl m3-subcard text-xs text-[var(--m3-on-surface-variant)] flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-[var(--google-blue)] shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong> via account <code class="px-1.5 py-0.5 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] font-mono">${profileId}</code>. Ask any question to its indexed sources below.</span>
    </div>
  `;

  // Restore existing history if present
  const history = state.chatHistories.get(notebookId) || [];
  if (history.length > 0) {
    const renderedMessages = history.map(msg => renderChatMessageBubble(msg)).join('');
    thread.innerHTML = introCard + renderedMessages;
  } else {
    thread.innerHTML = introCard;
  }

  openModal('modal-chat');
  if (window.lucide) lucide.createIcons();
  thread.scrollTop = thread.scrollHeight;
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.focus();
};

function handleClearCurrentChat() {
  if (!state.activeChat) return;
  const notebookId = state.activeChat.notebookId;
  const title = state.activeChat.title;
  const profileId = state.activeChat.profileId;

  clearNotebookChatHistory(notebookId);

  const thread = document.getElementById('chat-thread');
  thread.innerHTML = `
    <div class="p-4 rounded-2xl m3-subcard text-xs text-[var(--m3-on-surface-variant)] flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-[var(--google-blue)] shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong> via account <code class="px-1.5 py-0.5 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] font-mono">${profileId}</code>. Ask any question to its indexed sources below.</span>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  showToast('Chat history cleared for this notebook', 'info');
}

async function handleChatSubmit(e) {
  e.preventDefault();
  if (!state.activeChat) return;

  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  const thread = document.getElementById('chat-thread');
  const notebookId = state.activeChat.notebookId;

  // Retrieve or initialize history for this notebook
  let history = state.chatHistories.get(notebookId);
  if (!history) {
    history = [];
    state.chatHistories.set(notebookId, history);
  }

  // Push and render user prompt
  const userMsg = {
    role: 'user',
    content: question,
    timestamp: Date.now()
  };
  history.push(userMsg);
  saveNotebookChatHistory(notebookId);

  thread.innerHTML += renderChatMessageBubble(userMsg);

  // Append Google skeleton bubble
  const loaderId = 'loader-' + Date.now();
  thread.innerHTML += `
    <div id="${loaderId}" class="flex items-start gap-2.5 animate-m3-enter">
      <div class="w-8 h-8 rounded-full bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] flex items-center justify-center text-[var(--google-blue)] shadow-sm shrink-0">
        <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
      </div>
      <div class="flex-1 p-4 rounded-2xl m3-subcard space-y-2">
        <div class="flex items-center gap-2 text-xs text-[var(--m3-on-surface-subtle)]">
          <span class="w-2 h-2 rounded-full bg-[var(--google-blue)] animate-ping"></span>
          <span>Google AI is synthesizing sources...</span>
        </div>
        <div class="h-3 w-3/4 rounded-full google-skeleton"></div>
        <div class="h-3 w-1/2 rounded-full google-skeleton"></div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  thread.scrollTop = thread.scrollHeight;
  input.value = '';

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebookId: state.activeChat.notebookId,
        profileId: state.activeChat.profileId,
        question: question
      })
    });

    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();

    if (res.ok) {
      const data = await res.json();
      const answer = data.answer || 'No response returned.';
      
      const assistantMsg = {
        role: 'assistant',
        content: answer,
        citations: data.citations || [],
        handledByProFallback: !!data.handledByProFallback,
        fallbackReason: data.fallbackReason || '',
        timestamp: Date.now()
      };
      history.push(assistantMsg);
      saveNotebookChatHistory(notebookId);

      thread.innerHTML += renderChatMessageBubble(assistantMsg);
    } else {
      const err = await res.json();
      thread.innerHTML += `
        <div class="p-3.5 rounded-2xl bg-[var(--google-red-container)]/30 border border-[var(--google-red)]/30 text-[var(--google-red)] text-xs animate-m3-enter flex items-center gap-2">
          <i data-lucide="alert-circle" class="w-4 h-4 shrink-0"></i>
          <span>Query failed: ${escapeHtml(err.detail || 'Error running query')}</span>
        </div>
      `;
    }
  } catch (err) {
    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();
    thread.innerHTML += `
      <div class="p-3.5 rounded-2xl bg-[var(--google-red-container)]/30 border border-[var(--google-red)]/30 text-[var(--google-red)] text-xs animate-m3-enter flex items-center gap-2">
        <i data-lucide="wifi-off" class="w-4 h-4 shrink-0"></i>
        <span>Network Error: ${escapeHtml(err.message)}</span>
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();
  thread.scrollTop = thread.scrollHeight;
}

// ----------------- CROSS-ACCOUNT SYNTHESIS -----------------

function openCrossSynthesisModal() {
  const container = document.getElementById('cross-notebooks-chips');
  const selected = Array.from(state.selectedNotebooks.values());

  if (selected.length === 0) {
    showToast('Select at least 2 notebooks from different accounts first.', 'info');
    return;
  }

  container.innerHTML = selected.map(n => `
    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs m3-subcard shadow-sm">
      <span class="font-mono text-[var(--google-blue)] text-[10px] font-medium">${escapeHtml(n.profileId)}</span>
      <span class="text-[var(--m3-outline-variant)]">:</span>
      <strong class="font-medium tracking-normal text-[var(--m3-on-surface)]">${escapeHtml(n.title)}</strong>
    </span>
  `).join('');

  document.getElementById('cross-results-container').classList.add('hidden');
  document.getElementById('cross-results-body').textContent = '';
  openModal('modal-cross');
}

async function handleRunCrossSynthesis() {
  const prompt = document.getElementById('cross-prompt-input').value.trim();
  if (!prompt) {
    showToast('Please enter a synthesis prompt or research goal.', 'info');
    return;
  }

  const selected = Array.from(state.selectedNotebooks.values());
  const btn = document.getElementById('btn-run-cross-synthesis');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> <span>Synthesizing across accounts...</span>';
  if (window.lucide) lucide.createIcons();

  const resultsContainer = document.getElementById('cross-results-container');
  const resultsBody = document.getElementById('cross-results-body');

  try {
    const res = await fetch('/api/cross-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooks: selected,
        question: prompt
      })
    });

    if (res.ok) {
      const data = await res.json();
      const markdownContext = data.combinedContext || 'No synthesis produced.';
      resultsBody.innerHTML = `<div class="nlm-markdown">${renderMarkdown(markdownContext)}</div>`;
      resultsContainer.classList.remove('hidden');
      showToast('Cross-account synthesis completed successfully.', 'success');
    } else {
      const err = await res.json();
      showToast('Synthesis error: ' + (err.detail || 'Failed to synthesize'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span>Execute Multi-Account Synthesis</span>';
    if (window.lucide) lucide.createIcons();
  }
}

// ----------------- HELPERS -----------------

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-[var(--google-red-container)] border-[var(--google-red)]/40 text-[var(--google-red)]'
           : type === 'success' ? 'bg-[var(--google-green-container)] border-[var(--google-green)]/40 text-[var(--google-green)]'
           : 'bg-[var(--m3-surface-container-high)] border-[var(--m3-outline-variant)] text-[var(--m3-on-surface)]';
  const icon = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info';

  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full border text-xs font-medium shadow-2xl transition-all duration-200 transform translate-y-2 opacity-0 ${bg}`;
  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-3.5 h-3.5 shrink-0"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons({
      root: toast
    });
  }

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

