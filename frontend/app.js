// Super-NLM Hub Studio Frontend Application Logic
// Calibrated under design-taste-frontend standards: Variance 8, Motion 6, Density 4

let state = {
  profiles: [],
  notebooks: [],
  activeProfileFilter: 'all',
  activeCategoryFilter: 'all', // 'all' | 'study' | 'projects'
  searchQuery: '',
  selectedNotebooks: new Map(), // key: notebookId, value: { notebookId, profileId, title }
  activeChat: null, // { notebookId, profileId, title }
  chatHistories: new Map(), // key: notebookId, value: array of message objects
  conversationIds: new Map(), // key: notebookId, value: conversationId
  activeQueries: new Map(), // key: notebookId, value: { notebookId, profileId, title, question, startTime }
  isLoading: false,
};

// ----------------- COURSE & STUDY CLASSIFICATION -----------------
const COURSE_NOTEBOOK_IDS = new Set([
  '96a12a04-073e-43ca-9f6d-ca0048d63486', // CT653 - Artificial Intelligence
  'c627a211-552e-496b-9ebb-42d22ac05a95', // EX751 - Wireless Communications
  'bc8653c3-a1d3-42b7-bca1-cd8e4effc038', // CT704 - Digital Signal Analysis and Processing
  'c3c8ecd4-2884-42a1-aa49-c4de168c1ec7', // EX752 - RF and Microwave Engineering
  '94cd4e14-802d-4231-b27d-6a4f4a2e6182', // ME708 - Organization and Management
  '56cdad30-13d3-4621-a0b7-8f841858476b', // EX725 04 - Aeronautical Telecommunication
]);

const COURSE_CODE_REGEX = /^([A-Z]{2,4}\s*\d{3}(?:\s*\d{2})?)\s*[-:]\s*(.+)/i;

function isStudyNotebook(notebook) {
  if (!notebook) return false;
  if (notebook.is_study === true || notebook.category === 'study') return true;
  if (COURSE_NOTEBOOK_IDS.has(notebook.id)) return true;
  const title = (notebook.title || '').trim();
  return COURSE_CODE_REGEX.test(title);
}

function getCourseCode(notebook) {
  if (!notebook) return null;
  if (notebook.course_code) return notebook.course_code;
  const title = (notebook.title || '').trim();
  const match = title.match(COURSE_CODE_REGEX);
  if (match) return match[1].toUpperCase();
  if (COURSE_NOTEBOOK_IDS.has(notebook.id)) {
    return title.split('-')[0].trim().toUpperCase();
  }
  return null;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initGoogleRipple();
  loadAllChatHistories();
  setupEventListeners();
  renderAccountPills();
  renderCategoryChips();
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

function toggleThemeMode() {
  const isCurrentlyDark = document.documentElement.classList.contains('dark');
  const targetTheme = isCurrentlyDark ? 'light' : 'dark';
  applyTheme(targetTheme, true);
  showToast(`Switched to ${targetTheme === 'dark' ? 'Dark' : 'Light'} mode (shortcut: 0)`, 'info');
}

function setupEventListeners() {
  // Global search input & pill
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchPill = document.querySelector('.google-search-pill');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      if (searchClearBtn) {
        if (e.target.value.length > 0) {
          searchClearBtn.classList.remove('hidden');
        } else {
          searchClearBtn.classList.add('hidden');
        }
      }
      renderNotebooksGrid();
    });
  }

  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.value = '';
      state.searchQuery = '';
      searchClearBtn.classList.add('hidden');
      renderNotebooksGrid();
      searchInput.focus();
    });
  }

  if (searchPill && searchInput) {
    searchPill.addEventListener('click', (e) => {
      if (e.target !== searchClearBtn && !searchClearBtn?.contains(e.target)) {
        searchInput.focus();
      }
    });
  }

  // OS-aware shortcut key text (⌘ K on Apple devices, Ctrl K on others)
  const shortcutBadge = document.getElementById('search-shortcut-badge');
  if (shortcutBadge && typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)) {
    shortcutBadge.textContent = '⌘ K';
  }

  // Global Keyboard Shortcuts (Keymaps)
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    // 1. Modifier combinations (Ctrl / Meta)
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }
      return;
    }

    // Ignore when Alt is pressed
    if (e.altKey) return;

    // 2. Escape: Closes open modal / clears search input / clears selection
    if (e.key === 'Escape') {
      const openModalIds = ['modal-shortcuts', 'modal-chat', 'modal-accounts', 'modal-cross'];
      const openModalId = openModalIds.find(id => isModalOpen(id));
      if (openModalId) {
        closeModal(openModalId);
      } else if (searchInput && document.activeElement === searchInput) {
        searchInput.value = '';
        state.searchQuery = '';
        if (searchClearBtn) searchClearBtn.classList.add('hidden');
        renderNotebooksGrid();
        searchInput.blur();
      } else if (state.selectedNotebooks.size > 0) {
        clearSelection();
        showToast('Selection cleared', 'info');
      }
      return;
    }

    // 3. Single key shortcuts: paused while typing in form inputs / textareas
    if (isInputActive) return;

    // Shortcut '0': Toggle Dark / Light mode (works even when modals are open!)
    if (e.key === '0') {
      e.preventDefault();
      toggleThemeMode();
      return;
    }

    // Shortcut '?' or 'Shift+/': Toggle Keyboard Shortcuts modal
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      if (isModalOpen('modal-shortcuts')) {
        closeModal('modal-shortcuts');
      } else {
        openModal('modal-shortcuts');
      }
      return;
    }

    // If an interactive modal is open, don't trigger background navigation or actions
    const anyModalOpen = ['modal-chat', 'modal-accounts', 'modal-cross', 'modal-shortcuts'].some(id => isModalOpen(id));
    if (anyModalOpen) return;

    // Shortcut '/': Focus search input
    if (e.key === '/') {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // Shortcut 's' or 'r': Sync all notebooks
    if (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'r') {
      e.preventDefault();
      handleSyncAll();
      return;
    }

    // Shortcut 'a' (without Shift): Open Google Accounts Manager
    if (e.key.toLowerCase() === 'a' && !e.shiftKey) {
      e.preventDefault();
      openModal('modal-accounts');
      renderAccountsModalList();
      return;
    }

    // Shortcut 'Shift + A': Toggle Select All visible notebooks
    if (e.key === 'A' && e.shiftKey) {
      e.preventDefault();
      toggleSelectAllVisible();
      return;
    }

    // Shortcut 'x' or 'c': Cross-Account Synthesis
    if (e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'c') {
      e.preventDefault();
      openCrossSynthesisModal();
      return;
    }

    // Shortcut 'u' (without Shift/Ctrl): Toggle Study / Course NLMs filter
    if (e.key.toLowerCase() === 'u' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleStudyFilter();
      return;
    }

    // Shortcut '1' to '9': Profile / Account filter switching
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      if (e.key === '1') {
        state.activeProfileFilter = 'all';
        renderAccountPills();
        renderNotebooksGrid();
        showToast('Filter: All Accounts (shortcut: 1)', 'info');
      } else {
        const profileIndex = parseInt(e.key, 10) - 2;
        if (state.profiles && state.profiles[profileIndex]) {
          const profile = state.profiles[profileIndex];
          state.activeProfileFilter = profile.id;
          renderAccountPills();
          renderNotebooksGrid();
          showToast(`Filter: ${profile.displayName || profile.id} (shortcut: ${e.key})`, 'info');
        } else {
          showToast(`No account assigned to shortcut ${e.key}`, 'info');
        }
      }
      return;
    }
  });

  // Dismiss modals on backdrop click
  ['modal-shortcuts', 'modal-chat', 'modal-accounts', 'modal-cross'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) closeModal(id);
      });
    }
  });

  // Copy Synthesis Button
  const copySynthBtn = document.getElementById('btn-copy-synthesis');
  if (copySynthBtn) {
    copySynthBtn.addEventListener('click', () => {
      const bodyEl = document.getElementById('cross-results-body');
      if (!bodyEl) return;
      const rawMd = bodyEl.getAttribute('data-raw-markdown');
      const text = rawMd || bodyEl.innerText;
      if (!text) return;
      navigator.clipboard.writeText(text);
      copySynthBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-[var(--google-green)]"></i> <span class="text-[var(--google-green)] font-medium">Copied!</span>';
      if (window.lucide) lucide.createIcons();
      showToast('Synthesis copied to clipboard', 'success');
      setTimeout(() => {
        copySynthBtn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> <span>Copy Synthesis</span>';
        if (window.lucide) lucide.createIcons();
      }, 2000);
    });
  }

  // Save as PDF Dropdown & Scope Handlers
  const pdfToggleBtn = document.getElementById('btn-export-pdf-toggle');
  const pdfMenu = document.getElementById('pdf-export-menu');
  if (pdfToggleBtn && pdfMenu) {
    pdfToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pdfMenu.classList.toggle('hidden');
      if (window.lucide) lucide.createIcons({ root: pdfMenu });
    });

    document.addEventListener('click', (e) => {
      if (!pdfMenu.classList.contains('hidden') && !e.target.closest('#pdf-export-menu') && !e.target.closest('#btn-export-pdf-toggle')) {
        pdfMenu.classList.add('hidden');
      }
    });

    pdfMenu.querySelectorAll('[data-pdf-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        const scope = btn.getAttribute('data-pdf-scope') || 'both';
        pdfMenu.classList.add('hidden');
        exportSynthesisPdf(scope);
      });
    });
  }

  // Delegated Copy Assistant Response in Chat
  const chatThread = document.getElementById('chat-thread');
  if (chatThread) {
    chatThread.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.btn-copy-response');
      if (!copyBtn) return;
      const content = copyBtn.getAttribute('data-content');
      if (!content) return;
      navigator.clipboard.writeText(content);
      copyBtn.innerHTML = '<i data-lucide="check" class="w-3 h-3 text-[var(--google-green)]"></i> <span class="text-[var(--google-green)] font-medium">Copied!</span>';
      if (window.lucide) lucide.createIcons();
      showToast('Response copied to clipboard', 'success');
      setTimeout(() => {
        copyBtn.innerHTML = '<i data-lucide="copy" class="w-3 h-3"></i> <span>Copy</span>';
        if (window.lucide) lucide.createIcons();
      }, 2000);
    });
  }

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

  // Sidebar telemetry courses quick filter trigger
  const telemetryCoursesBtn = document.getElementById('btn-telemetry-courses');
  if (telemetryCoursesBtn) {
    telemetryCoursesBtn.addEventListener('click', toggleStudyFilter);
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

  // Keyboard Shortcuts Modal triggers
  const shortcutsBtn = document.getElementById('btn-shortcuts-toggle');
  if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => openModal('modal-shortcuts'));
  const tipsShortcutsBtn = document.getElementById('btn-tips-shortcuts');
  if (tipsShortcutsBtn) tipsShortcutsBtn.addEventListener('click', () => openModal('modal-shortcuts'));
  const closeShortcutsBtn = document.getElementById('close-modal-shortcuts');
  if (closeShortcutsBtn) closeShortcutsBtn.addEventListener('click', () => closeModal('modal-shortcuts'));
  const closeShortcutsFooterBtn = document.getElementById('btn-close-shortcuts-footer');
  if (closeShortcutsFooterBtn) closeShortcutsFooterBtn.addEventListener('click', () => closeModal('modal-shortcuts'));

  // Chat Modal close & actions
  const closeChatBtn = document.getElementById('close-modal-chat');
  if (closeChatBtn) closeChatBtn.addEventListener('click', () => closeModal('modal-chat'));
  const clearChatBtn = document.getElementById('btn-clear-chat');
  if (clearChatBtn) clearChatBtn.addEventListener('click', handleClearCurrentChat);
  const chatForm = document.getElementById('form-chat');
  if (chatForm) chatForm.addEventListener('submit', handleChatSubmit);
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (chatForm) {
          if (typeof chatForm.requestSubmit === 'function') {
            chatForm.requestSubmit();
          } else {
            handleChatSubmit(new Event('submit'));
          }
        }
      }
    });
  }

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
  const crossPromptInput = document.getElementById('cross-prompt-input');
  if (crossPromptInput) {
    crossPromptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRunCrossSynthesis();
      }
    });
  }

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

// ----------------- GLOBAL NETWORK & PROGRESS CONTROLLER -----------------
let activeLoadingOperations = 0;

function setGlobalLoading(isLoading, label = '') {
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

function setSyncStatus(isSyncing, message = '', submessage = '') {
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
  setGlobalLoading(true);
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
  } finally {
    setGlobalLoading(false);
  }
}

async function loadNotebooks() {
  setGlobalLoading(true);
  try {
    const res = await fetch('/api/notebooks');
    if (res.ok) {
      state.notebooks = await res.json();
      
      const telemetryNotebooks = document.getElementById('telemetry-notebooks');
      if (telemetryNotebooks) telemetryNotebooks.textContent = new Set(state.notebooks.map(n => n.id)).size;

      renderAccountPills();
      renderCategoryChips();
      renderNotebooksGrid();
    }
  } catch (err) {
    console.error('Failed to load notebooks:', err);
  } finally {
    setGlobalLoading(false);
  }
}

async function handleSyncAll() {
  const syncBtn = document.getElementById('btn-sync');
  const syncIcon = document.getElementById('sync-icon');
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
    const res = await fetch('/api/notebooks/sync', { method: 'POST' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errData.detail || `Server error (${res.status})`);
    }
    const synced = await res.json();
    state.notebooks = synced;
    await loadProfiles();
    
    const telemetryNotebooks = document.getElementById('telemetry-notebooks');
    if (telemetryNotebooks) telemetryNotebooks.textContent = new Set(state.notebooks.map(n => n.id)).size;

    renderAccountPills();
    renderCategoryChips();
    renderNotebooksGrid();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    showToast(`Synced ${synced.length} notebooks across ${state.profiles.length} accounts (${elapsed}s)`, 'success');
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

// ----------------- RENDERING -----------------

function renderAccountPills() {
  const container = document.getElementById('account-pills-container');
  if (!container) return;

  if (state.profiles.length === 0) {
    container.innerHTML = `
      <div class="h-7 w-28 rounded-full google-skeleton shrink-0"></div>
      <div class="h-7 w-24 rounded-full google-skeleton shrink-0"></div>
      <div class="h-7 w-20 rounded-full google-skeleton shrink-0"></div>
    `;
    return;
  }

  container.innerHTML = '';

  // "All Accounts" pill
  const uniqueCount = new Set(state.notebooks.map(n => n.id)).size;
  const allPill = createPill({
    id: 'all',
    label: 'All Accounts',
    count: uniqueCount,
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
  addBtn.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5 text-[var(--google-blue)]"></i> <span>Add Account</span>';
  addBtn.addEventListener('click', () => {
    openModal('modal-accounts');
    renderAccountsModalList();
  });
  container.appendChild(addBtn);

  if (window.lucide) lucide.createIcons();
}

function renderCategoryChips() {
  const container = document.getElementById('category-pills-container');
  if (!container) return;

  container.innerHTML = '';

  const uniqueNotebooksMap = new Map();
  for (const n of state.notebooks) {
    if (!uniqueNotebooksMap.has(n.id)) {
      uniqueNotebooksMap.set(n.id, n);
    }
  }
  const uniqueNotebooks = Array.from(uniqueNotebooksMap.values());
  const totalCount = uniqueNotebooks.length;
  const studyCount = uniqueNotebooks.filter(n => isStudyNotebook(n)).length;
  const projectsCount = totalCount - studyCount;

  // Update telemetry courses counter
  const telemetryCourses = document.getElementById('telemetry-courses');
  if (telemetryCourses) telemetryCourses.textContent = studyCount;

  // All Categories chip
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `m3-chip flex items-center gap-1.5 px-3 py-1.5 text-xs transition whitespace-nowrap cursor-pointer ${
    state.activeCategoryFilter === 'all' ? 'active' : 'hover:text-[var(--m3-on-surface)]'
  }`;
  allChip.innerHTML = `
    <span>All</span>
    <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard text-[var(--m3-on-surface-subtle)] font-mono">${totalCount}</span>
  `;
  allChip.addEventListener('click', () => {
    state.activeCategoryFilter = 'all';
    renderCategoryChips();
    renderNotebooksGrid();
    showToast('Showing all notebooks', 'info');
  });
  container.appendChild(allChip);

  // Study / Courses chip
  const studyChip = document.createElement('button');
  studyChip.type = 'button';
  studyChip.id = 'chip-filter-study';
  studyChip.className = `m3-chip flex items-center gap-1.5 px-3.5 py-1.5 text-xs transition whitespace-nowrap cursor-pointer ${
    state.activeCategoryFilter === 'study' ? 'active font-medium' : 'hover:text-[var(--m3-on-surface)]'
  }`;
  studyChip.innerHTML = `
    <i data-lucide="graduation-cap" class="w-3.5 h-3.5 ${state.activeCategoryFilter === 'study' ? 'text-[var(--google-blue)]' : 'text-[#81c995]'}"></i>
    <span>Study Courses</span>
    <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard font-mono ${state.activeCategoryFilter === 'study' ? 'text-[var(--google-blue)]' : 'text-[var(--m3-on-surface-subtle)]'}">${studyCount}</span>
  `;
  studyChip.addEventListener('click', () => {
    toggleStudyFilter();
  });
  container.appendChild(studyChip);

  // Projects & Notes chip
  const projChip = document.createElement('button');
  projChip.type = 'button';
  projChip.className = `m3-chip flex items-center gap-1.5 px-3 py-1.5 text-xs transition whitespace-nowrap cursor-pointer ${
    state.activeCategoryFilter === 'projects' ? 'active' : 'hover:text-[var(--m3-on-surface)]'
  }`;
  projChip.innerHTML = `
    <i data-lucide="folder-git-2" class="w-3.5 h-3.5 text-[var(--m3-on-surface-subtle)]"></i>
    <span>Projects</span>
    <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard text-[var(--m3-on-surface-subtle)] font-mono">${projectsCount}</span>
  `;
  projChip.addEventListener('click', () => {
    state.activeCategoryFilter = 'projects';
    renderCategoryChips();
    renderNotebooksGrid();
    showToast('Filter: Projects & Other', 'info');
  });
  container.appendChild(projChip);

  if (window.lucide) lucide.createIcons({ root: container });
}

function toggleStudyFilter() {
  if (state.activeCategoryFilter === 'study') {
    state.activeCategoryFilter = 'all';
    showToast('Filter: All Notebooks', 'info');
  } else {
    state.activeCategoryFilter = 'study';
    showToast('Filter: Study / Course NLMs (shortcut: U)', 'info');
  }
  renderCategoryChips();
  renderNotebooksGrid();
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

function getVisibleNotebooks() {
  let list = [];
  if (state.activeProfileFilter !== 'all') {
    list = state.notebooks.filter(n => n.profileId === state.activeProfileFilter);
  } else {
    // When 'all' is active, consolidate notebooks with the same ID into a single representation
    const consolidatedMap = new Map();
    for (const n of state.notebooks) {
      if (!consolidatedMap.has(n.id)) {
        consolidatedMap.set(n.id, {
          ...n,
          allProfiles: [{
            profileId: n.profileId,
            profileName: n.profileName,
            profileEmail: n.profileEmail,
            tier: n.tier,
            color: n.color
          }]
        });
      } else {
        const existing = consolidatedMap.get(n.id);
        if (!existing.allProfiles.some(p => p.profileId === n.profileId)) {
          existing.allProfiles.push({
            profileId: n.profileId,
            profileName: n.profileName,
            profileEmail: n.profileEmail,
            tier: n.tier,
            color: n.color
          });
        }
        // If any profile has Pro tier, promote the consolidated tier to 'pro'
        if (n.tier === 'pro') {
          existing.tier = 'pro';
          existing.profileId = n.profileId;
          existing.profileName = n.profileName;
          existing.color = n.color;
        }
        if (n.updated_at && (!existing.updated_at || n.updated_at > existing.updated_at)) {
          existing.updated_at = n.updated_at;
        }
        if ((n.source_count || 0) > (existing.source_count || 0)) {
          existing.source_count = n.source_count;
        }
      }
    }
    list = Array.from(consolidatedMap.values());
  }

  // Filter by category (Study Courses vs Projects)
  if (state.activeCategoryFilter === 'study') {
    list = list.filter(n => isStudyNotebook(n));
  } else if (state.activeCategoryFilter === 'projects') {
    list = list.filter(n => !isStudyNotebook(n));
  }

  // Filter by search query
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase().trim();
    list = list.filter(n => {
      const code = getCourseCode(n);
      const matchesCode = code && code.toLowerCase().includes(q);
      const matchesTitle = n.title && n.title.toLowerCase().includes(q);
      const matchesProfile = (n.profileName && n.profileName.toLowerCase().includes(q)) ||
                             (n.profileEmail && n.profileEmail.toLowerCase().includes(q)) ||
                             (n.profileId && n.profileId.toLowerCase().includes(q));
      const matchesAnyProfile = n.allProfiles && n.allProfiles.some(p =>
        (p.profileName && p.profileName.toLowerCase().includes(q)) ||
        (p.profileEmail && p.profileEmail.toLowerCase().includes(q)) ||
        (p.profileId && p.profileId.toLowerCase().includes(q))
      );
      return matchesTitle || matchesCode || matchesProfile || matchesAnyProfile;
    });
  }

  return list;
}

function toggleSelectAllVisible() {
  const visible = getVisibleNotebooks();
  if (!visible.length) {
    showToast('No notebooks visible to select', 'info');
    return;
  }
  const allSelected = visible.every(n => state.selectedNotebooks.has(n.id));
  if (allSelected) {
    visible.forEach(n => state.selectedNotebooks.delete(n.id));
    showToast(`Deselected ${visible.length} notebook${visible.length > 1 ? 's' : ''}`, 'info');
  } else {
    visible.forEach(n => {
      state.selectedNotebooks.set(n.id, {
        notebookId: n.id,
        profileId: n.profileId,
        title: n.title || 'Untitled Notebook'
      });
    });
    showToast(`Selected ${visible.length} notebook${visible.length > 1 ? 's' : ''}`, 'info');
  }
  updateSelectionBanner();
  renderNotebooksGrid();
}

function renderNotebooksGrid() {
  const grid = document.getElementById('notebooks-grid');
  const emptyState = document.getElementById('empty-state');
  const visibleCountLabel = document.getElementById('visible-count');
  const filterLabel = document.getElementById('active-filter-label');

  if (!grid || !emptyState) return;

  // Filter notebooks
  let filtered = getVisibleNotebooks();

  if (visibleCountLabel) visibleCountLabel.textContent = filtered.length;
  if (filterLabel) {
    let accountName = 'All Accounts';
    if (state.activeProfileFilter !== 'all') {
      const p = state.profiles.find(x => x.id === state.activeProfileFilter);
      accountName = p ? p.displayName : state.activeProfileFilter;
    }

    if (state.activeCategoryFilter === 'study') {
      filterLabel.textContent = `🎓 Study Courses • ${accountName}`;
    } else if (state.activeCategoryFilter === 'projects') {
      filterLabel.textContent = `🔬 Projects • ${accountName}`;
    } else {
      filterLabel.textContent = accountName;
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
    const isStudy = isStudyNotebook(notebook);
    const courseCode = getCourseCode(notebook);

    return `
      <div 
        class="m3-card animate-m3-stagger p-5 flex flex-col justify-between group relative ${isSelected ? 'selected' : ''}"
        style="animation-delay: ${Math.min(idx * 20, 200)}ms;"
      >
        
        <!-- Top row: Selection Checkbox, Account Tag, Course Badge, Pro Tier Badge -->
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
            ${notebook.allProfiles && notebook.allProfiles.length > 1 ? `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)]" title="${escapeHtml(notebook.allProfiles.map(p => p.profileName || p.profileId).join(' • '))}">
                <span class="flex items-center -space-x-1">
                  ${notebook.allProfiles.map(p => `<span class="w-2 h-2 rounded-full border border-[var(--m3-surface)]" style="background-color: ${p.color || '#3b82f6'}"></span>`).join('')}
                </span>
                <span>${escapeHtml(notebook.profileName)}</span>
                <span class="text-[10px] text-[var(--google-blue)] font-medium font-mono bg-[var(--google-blue-container)]/50 px-1 py-0.2 rounded">+${notebook.allProfiles.length - 1} shared</span>
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)]">
                <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${notebook.color}"></span>
                <span>${escapeHtml(notebook.profileName)}</span>
              </span>
            `}
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            ${isStudy && courseCode ? `
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-blue-container)]/70 text-[var(--google-blue)] border border-[var(--google-blue)]/30 font-mono tracking-tight" title="Academic Course NLM: ${escapeHtml(courseCode)}">
                <i data-lucide="graduation-cap" class="w-3 h-3 text-[var(--google-blue)]"></i> ${escapeHtml(courseCode)}
              </span>
            ` : ''}

            ${isPro ? `
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-yellow-container)]/50 text-[var(--google-yellow)] border border-[var(--google-yellow)]/30">
                <i data-lucide="sparkles" class="w-3 h-3 text-[var(--google-yellow)]"></i> PRO AI
              </span>
            ` : `
              <span class="text-[10px] font-mono text-[var(--m3-on-surface-subtle)]">${escapeHtml(notebook.profileId)}</span>
            `}
          </div>
        </div>

        <!-- Notebook Title & Meta -->
        <div class="mb-4 flex-1">
          <h3 class="text-[15px] font-medium text-[var(--m3-on-surface)] group-hover:text-[var(--google-blue)] transition-colors line-clamp-2 leading-snug tracking-normal">
            ${highlightMatch(notebook.title, state.searchQuery)}
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
            type="button"
            data-id="${notebook.id}"
            data-profile="${notebook.profileId}"
            data-title="${escapeHtml(notebook.title)}"
            class="btn-query-notebook google-btn-tonal flex items-center gap-1.5 px-3.5 py-1.5 text-xs shadow-sm cursor-pointer ${state.activeQueries.has(notebook.id) ? 'border-[var(--google-blue)]/50 bg-[var(--google-blue-container)]/30' : ''}"
          >
            ${state.activeQueries.has(notebook.id) ? `
              <div class="google-quad-dots scale-75 pointer-events-none">
                <span class="google-quad-dot"></span>
                <span class="google-quad-dot"></span>
                <span class="google-quad-dot"></span>
                <span class="google-quad-dot"></span>
              </div>
              <span class="pointer-events-none text-[var(--google-blue)] font-medium">Synthesizing...</span>
            ` : `
              <i data-lucide="message-square" class="w-3.5 h-3.5 pointer-events-none"></i>
              <span class="pointer-events-none">Query</span>
            `}
          </button>

          <!-- Deep Link to Gemini Notebook Web -->
          <a
            href="https://notebooklm.google.com/notebook/${notebook.id}"
            target="_blank"
            rel="noopener noreferrer"
            title="Open in official Gemini Notebook web interface"
            class="google-btn-outlined flex items-center gap-1.5 text-xs text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] py-1 px-2.5"
          >
            <span>Open Web</span>
            <i data-lucide="external-link" class="w-3 h-3 text-[var(--m3-on-surface-subtle)]"></i>
          </a>
        </div>

      </div>
    `;
  }).join('');

  // Wire up Query button listeners safely
  grid.querySelectorAll('.btn-query-notebook').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.currentTarget;
      const id = target.getAttribute('data-id');
      const profile = target.getAttribute('data-profile');
      const title = target.getAttribute('data-title');
      openChatModal(id, profile, title);
    });
  });

  // Wire up checkbox listeners
  grid.querySelectorAll('.notebook-select-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const profile = e.target.getAttribute('data-profile');
      const title = e.target.getAttribute('data-title');
      const card = e.target.closest('.m3-card');
      if (e.target.checked) {
        state.selectedNotebooks.set(id, { notebookId: id, profileId: profile, title: title });
        if (card) card.classList.add('selected');
      } else {
        state.selectedNotebooks.delete(id);
        if (card) card.classList.remove('selected');
      }
      updateSelectionBanner();
    });
  });

  // Card click to toggle selection & double-click to query (Google Drive / Photos fluid pattern)
  grid.querySelectorAll('.m3-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, label')) return;
      const cb = card.querySelector('.notebook-select-checkbox');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
    });

    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, a, input, label')) return;
      const qBtn = card.querySelector('.btn-query-notebook');
      if (qBtn) qBtn.click();
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
            type="button"
            data-action="login"
            data-profile-id="${p.id}"
            title="Authenticate with Google Chrome"
            class="btn-account-login google-btn-outlined px-3 py-1 text-xs font-medium cursor-pointer"
          >
            <i data-lucide="log-in" class="w-3.5 h-3.5 inline text-[var(--m3-on-surface-subtle)] pointer-events-none"></i>
            <span class="pointer-events-none">Login</span>
          </button>

          <!-- Toggle Pro button -->
          ${!isPro ? `
            <button
              type="button"
              data-action="set-pro"
              data-profile-id="${p.id}"
              title="Set this account as the primary Pro AI synthesis engine"
              class="btn-account-set-pro google-btn-tonal px-3 py-1 text-xs text-[var(--google-yellow)] bg-[var(--google-yellow-container)]/40 hover:bg-[var(--google-yellow-container)]/70 border border-[var(--google-yellow)]/30 cursor-pointer"
            >
              Make Pro
            </button>
          ` : ''}

          <!-- Delete account button -->
          <button
            type="button"
            data-action="delete"
            data-profile-id="${p.id}"
            title="Delete account profile"
            class="btn-account-delete p-2 rounded-full text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-red)] hover:bg-[var(--google-red-container)]/30 transition cursor-pointer"
          >
            <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners safely
  container.querySelectorAll('.btn-account-login').forEach(btn => {
    btn.addEventListener('click', () => handleTriggerLogin(btn.getAttribute('data-profile-id')));
  });
  container.querySelectorAll('.btn-account-set-pro').forEach(btn => {
    btn.addEventListener('click', () => handleSetPro(btn.getAttribute('data-profile-id')));
  });
  container.querySelectorAll('.btn-account-delete').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteAccount(btn.getAttribute('data-profile-id')));
  });

  if (window.lucide) lucide.createIcons();
}

async function handleAddAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-account-id').value.trim();
  const name = document.getElementById('input-account-name').value.trim();
  const tier = document.getElementById('select-account-tier').value;
  const color = document.getElementById('input-account-color').value;
  const launchLogin = document.getElementById('check-launch-login').checked;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalSubmitHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Connecting Account...</span>';
    if (window.lucide) lucide.createIcons({ root: submitBtn });
  }
  setGlobalLoading(true);

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
  } finally {
    setGlobalLoading(false);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalSubmitHtml;
      if (window.lucide) lucide.createIcons({ root: submitBtn });
    }
  }
}

async function handleTriggerLogin(profileId) {
  const btn = document.querySelector(`.btn-account-login[data-profile-id="${profileId}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin pointer-events-none"></i><span class="pointer-events-none">Launching...</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }
  setGlobalLoading(true);

  try {
    const res = await fetch(`/api/profiles/${profileId}/login`, { method: 'POST' });
    if (res.ok) {
      showToast(`Sign-in window launched for '${profileId}'`, 'info');
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

async function handleSetPro(profileId) {
  const btn = document.querySelector(`.btn-account-set-pro[data-profile-id="${profileId}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin pointer-events-none"></i><span class="pointer-events-none">Setting Pro...</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }
  setGlobalLoading(true);

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
  } finally {
    setGlobalLoading(false);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      if (window.lucide) lucide.createIcons({ root: btn });
    }
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

          <div class="flex items-center justify-between mt-3 pt-2.5 border-t border-[var(--m3-outline-variant)]/60 text-[11px] text-[var(--m3-on-surface-subtle)]">
            <span class="flex items-center gap-1.5 font-sans">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--google-green)]"></span>
              <span>Gemini Notebook Verified</span>
              ${msg.executedProfileId ? `<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] border border-[var(--google-blue)]/20" title="Answered via account ${escapeHtml(msg.executedProfileId)}">via ${escapeHtml(msg.executedProfileId)}</span>` : ''}
            </span>
            <button
              type="button"
              class="btn-copy-response google-btn-outlined px-2.5 py-1 text-[11px] flex items-center gap-1 text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-blue)] hover:border-[var(--google-blue)] transition cursor-pointer"
              title="Copy response to clipboard"
              data-content="${escapeHtml(msg.content)}"
            >
              <i data-lucide="copy" class="w-3 h-3"></i>
              <span>Copy</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

// ----------------- CHAT MODAL & BACKGROUND QUERY ENGINE -----------------

const activeThinkingTimers = new Map(); // key: notebookId, value: { intervalId, startTime }

function startThinkingTimer(notebookId, queryStartTime = Date.now()) {
  stopThinkingTimer(notebookId);

  const update = () => {
    const elapsedSec = ((Date.now() - queryStartTime) / 1000).toFixed(1);
    const timerEl = document.getElementById(`loader-timer-${notebookId}`);
    if (timerEl) {
      timerEl.textContent = `${elapsedSec}s`;
    }

    const phaseEl = document.getElementById(`loader-phase-text-${notebookId}`);
    if (phaseEl) {
      const sec = parseFloat(elapsedSec);
      if (sec < 2.5) {
        phaseEl.textContent = 'Connecting to notebook & indexing sources...';
      } else if (sec < 5.5) {
        phaseEl.textContent = 'Searching source passages & extracting citations...';
      } else {
        phaseEl.textContent = 'Synthesizing answer with Gemini...';
      }
    }
  };

  update();
  const intervalId = setInterval(update, 150);
  activeThinkingTimers.set(notebookId, { intervalId, startTime: queryStartTime });
}

function stopThinkingTimer(notebookId) {
  if (activeThinkingTimers.has(notebookId)) {
    const { intervalId } = activeThinkingTimers.get(notebookId);
    clearInterval(intervalId);
    activeThinkingTimers.delete(notebookId);
  }
}

function renderLoaderBubble(notebookId) {
  return `
    <div id="loader-${notebookId}" class="flex items-start gap-2.5 animate-m3-enter chat-loader-bubble">
      <div class="w-8 h-8 rounded-full bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] flex items-center justify-center text-[var(--google-blue)] shadow-sm shrink-0">
        <i data-lucide="sparkles" class="w-3.5 h-3.5 animate-pulse"></i>
      </div>
      <div class="flex-1 p-4 rounded-2xl m3-subcard space-y-3">
        <div class="flex items-center justify-between text-xs text-[var(--m3-on-surface-subtle)] font-medium">
          <div class="flex items-center gap-2.5">
            <div class="google-quad-dots">
              <span class="google-quad-dot"></span>
              <span class="google-quad-dot"></span>
              <span class="google-quad-dot"></span>
              <span class="google-quad-dot"></span>
            </div>
            <span id="loader-phase-text-${notebookId}" class="transition-all duration-300 font-sans">
              Gemini Notebook is synthesizing...
            </span>
          </div>
          <span id="loader-timer-${notebookId}" class="text-[11px] font-mono text-[var(--google-blue)] bg-[var(--google-blue-container)]/50 px-2 py-0.5 rounded-full font-medium">
            0.0s
          </span>
        </div>
        
        <div class="space-y-2 pt-1">
          <div class="h-2.5 w-[92%] rounded-full google-skeleton"></div>
          <div class="h-2.5 w-[84%] rounded-full google-skeleton"></div>
          <div class="h-2.5 w-[60%] rounded-full google-skeleton"></div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-[var(--m3-outline-variant)]/40">
          <div class="h-4 w-24 rounded-full google-skeleton"></div>
          <div class="h-4 w-28 rounded-full google-skeleton"></div>
        </div>
      </div>
    </div>
  `;
}

function appendChatMessageToThread(msg) {
  const thread = document.getElementById('chat-thread');
  if (!thread) return;
  const temp = document.createElement('div');
  temp.innerHTML = renderChatMessageBubble(msg).trim();
  const bubble = temp.firstElementChild;
  if (bubble) {
    thread.appendChild(bubble);
    if (window.lucide) lucide.createIcons({ root: bubble });
    thread.scrollTop = thread.scrollHeight;
  }
}

function getConversationIdForNotebook(notebookId) {
  if (state.conversationIds.has(notebookId)) {
    return state.conversationIds.get(notebookId);
  }
  const history = state.chatHistories.get(notebookId) || [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].conversationId) {
      state.conversationIds.set(notebookId, history[i].conversationId);
      return history[i].conversationId;
    }
  }
  return null;
}

function updateBackgroundQueryStatus() {
  const dock = document.getElementById('floating-query-dock');
  const titleEl = document.getElementById('floating-query-title');
  const chatModalOpen = isModalOpen('modal-chat');

  if (state.activeQueries.size === 0) {
    if (dock) {
      dock.classList.add('hidden');
      dock.classList.remove('flex');
    }
    updateAllNotebookCardButtons();
    return;
  }

  // Active queries are currently synthesizing!
  const firstActive = state.activeQueries.values().next().value;
  // If modal-chat is open and focused on the only active notebook, hide floating dock to prevent visual duplication
  if (chatModalOpen && state.activeChat && state.activeQueries.has(state.activeChat.notebookId) && state.activeQueries.size === 1) {
    if (dock) {
      dock.classList.add('hidden');
      dock.classList.remove('flex');
    }
  } else if (dock && titleEl && firstActive) {
    const count = state.activeQueries.size;
    if (count === 1) {
      titleEl.textContent = `Synthesizing answer for "${firstActive.title}"...`;
    } else {
      titleEl.textContent = `Synthesizing ${count} answers in background...`;
    }
    dock.classList.remove('hidden');
    dock.classList.add('flex');
    dock.onclick = () => {
      openChatModal(firstActive.notebookId, firstActive.profileId, firstActive.title);
    };
    if (window.lucide) lucide.createIcons({ root: dock });
  }

  updateAllNotebookCardButtons();
}

function updateAllNotebookCardButtons() {
  document.querySelectorAll('.btn-query-notebook').forEach(btn => {
    const id = btn.getAttribute('data-id');
    const isSynthesizing = state.activeQueries.has(id);
    if (isSynthesizing) {
      btn.innerHTML = `
        <div class="google-quad-dots scale-75 pointer-events-none">
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
        </div>
        <span class="pointer-events-none text-[var(--google-blue)] font-medium">Synthesizing...</span>
      `;
      btn.classList.add('border-[var(--google-blue)]/50', 'bg-[var(--google-blue-container)]/30');
    } else {
      btn.innerHTML = `
        <i data-lucide="message-square" class="w-3.5 h-3.5 pointer-events-none"></i>
        <span class="pointer-events-none">Query</span>
      `;
      btn.classList.remove('border-[var(--google-blue)]/50', 'bg-[var(--google-blue-container)]/30');
    }
  });
  if (window.lucide) lucide.createIcons();
}

window.openChatModal = function(notebookId, profileId, title) {
  // If profileId wasn't passed or we want the best default, prefer the pro profile if available
  const defaultProProfile = state.profiles.find(p => p.isDefaultPro || p.tier === 'pro');
  const initialProfileId = profileId || (defaultProProfile ? defaultProProfile.id : (state.profiles[0]?.id || 'default'));

  state.activeChat = { notebookId, profileId: initialProfileId, title };
  const titleEl = document.getElementById('chat-modal-title');
  if (titleEl) titleEl.textContent = title;
  
  const profileSelect = document.getElementById('chat-profile-select');
  const profileBadge = document.getElementById('chat-profile-badge');

  if (profileSelect) {
    profileSelect.innerHTML = state.profiles.map(p => {
      const isSelected = p.id === initialProfileId;
      const tierLabel = (p.isDefaultPro || p.tier === 'pro') ? 'PRO AI ⭐' : 'Standard';
      return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.displayName || p.id)} (${tierLabel})</option>`;
    }).join('');

    const updateProfileUI = () => {
      const selectedId = profileSelect.value;
      const selProfile = state.profiles.find(p => p.id === selectedId);
      if (state.activeChat) state.activeChat.profileId = selectedId;
      if (profileBadge) {
        if (selProfile && (selProfile.isDefaultPro || selProfile.tier === 'pro')) {
          profileBadge.classList.remove('hidden');
          profileBadge.classList.add('inline-flex');
        } else {
          profileBadge.classList.add('hidden');
          profileBadge.classList.remove('inline-flex');
        }
      }
      const introProfileEl = document.getElementById('chat-intro-profile-code');
      if (introProfileEl) {
        introProfileEl.textContent = selectedId;
      }
    };

    profileSelect.onchange = updateProfileUI;
    updateProfileUI();
  }
  
  const thread = document.getElementById('chat-thread');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-chat-send');
  
  // Introductory system card
  const introCard = `
    <div class="p-4 rounded-2xl m3-subcard text-xs text-[var(--m3-on-surface-variant)] flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-[var(--google-blue)] shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong>. Querying via account <code id="chat-intro-profile-code" class="px-1.5 py-0.5 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] font-mono">${initialProfileId}</code>. Select your query profile above or ask any question below.</span>
    </div>
  `;

  // Restore existing history if present
  const history = state.chatHistories.get(notebookId) || [];
  let contentHtml = introCard;
  if (history.length > 0) {
    contentHtml += history.map(msg => renderChatMessageBubble(msg)).join('');
  }

  // If this notebook is currently synthesizing in background, restore/show synthesizing skeleton loader!
  const isQueryActive = state.activeQueries.has(notebookId);
  if (isQueryActive) {
    contentHtml += renderLoaderBubble(notebookId);
    const activeQuery = state.activeQueries.get(notebookId);
    startThinkingTimer(notebookId, activeQuery ? activeQuery.startTime : Date.now());
  }

  thread.innerHTML = contentHtml;

  if (isQueryActive) {
    if (chatInput) {
      chatInput.disabled = true;
      chatInput.placeholder = "Gemini Notebook is thinking & synthesizing...";
    }
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Synthesizing</span>';
    }
  } else {
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.placeholder = "Ask a question about this notebook's sources...";
    }
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>Ask</span><i data-lucide="send" class="w-3.5 h-3.5"></i>';
    }
  }

  openModal('modal-chat');
  updateBackgroundQueryStatus();
  if (window.lucide) lucide.createIcons();
  thread.scrollTop = thread.scrollHeight;
  if (chatInput && !isQueryActive) chatInput.focus();
};

function handleClearCurrentChat() {
  if (!state.activeChat) return;
  const notebookId = state.activeChat.notebookId;
  const title = state.activeChat.title;
  const profileId = state.activeChat.profileId;

  if (state.activeQueries.has(notebookId)) {
    showToast('Cannot clear chat while an answer is actively being synthesized.', 'info');
    return;
  }

  stopThinkingTimer(notebookId);
  clearNotebookChatHistory(notebookId);
  state.conversationIds.delete(notebookId);

  const profileSelect = document.getElementById('chat-profile-select');
  const activeProf = (profileSelect && profileSelect.value) || profileId;

  const thread = document.getElementById('chat-thread');
  thread.innerHTML = `
    <div class="p-4 rounded-2xl m3-subcard text-xs text-[var(--m3-on-surface-variant)] flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-[var(--google-blue)] shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong>. Querying via account <code id="chat-intro-profile-code" class="px-1.5 py-0.5 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] font-mono">${activeProf}</code>. Select your query profile above or ask any question below.</span>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  showToast('Chat history cleared for this notebook', 'info');
}

async function handleChatSubmit(e) {
  e.preventDefault();
  if (!state.activeChat) return;

  const profileSelect = document.getElementById('chat-profile-select');
  const profileId = (profileSelect && profileSelect.value) ? profileSelect.value : state.activeChat.profileId;
  state.activeChat.profileId = profileId;

  const notebookId = state.activeChat.notebookId;
  const title = state.activeChat.title;

  if (state.activeQueries.has(notebookId)) {
    showToast('Please wait, an answer is already being synthesized for this notebook.', 'info');
    return;
  }

  const input = document.getElementById('chat-input');
  const question = input ? input.value.trim() : '';
  if (!question) return;

  const thread = document.getElementById('chat-thread');
  const sendBtn = document.getElementById('btn-chat-send');

  // Retrieve or initialize history for this notebook
  let history = state.chatHistories.get(notebookId);
  if (!history) {
    history = [];
    state.chatHistories.set(notebookId, history);
  }

  // Push user message
  const userMsg = {
    role: 'user',
    content: question,
    timestamp: Date.now()
  };
  history.push(userMsg);
  saveNotebookChatHistory(notebookId);

  // Append user message to thread
  appendChatMessageToThread(userMsg);

  // Append Google skeleton loader bubble
  const loaderEl = document.createElement('div');
  loaderEl.innerHTML = renderLoaderBubble(notebookId).trim();
  const loaderNode = loaderEl.firstElementChild;
  if (loaderNode && thread) {
    thread.appendChild(loaderNode);
    if (window.lucide) lucide.createIcons({ root: loaderNode });
    thread.scrollTop = thread.scrollHeight;
  }

  // Register active background query & start live thinking timer
  const queryStartTime = Date.now();
  state.activeQueries.set(notebookId, {
    notebookId,
    profileId,
    title,
    question,
    startTime: queryStartTime
  });
  startThinkingTimer(notebookId, queryStartTime);
  setGlobalLoading(true);

  // Lock input and button in modal
  if (input) {
    input.value = '';
    input.disabled = true;
    input.placeholder = "Gemini Notebook is thinking & synthesizing...";
  }
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Synthesizing</span>';
    if (window.lucide) lucide.createIcons({ root: sendBtn });
  }

  updateBackgroundQueryStatus();

  // Multi-turn conversation ID
  const conversationId = getConversationIdForNotebook(notebookId);

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebookId: notebookId,
        profileId: profileId,
        question: question,
        conversationId: conversationId || null
      })
    });

    state.activeQueries.delete(notebookId);
    updateBackgroundQueryStatus();

    if (res.ok) {
      const data = await res.json();

      if (!data.success) {
        const errMsg = data.error || 'Query failed or timed out. Please check your login credentials.';
        handleQueryFailure(notebookId, profileId, title, errMsg);
        return;
      }

      if (data.conversationId) {
        state.conversationIds.set(notebookId, data.conversationId);
      }

      const answer = data.answer || 'No response returned.';
      const assistantMsg = {
        role: 'assistant',
        content: answer,
        citations: data.citations || [],
        conversationId: data.conversationId || conversationId,
        handledByProFallback: !!data.handledByProFallback,
        fallbackReason: data.fallbackReason || '',
        executedProfileId: data.executedProfileId || profileId,
        timestamp: Date.now()
      };
      history.push(assistantMsg);
      saveNotebookChatHistory(notebookId);

      handleQuerySuccess(notebookId, profileId, title, assistantMsg);
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      handleQueryFailure(notebookId, profileId, title, err.detail || 'Error running query');
    }
  } catch (err) {
    state.activeQueries.delete(notebookId);
    updateBackgroundQueryStatus();
    handleQueryFailure(notebookId, profileId, title, `Network error: ${err.message}`);
  }
}

function handleQuerySuccess(notebookId, profileId, title, assistantMsg) {
  stopThinkingTimer(notebookId);
  setGlobalLoading(false);

  const isCurrentlyOpenForThisNotebook =
    isModalOpen('modal-chat') &&
    state.activeChat &&
    state.activeChat.notebookId === notebookId;

  if (isCurrentlyOpenForThisNotebook) {
    const loader = document.getElementById(`loader-${notebookId}`);
    if (loader) loader.remove();

    appendChatMessageToThread(assistantMsg);
    resetChatInputState();
  } else {
    showToast(`Answer ready for "${title}"`, 'success', {
      label: 'View Answer',
      onClick: () => openChatModal(notebookId, profileId, title)
    });
  }
}

function handleQueryFailure(notebookId, profileId, title, errorMsg) {
  stopThinkingTimer(notebookId);
  setGlobalLoading(false);

  const isCurrentlyOpenForThisNotebook =
    isModalOpen('modal-chat') &&
    state.activeChat &&
    state.activeChat.notebookId === notebookId;
    isModalOpen('modal-chat') &&
    state.activeChat &&
    state.activeChat.notebookId === notebookId;

  if (isCurrentlyOpenForThisNotebook) {
    const loader = document.getElementById(`loader-${notebookId}`);
    if (loader) loader.remove();

    const thread = document.getElementById('chat-thread');
    if (thread) {
      const errEl = document.createElement('div');
      errEl.className = 'p-3.5 rounded-2xl bg-[var(--google-red-container)]/30 border border-[var(--google-red)]/30 text-[var(--google-red)] text-xs animate-m3-enter flex items-center gap-2';
      errEl.innerHTML = `
        <i data-lucide="alert-circle" class="w-4 h-4 shrink-0"></i>
        <span>Query failed: ${escapeHtml(errorMsg)}</span>
      `;
      thread.appendChild(errEl);
      if (window.lucide) lucide.createIcons({ root: errEl });
      thread.scrollTop = thread.scrollHeight;
    }

    resetChatInputState();
  } else {
    showToast(`Query failed for "${title}": ${errorMsg}`, 'error', {
      label: 'Open Chat',
      onClick: () => openChatModal(notebookId, profileId, title)
    });
  }
}

function resetChatInputState() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-chat-send');
  if (input) {
    input.disabled = false;
    input.placeholder = "Ask a question about this notebook's sources...";
    input.focus();
  }
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span>Ask</span><i data-lucide="send" class="w-3.5 h-3.5"></i>';
    if (window.lucide) lucide.createIcons({ root: sendBtn });
  }
}

// ----------------- CROSS-ACCOUNT SYNTHESIS -----------------

let lastCrossSynthesisResult = null;

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

  const loadingState = document.getElementById('cross-loading-state');
  if (loadingState) loadingState.classList.add('hidden');
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
  if (window.lucide) lucide.createIcons({ root: btn });

  const loadingState = document.getElementById('cross-loading-state');
  const resultsContainer = document.getElementById('cross-results-container');
  const resultsBody = document.getElementById('cross-results-body');
  const timerEl = document.getElementById('cross-elapsed-timer');

  const step1 = document.getElementById('cross-step-1');
  const step2 = document.getElementById('cross-step-2');
  const step3 = document.getElementById('cross-step-3');

  // Reset steps
  if (step1) {
    step1.className = 'flex items-center gap-2 text-[var(--google-blue)] font-medium transition-colors';
    step1.innerHTML = '<i data-lucide="circle-dot" class="w-3.5 h-3.5 shrink-0 animate-pulse"></i><span>Querying source materials across authenticated Google accounts...</span>';
  }
  if (step2) {
    step2.className = 'flex items-center gap-2 text-[var(--m3-on-surface-subtle)] transition-colors';
    step2.innerHTML = '<i data-lucide="circle" class="w-3.5 h-3.5 shrink-0"></i><span>Correlating citations and reconciling key findings...</span>';
  }
  if (step3) {
    step3.className = 'flex items-center gap-2 text-[var(--m3-on-surface-subtle)] transition-colors';
    step3.innerHTML = '<i data-lucide="circle" class="w-3.5 h-3.5 shrink-0"></i><span>Generating unified cross-notebook intelligence brief...</span>';
  }

  if (resultsContainer) resultsContainer.classList.add('hidden');
  if (loadingState) loadingState.classList.remove('hidden');
  if (window.lucide) lucide.createIcons({ root: loadingState });

  setGlobalLoading(true);

  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (timerEl) timerEl.textContent = `${elapsed}s`;

    const sec = parseFloat(elapsed);
    if (sec >= 2.5 && step1 && step2 && !step1.classList.contains('text-[var(--google-green)]')) {
      step1.className = 'flex items-center gap-2 text-[var(--google-green)] transition-colors';
      step1.innerHTML = '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 shrink-0 text-[var(--google-green)]"></i><span>Querying source materials across authenticated Google accounts...</span>';
      step2.className = 'flex items-center gap-2 text-[var(--google-blue)] font-medium transition-colors';
      step2.innerHTML = '<i data-lucide="circle-dot" class="w-3.5 h-3.5 shrink-0 animate-pulse"></i><span>Correlating citations and reconciling key findings...</span>';
      if (window.lucide) lucide.createIcons({ root: loadingState });
    }

    if (sec >= 6.0 && step2 && step3 && !step2.classList.contains('text-[var(--google-green)]')) {
      step2.className = 'flex items-center gap-2 text-[var(--google-green)] transition-colors';
      step2.innerHTML = '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 shrink-0 text-[var(--google-green)]"></i><span>Correlating citations and reconciling key findings...</span>';
      step3.className = 'flex items-center gap-2 text-[var(--google-blue)] font-medium transition-colors';
      step3.innerHTML = '<i data-lucide="circle-dot" class="w-3.5 h-3.5 shrink-0 animate-pulse"></i><span>Generating unified cross-notebook intelligence brief...</span>';
      if (window.lucide) lucide.createIcons({ root: loadingState });
    }
  }, 150);

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
      
      let renderedHtml = '';
      if (data.isSynthesized && data.synthesizedBrief) {
        renderedHtml = `
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-[var(--m3-outline-variant)]">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--google-blue-container)] text-[var(--google-blue)] flex items-center gap-1.5 shadow-sm">
                <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                Pro AI Unified Synthesis
              </span>
              <span class="text-[10px] font-mono text-[var(--m3-on-surface-subtle)] bg-[var(--m3-surface-container-high)] px-2 py-0.5 rounded-md border border-[var(--m3-outline-variant)]">
                ${data.synthesisModel || 'gemini-2.5-flash'}
              </span>
            </div>
            <span class="text-[11px] text-[var(--google-green)] flex items-center gap-1 font-medium">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Reconciled across ${data.notebookResults?.length || 0} notebook(s)
            </span>
          </div>
          <div class="nlm-markdown text-xs leading-relaxed space-y-3 font-sans text-[var(--m3-on-surface)]">
            ${renderMarkdown(data.synthesizedBrief)}
          </div>
          <details class="mt-6 pt-3.5 border-t border-[var(--m3-outline-variant)]/60 group">
            <summary class="text-[11px] font-medium text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-blue)] cursor-pointer select-none flex items-center gap-2 transition py-1">
              <i data-lucide="chevron-right" class="w-3.5 h-3.5 transition-transform group-open:rotate-90"></i>
              <span>Inspect Raw Source Extracts (${data.notebookResults?.length || 0} Notebooks)</span>
            </summary>
            <div class="mt-3 p-4 rounded-xl bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] text-xs nlm-markdown space-y-3">
              ${renderMarkdown(data.combinedContext || 'No raw context available.')}
            </div>
          </details>
        `;
      } else {
        const fallbackNotice = data.synthesisError 
          ? `<div class="p-3 rounded-xl bg-[var(--google-yellow-container)]/30 border border-[var(--google-yellow)]/40 text-xs text-[var(--m3-on-surface)] mb-3 flex items-center gap-2">
               <i data-lucide="alert-circle" class="w-4 h-4 text-[var(--google-yellow)] shrink-0"></i>
               <span>Stage 2 LLM synthesis was skipped or unavailable (${data.synthesisError}). Displaying raw parallel extractions below.</span>
             </div>`
          : '';
        renderedHtml = `
          ${fallbackNotice}
          <div class="nlm-markdown text-xs leading-relaxed font-sans text-[var(--m3-on-surface)]">
            ${renderMarkdown(data.combinedContext || 'No synthesis produced.')}
          </div>
        `;
      }

      lastCrossSynthesisResult = {
        ...data,
        prompt: prompt,
        notebooks: selected,
        timestamp: new Date().toLocaleString()
      };

      if (resultsBody) {
        resultsBody.innerHTML = renderedHtml;
        resultsBody.setAttribute('data-raw-markdown', data.synthesizedBrief || data.combinedContext || '');
      }
      if (loadingState) loadingState.classList.add('hidden');
      if (resultsContainer) resultsContainer.classList.remove('hidden');
      if (window.lucide) lucide.createIcons({ root: resultsBody });
      showToast('Cross-account synthesis completed successfully.', 'success');
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      if (loadingState) loadingState.classList.add('hidden');
      showToast('Synthesis error: ' + (err.detail || 'Failed to synthesize'), 'error');
    }
  } catch (err) {
    if (loadingState) loadingState.classList.add('hidden');
    showToast('Error: ' + err.message, 'error');
  } finally {
    clearInterval(timerInterval);
    setGlobalLoading(false);
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span>Execute Multi-Account Synthesis</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }
}

// ----------------- CROSS-ACCOUNT SYNTHESIS PDF EXPORT -----------------

function exportSynthesisPdf(scope = 'both') {
  if (!lastCrossSynthesisResult) {
    showToast('No active synthesis result to export as PDF.', 'info');
    return;
  }

  const { prompt, notebooks, synthesizedBrief, combinedContext, isSynthesized, synthesisModel, timestamp, notebookResults } = lastCrossSynthesisResult;

  const hasSynthesis = Boolean(synthesizedBrief);
  const hasRaw = Boolean(combinedContext);

  if (!hasSynthesis && !hasRaw) {
    showToast('No synthesis or raw source content available to export.', 'error');
    return;
  }

  let docTitle = 'Super-NLM Intelligence Brief';
  let docSubtitle = 'Cross-Account Unified Synthesis Report';
  let scopeLabel = 'Full Report (Synthesis + Raw Sources)';

  if (scope === 'synthesis') {
    docTitle = 'Super-NLM Executive Synthesis';
    docSubtitle = 'Cross-Account Reconciled Intelligence Brief';
    scopeLabel = 'Executive Synthesis Only';
  } else if (scope === 'raw') {
    docTitle = 'Super-NLM Source Materials';
    docSubtitle = 'Ground-Truth Multi-Notebook Extraction Report';
    scopeLabel = 'Raw Source Materials Only';
  }

  const briefHtml = (hasSynthesis && scope !== 'raw')
    ? `<div class="synthesis-section">
         <div class="section-badge">Executive Reconciled Synthesis</div>
         <div class="synthesis-content">${renderMarkdown(synthesizedBrief)}</div>
       </div>`
    : '';

  let rawSourcesSectionHtml = '';
  if (hasRaw && scope !== 'synthesis') {
    let cardsHtml = '';
    if (notebookResults && notebookResults.length > 0) {
      cardsHtml = notebookResults.map(item => {
        const title = item.title || item.notebookId;
        const profile = item.profileId;
        const ans = item.result?.answer || item.result?.error || 'No content retrieved';
        return `
          <div class="raw-card">
            <div class="raw-card-header">
              <span class="raw-card-title">${escapeHtml(title)}</span>
              <span class="chip-profile">Account: ${escapeHtml(profile)}</span>
            </div>
            <div class="raw-card-body">
              ${renderMarkdown(ans)}
            </div>
          </div>
        `;
      }).join('');
    } else {
      cardsHtml = `<div class="raw-card"><div class="raw-card-body">${renderMarkdown(combinedContext)}</div></div>`;
    }

    const appendixPageClass = (scope === 'both' && hasSynthesis) ? 'appendix-page' : 'standalone-appendix';
    rawSourcesSectionHtml = `
      <div class="${appendixPageClass}">
        <div class="section-badge">Ground-Truth Source Extracts</div>
        <div class="appendix-title">Source Materials & Notebook Extractions</div>
        <p class="appendix-desc">
          Verbatim RAG extractions and citation anchors retrieved directly from each Google NotebookLM notebook prior to cross-account synthesis.
        </p>
        <div class="raw-sources-grid">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  const printDoc = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(docTitle)} - ${escapeHtml(prompt || 'Synthesis')}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 16mm 18mm 16mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      background: #ffffff;
      line-height: 1.6;
      font-size: 10.5pt;
      margin: 0;
      padding: 0;
    }
    .print-header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .brand-title {
      font-size: 16pt;
      font-weight: 700;
      color: #1e3a8a;
      letter-spacing: -0.4px;
      margin: 0 0 3px 0;
    }
    .brand-subtitle {
      font-size: 8.5pt;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin: 0;
      font-weight: 600;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 22px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .meta-row {
      display: flex;
      margin-bottom: 6px;
      font-size: 9pt;
      line-height: 1.4;
    }
    .meta-row:last-child {
      margin-bottom: 0;
    }
    .meta-label {
      font-weight: 600;
      width: 140px;
      color: #475569;
      flex-shrink: 0;
    }
    .meta-value {
      color: #0f172a;
      flex: 1;
    }
    .chip {
      display: inline-block;
      background: #e0e7ff;
      color: #3730a3;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 500;
      margin-right: 5px;
      margin-bottom: 3px;
    }
    .badge-scope {
      display: inline-block;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
    }
    .badge-pro {
      display: inline-block;
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #93c5fd;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 8pt;
      font-weight: 600;
    }
    .section-badge {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #2563eb;
      background: #eff6ff;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid #bfdbfe;
      margin-bottom: 8px;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #0f172a;
      font-weight: 600;
      page-break-after: avoid;
      break-after: avoid;
    }
    h1 { font-size: 14pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 20px; margin-bottom: 10px; }
    h2 { font-size: 12.5pt; margin-top: 18px; margin-bottom: 8px; color: #1e40af; }
    h3 { font-size: 11pt; margin-top: 14px; margin-bottom: 6px; }
    p { margin: 0 0 9px 0; }
    ul, ol { margin: 0 0 10px 0; padding-left: 22px; }
    li { margin-bottom: 3px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 9pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 9px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      font-weight: 600;
      color: #334155;
    }
    tr:nth-child(even) td {
      background: #f8fafc;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 8.5pt;
      background: #f1f5f9;
      padding: 1.5px 4.5px;
      border-radius: 3px;
      color: #0f172a;
    }
    pre {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 10px 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 8pt;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    blockquote {
      margin: 10px 0;
      padding: 6px 12px;
      border-left: 3.5px solid #2563eb;
      background: #f8fafc;
      color: #334155;
      font-style: italic;
    }
    .appendix-page {
      page-break-before: always;
      break-before: page;
      margin-top: 28px;
      padding-top: 18px;
      border-top: 2px dashed #94a3b8;
    }
    .standalone-appendix {
      margin-top: 10px;
    }
    .appendix-title {
      font-size: 13pt;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 6px;
    }
    .appendix-desc {
      font-size: 8.5pt;
      color: #64748b;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .raw-card {
      background: #fbfcfe;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 16px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .raw-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .raw-card-title {
      font-weight: 700;
      font-size: 10.5pt;
      color: #1e3a8a;
    }
    .chip-profile {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 7.5pt;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .print-footer {
      margin-top: 28px;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      font-size: 8pt;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div>
      <div class="brand-title">${escapeHtml(docTitle)}</div>
      <div class="brand-subtitle">${escapeHtml(docSubtitle)}</div>
    </div>
    <div style="text-align: right; font-size: 8pt; color: #64748b;">
      <div>Generated: ${escapeHtml(timestamp || new Date().toLocaleString())}</div>
      <div style="margin-top: 3px; display: flex; gap: 4px; justify-content: flex-end;">
        <span class="badge-scope">${escapeHtml(scopeLabel)}</span>
        <span class="badge-pro">Pro AI: ${escapeHtml(synthesisModel || 'gemini-2.5-flash')}</span>
      </div>
    </div>
  </div>

  <div class="meta-box">
    <div class="meta-row">
      <div class="meta-label">Research Goal:</div>
      <div class="meta-value"><strong>${escapeHtml(prompt || 'Cross-Notebook Comparison')}</strong></div>
    </div>
    <div class="meta-row">
      <div class="meta-label">Queried Notebooks:</div>
      <div class="meta-value">
        ${(notebooks || []).map(nb => `<span class="chip">${escapeHtml(nb.profileId || 'default')}: ${escapeHtml(nb.title || nb.notebookId)}</span>`).join('')}
      </div>
    </div>
    <div class="meta-row">
      <div class="meta-label">Synthesis Engine:</div>
      <div class="meta-value">Google Pro AI (${escapeHtml(synthesisModel || 'gemini-2.5-flash')}) across ${(notebookResults || []).length} independent notebook RAG sources</div>
    </div>
  </div>

  ${briefHtml}

  ${rawSourcesSectionHtml}

  <div class="print-footer">
    <span>Super-NLM Hub • Unified Intelligence Dashboard</span>
    <span>Exported as PDF • Confidential Research Material</span>
  </div>
</body>
</html>
  `;

  let printFrame = document.getElementById('nlm-print-iframe');
  if (!printFrame) {
    printFrame = document.createElement('iframe');
    printFrame.id = 'nlm-print-iframe';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);
  }

  showToast(`Preparing PDF (${scopeLabel})...`, 'info');

  const frameDoc = printFrame.contentDocument || printFrame.contentWindow.document;
  frameDoc.open();
  frameDoc.write(printDoc);
  frameDoc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 400);
}

// ----------------- HELPERS & GOOGLE UX FLUIDITY ENGINE -----------------

function initGoogleRipple() {
  document.addEventListener('pointerdown', (e) => {
    // Skip inputs, textareas, or explicit opt-outs
    if (e.target.closest('input, textarea, select, .no-ripple')) return;

    const host = e.target.closest(
      '.m3-card, .m3-chip, .google-btn-primary, .google-btn-tonal, .google-btn-outlined, .m3-menu-item, button, .google-search-pill'
    );
    if (!host) return;

    host.classList.add('google-ripple-host');

    const rect = host.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height) * 2;
    const radius = size / 2;

    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - radius}px`;
    ripple.style.top = `${e.clientY - rect.top - radius}px`;
    ripple.className = 'google-ripple-effect';

    const prev = host.querySelector('.google-ripple-effect');
    if (prev) prev.remove();

    host.appendChild(ripple);

    const removeRipple = () => {
      ripple.style.opacity = '0';
      ripple.style.transition = 'opacity 0.3s cubic-bezier(0.2, 0, 0, 1)';
      setTimeout(() => {
        if (ripple.parentNode) ripple.remove();
      }, 300);
      window.removeEventListener('pointerup', removeRipple);
      window.removeEventListener('pointercancel', removeRipple);
    };

    window.addEventListener('pointerup', removeRipple, { once: true });
    window.addEventListener('pointercancel', removeRipple, { once: true });
    setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
    }, 600);
  });
}

function isModalOpen(id) {
  const modal = document.getElementById(id);
  return !!(modal && !modal.classList.contains('hidden'));
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  const dialog = modal.querySelector('.m3-dialog');
  if (dialog) {
    requestAnimationFrame(() => {
      dialog.classList.add('modal-open');
    });
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  const dialog = modal.querySelector('.m3-dialog');
  if (dialog) {
    dialog.classList.remove('modal-open');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      if (id === 'modal-chat') updateBackgroundQueryStatus();
    }, 240);
  } else {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (id === 'modal-chat') updateBackgroundQueryStatus();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function highlightMatch(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return escaped.replace(regex, '<mark class="bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)] rounded px-1 font-medium">$1</mark>');
}

function showToast(message, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-[var(--google-red-container)] border-[var(--google-red)]/40 text-[var(--google-red)]'
           : type === 'success' ? 'bg-[var(--google-green-container)] border-[var(--google-green)]/40 text-[var(--google-green)]'
           : 'bg-[var(--m3-surface-container-high)] border-[var(--m3-outline-variant)] text-[var(--m3-on-surface)]';
  const icon = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info';

  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full border text-xs font-medium shadow-2xl transition-all duration-300 transform translate-y-3 scale-95 opacity-0 ${bg}`;
  
  let actionHtml = '';
  if (action && action.label) {
    actionHtml = `<button type="button" class="toast-action-btn ml-2 px-2.5 py-1 rounded-full bg-[var(--google-blue)] text-white font-medium text-[11px] hover:opacity-90 shadow-sm transition cursor-pointer shrink-0">${escapeHtml(action.label)}</button>`;
  }

  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-3.5 h-3.5 shrink-0"></i>
    <span class="flex-1">${escapeHtml(message)}</span>
    ${actionHtml}
  `;

  if (action && action.onClick) {
    const actBtn = toast.querySelector('.toast-action-btn');
    if (actBtn) {
      actBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick();
        toast.remove();
      });
    }
  }

  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons({ root: toast });
  }

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-3', 'scale-95', 'opacity-0');
    toast.classList.add('translate-y-0', 'scale-100', 'opacity-100');
  });

  const duration = action ? 7000 : 4000;
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
    toast.classList.add('opacity-0', 'translate-y-3', 'scale-95');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

