// Super-NLM Hub Studio Frontend Application Logic
// Calibrated under design-taste-frontend standards: Variance 8, Motion 6, Density 4

let state = {
  profiles: [],
  notebooks: [],
  activeProfileFilter: 'all',
  activeCategoryFilter: 'all', // 'all' | 'study' | 'projects'
  searchQuery: '',
  selectedNotebooks: new Map(), // key: notebookId, value: { notebookId, profileId, title }
  lastSelectedNotebookId: null, // anchor notebook ID for Shift + click range selection (Windows Explorer pattern)
  activeChat: null, // { notebookId, profileId, title }
  chatHistories: new Map(), // key: notebookId, value: array of message objects
  conversationIds: new Map(), // key: notebookId, value: conversationId
  activeQueries: new Map(), // key: notebookId, value: { notebookId, profileId, title, question, startTime }
  calendarAgenda: null,
  fleetUsage: null,
  fleetUsageTimestamp: 0,
  isUsageLoading: false,
  isLoading: false,
  editingProfileId: null,
  folderMappings: {}, // key: notebookId, value: FolderMapping
  activeFolderNotebookId: null,
  activeFolderStatus: null,
  isFolderSyncing: false,
  chatDrafts: new Map(), // key: notebookId, value: draft message string
  crossSynthesis: {
    prompt: '',
    inFlight: false,
    startTime: null,
    timerInterval: null,
    selectedNotebooks: [],
    data: null,
    error: null,
  },
};

function saveCrossSynthesisToSession() {
  try {
    const payload = {
      prompt: state.crossSynthesis.prompt || '',
      selectedNotebooks: state.crossSynthesis.selectedNotebooks || [],
      data: state.crossSynthesis.data || null,
      error: state.crossSynthesis.error || null
    };
    sessionStorage.setItem('super_nlm_cross_synthesis', JSON.stringify(payload));
  } catch (e) {}
}

function loadCrossSynthesisFromSession() {
  try {
    const saved = sessionStorage.getItem('super_nlm_cross_synthesis');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed) {
        state.crossSynthesis.prompt = parsed.prompt || '';
        state.crossSynthesis.selectedNotebooks = parsed.selectedNotebooks || [];
        state.crossSynthesis.data = parsed.data || null;
        state.crossSynthesis.error = parsed.error || null;
      }
    }
  } catch (e) {}
}

loadCrossSynthesisFromSession();

// ----------------- COURSE & STUDY CLASSIFICATION -----------------
const COURSE_NOTEBOOK_IDS = new Set([
  '96a12a04-073e-43ca-9f6d-ca0048d63486', // CT653 - Artificial Intelligence (test mock / canonical)
  'c4a8af46-115b-4dff-81bf-5a22db2fbc64', // CT653 - Artificial Intelligence (live cache)
  'c627a211-552e-496b-9ebb-42d22ac05a95', // EX751 - Wireless Communications
  '66c34505-a60d-4a24-98df-446d8df12a24', // CT704 - Digital Signal Analysis and Processing
  'c3c8ecd4-2884-42a1-aa49-c4de168c1ec7', // EX752 - RF and Microwave Engineering
  '94cd4e14-802d-4231-b27d-6a4f4a2e6182', // ME708 - Organization and Management
  '56cdad30-13d3-4621-a0b7-8f841858476b', // EX725 04 - Aeronautical Telecommunication - Elective I
]);

const DEFAULT_COURSE_NOTEBOOK_MAP = {
  'CT653': '96a12a04-073e-43ca-9f6d-ca0048d63486',
  'AI': '96a12a04-073e-43ca-9f6d-ca0048d63486',
  'EX751': 'c627a211-552e-496b-9ebb-42d22ac05a95',
  'WC': 'c627a211-552e-496b-9ebb-42d22ac05a95',
  'CT704': '66c34505-a60d-4a24-98df-446d8df12a24',
  'DSAP': '66c34505-a60d-4a24-98df-446d8df12a24',
  'EX752': 'c3c8ecd4-2884-42a1-aa49-c4de168c1ec7',
  'RF': 'c3c8ecd4-2884-42a1-aa49-c4de168c1ec7',
  'ME708': '94cd4e14-802d-4231-b27d-6a4f4a2e6182',
  'OM': '94cd4e14-802d-4231-b27d-6a4f4a2e6182',
  'O&M': '94cd4e14-802d-4231-b27d-6a4f4a2e6182',
  'EX725': '56cdad30-13d3-4621-a0b7-8f841858476b',
  'EX725 04': '56cdad30-13d3-4621-a0b7-8f841858476b',
  'EX72504': '56cdad30-13d3-4621-a0b7-8f841858476b',
  'AERO': '56cdad30-13d3-4621-a0b7-8f841858476b',
  'ELECTIVE I': '56cdad30-13d3-4621-a0b7-8f841858476b',
  'ELECTIVE 1': '56cdad30-13d3-4621-a0b7-8f841858476b',
};

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

// ----------------- SIDEBAR COLLAPSE CONTROLLER -----------------
const SIDEBAR_COLLAPSED_KEY = 'supernlm_sidebar_collapsed';

function initSidebarState() {
  const isCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  applySidebarCollapsed(isCollapsed, false);
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('workspace-sidebar');
  if (!sidebar) return;
  const willCollapse = !sidebar.classList.contains('collapsed');
  applySidebarCollapsed(willCollapse, true);
  showToast(willCollapse ? 'Left panel collapsed (shortcut: [)' : 'Left panel expanded (shortcut: [)', 'info');
}

function applySidebarCollapsed(collapsed, save = true) {
  const sidebar = document.getElementById('workspace-sidebar');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const toggleIcon = document.getElementById('sidebar-toggle-icon');
  if (save) {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  }
  if (!sidebar) return;

  if (collapsed) {
    sidebar.classList.add('collapsed');
    if (toggleBtn) toggleBtn.classList.add('active');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left-open');
  } else {
    sidebar.classList.remove('collapsed');
    if (toggleBtn) toggleBtn.classList.remove('active');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left');
  }
  if (window.lucide) lucide.createIcons();
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSidebarState();
  initGoogleRipple();
  loadAllChatHistories();
  setupEventListeners();
  renderAccountPills();
  renderCategoryChips();
  showSkeletons(true);
  await loadProfiles();
  await loadNotebooks();
  await loadCalendarAgenda();
  loadFleetUsage(false);
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
      // Ctrl + A / Cmd + A: Select all visible notebooks (Windows File Explorer pattern)
      if (e.key.toLowerCase() === 'a' && !isInputActive) {
        e.preventDefault();
        toggleSelectAllVisible();
        return;
      }
      return;
    }

    // Ignore when Alt is pressed
    if (e.altKey) return;

    // 2. Escape: Closes open modal / clears search input / clears selection
    if (e.key === 'Escape') {
      const openModalIds = ['modal-shortcuts', 'modal-chat', 'modal-accounts', 'modal-cross', 'modal-batch-share', 'modal-usage', 'modal-scheduler', 'modal-folder-mapping'];
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
    const anyModalOpen = ['modal-chat', 'modal-accounts', 'modal-cross', 'modal-shortcuts', 'modal-batch-share', 'modal-usage'].some(id => isModalOpen(id));
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

    // Shortcut 'q' or 'l': Toggle Account Usage & Quota Limits
    if ((e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'l') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (isModalOpen('modal-usage')) {
        closeModal('modal-usage');
      } else {
        openUsageLimitsModal();
      }
      return;
    }

    // Shortcut 'g' (without Shift/Ctrl): Toggle Today's Agenda strip collapse
    if (e.key.toLowerCase() === 'g' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleAgendaCollapse();
      return;
    }

    // Shortcut '[' (without Shift/Ctrl): Toggle Left Sidebar
    if (e.key === '[' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleSidebarCollapse();
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
  ['modal-shortcuts', 'modal-chat', 'modal-accounts', 'modal-cross', 'modal-batch-share'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          if (id === 'modal-cross' && state.crossSynthesis && state.crossSynthesis.inFlight) {
            showToast('Cross synthesis is continuing in background. Click Cross Synthesis to reopen.', 'info');
          } else if (id === 'modal-chat' && state.activeChat && state.activeQueries.has(state.activeChat.notebookId)) {
            showToast('Query is generating in background. Click Query Notebook to reopen.', 'info');
          }
          closeModal(id);
        }
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
      
      const copySuccess = () => {
        copyBtn.innerHTML = '<i data-lucide="check" class="w-3 h-3 text-[var(--google-green)]"></i> <span class="text-[var(--google-green)] font-medium">Copied!</span>';
        if (window.lucide) lucide.createIcons();
        showToast('Response copied to clipboard', 'success');
        setTimeout(() => {
          copyBtn.innerHTML = '<i data-lucide="copy" class="w-3 h-3"></i> <span>Copy</span>';
          if (window.lucide) lucide.createIcons();
        }, 2000);
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(content).then(copySuccess).catch(() => {
          fallbackCopyText(content, copySuccess);
        });
      } else {
        fallbackCopyText(content, copySuccess);
      }
    });
  }

  // Sync All button
  const syncBtn = document.getElementById('btn-sync');
  if (syncBtn) syncBtn.addEventListener('click', handleSyncAll);

  // Empty state sync button
  const emptySyncBtn = document.getElementById('btn-empty-sync');
  if (emptySyncBtn) emptySyncBtn.addEventListener('click', handleSyncAll);

  // Sidebar toggle buttons
  const sidebarToggleBtn = document.getElementById('btn-toggle-sidebar');
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', toggleSidebarCollapse);
  }

  const sidebarCollapseChevron = document.getElementById('btn-sidebar-collapse-chevron');
  if (sidebarCollapseChevron) {
    sidebarCollapseChevron.addEventListener('click', toggleSidebarCollapse);
  }

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

  // Sidebar telemetry accounts trigger
  const telemetryAccountsBtn = document.getElementById('btn-telemetry-accounts');
  if (telemetryAccountsBtn) {
    telemetryAccountsBtn.addEventListener('click', () => {
      openModal('modal-accounts');
      renderAccountsModalList();
    });
  }

  // Sidebar manage accounts trigger
  const sidebarManageAccountsBtn = document.getElementById('btn-sidebar-manage-accounts');
  if (sidebarManageAccountsBtn) {
    sidebarManageAccountsBtn.addEventListener('click', () => {
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

  // Account Usage Limits Modal triggers
  const openUsageBtn = document.getElementById('btn-open-usage-modal');
  if (openUsageBtn) openUsageBtn.addEventListener('click', openUsageLimitsModal);

  const sidebarFleetQuotaCard = document.getElementById('sidebar-fleet-quota-card');
  if (sidebarFleetQuotaCard) sidebarFleetQuotaCard.addEventListener('click', openUsageLimitsModal);

  const refreshUsageBtn = document.getElementById('btn-refresh-usage');
  if (refreshUsageBtn) refreshUsageBtn.addEventListener('click', () => loadFleetUsage(true));

  const closeUsageBtn = document.getElementById('close-modal-usage');
  if (closeUsageBtn) closeUsageBtn.addEventListener('click', () => closeModal('modal-usage'));

  const closeUsageFooterBtn = document.getElementById('btn-close-usage-footer');
  if (closeUsageFooterBtn) closeUsageFooterBtn.addEventListener('click', () => closeModal('modal-usage'));

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
    chatInput.addEventListener('input', () => {
      if (state.activeChat && state.activeChat.notebookId) {
        state.chatDrafts.set(state.activeChat.notebookId, chatInput.value);
      }
    });
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
  const resetCrossBtn = document.getElementById('btn-reset-cross');
  if (resetCrossBtn) resetCrossBtn.addEventListener('click', handleResetCrossSynthesis);
  const synthSelectedBtn = document.getElementById('btn-synthesize-selected');
  if (synthSelectedBtn) synthSelectedBtn.addEventListener('click', openCrossSynthesisModal);
  const clearSelectionBtn = document.getElementById('btn-clear-selection');
  if (clearSelectionBtn) clearSelectionBtn.addEventListener('click', clearSelection);
  const runCrossBtn = document.getElementById('btn-run-cross-synthesis');
  if (runCrossBtn) runCrossBtn.addEventListener('click', handleRunCrossSynthesis);
  const crossPromptInput = document.getElementById('cross-prompt-input');
  if (crossPromptInput) {
    crossPromptInput.addEventListener('input', () => {
      state.crossSynthesis.prompt = crossPromptInput.value;
      saveCrossSynthesisToSession();
    });
    crossPromptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRunCrossSynthesis();
      }
    });
  }

  // Batch Share Modal Listeners
  const openBatchShareBtn = document.getElementById('btn-open-batch-share-modal');
  if (openBatchShareBtn) openBatchShareBtn.addEventListener('click', openBatchShareModal);
  const shareSelectedBtn = document.getElementById('btn-share-selected');
  if (shareSelectedBtn) shareSelectedBtn.addEventListener('click', openBatchShareModal);
  const closeBatchShareBtn = document.getElementById('close-modal-batch-share');
  if (closeBatchShareBtn) closeBatchShareBtn.addEventListener('click', () => closeModal('modal-batch-share'));
  const cancelBatchShareBtn = document.getElementById('btn-cancel-batch-share');
  if (cancelBatchShareBtn) cancelBatchShareBtn.addEventListener('click', () => closeModal('modal-batch-share'));
  const execBatchShareBtn = document.getElementById('btn-execute-batch-share');
  if (execBatchShareBtn) execBatchShareBtn.addEventListener('click', handleExecuteBatchShare);

  const presetStudyBtn = document.getElementById('btn-batch-share-preset-study');
  if (presetStudyBtn) {
    presetStudyBtn.addEventListener('click', () => {
      batchShareSelectedNotebookIds.clear();
      state.notebooks.forEach(nb => {
        if (isStudyNotebook(nb)) batchShareSelectedNotebookIds.add(nb.id);
      });
      renderBatchShareNotebooksList();
      updateBatchShareCounts();
    });
  }

  const selectAllNbBtn = document.getElementById('btn-batch-share-select-all-nb');
  if (selectAllNbBtn) {
    selectAllNbBtn.addEventListener('click', () => {
      state.notebooks.forEach(nb => batchShareSelectedNotebookIds.add(nb.id));
      renderBatchShareNotebooksList();
      updateBatchShareCounts();
    });
  }

  const clearNbBtn = document.getElementById('btn-batch-share-clear-nb');
  if (clearNbBtn) {
    clearNbBtn.addEventListener('click', () => {
      batchShareSelectedNotebookIds.clear();
      renderBatchShareNotebooksList();
      updateBatchShareCounts();
    });
  }

  const toggleAllAccountsBtn = document.getElementById('btn-batch-share-toggle-all-accounts');
  if (toggleAllAccountsBtn) {
    toggleAllAccountsBtn.addEventListener('click', () => {
      const nonMainProfiles = state.profiles.filter(p => p.id !== 'main');
      const allSelected = nonMainProfiles.every(p => batchShareSelectedProfileIds.has(p.id));
      if (allSelected) {
        batchShareSelectedProfileIds.clear();
      } else {
        nonMainProfiles.forEach(p => batchShareSelectedProfileIds.add(p.id));
      }
      renderBatchShareAccountsList();
      updateBatchShareCounts();
    });
  }

  // Google Calendar Agenda Listeners
  const refreshAgendaBtn = document.getElementById('btn-refresh-agenda');
  if (refreshAgendaBtn) {
    refreshAgendaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadCalendarAgenda(true);
    });
  }

  const collapseAgendaBtn = document.getElementById('btn-toggle-agenda-collapse');
  if (collapseAgendaBtn) {
    collapseAgendaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAgendaCollapse();
    });
  }

  const headerToggle = document.getElementById('agenda-header-toggle');
  if (headerToggle) {
    headerToggle.addEventListener('click', () => toggleAgendaCollapse());
  }

  const toggleUpcomingBtn = document.getElementById('btn-toggle-upcoming-events');
  if (toggleUpcomingBtn) {
    toggleUpcomingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUpcomingEvents();
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
  ['modal-accounts', 'modal-chat', 'modal-cross', 'modal-shortcuts', 'modal-batch-share', 'modal-usage', 'modal-scheduler', 'modal-folder-mapping'].forEach(id => {
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

// ----------------- AUTHENTICATION ALERT & HEALTH BANNER -----------------

function renderAuthAlertBanner() {
  const container = document.getElementById('auth-alert-container');
  if (!container) return;

  const expiredProfiles = state.profiles.filter(p => p.status === 'expired' || p.status === 'not_logged_in');

  if (expiredProfiles.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="auth-alert-banner p-4 relative overflow-hidden animate-m3-enter">
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        
        <div class="flex items-start gap-3 min-w-0">
          <div class="p-2.5 rounded-2xl bg-[var(--google-red-container)] text-[var(--google-red)] shrink-0 mt-0.5 md:mt-0 shadow-sm">
            <i data-lucide="alert-triangle" class="w-5 h-5"></i>
          </div>
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--google-red)] flex items-center gap-1.5">
                <span>Google Session Expired</span>
                <span class="px-2 py-0.2 rounded-full bg-[var(--google-red-container)] text-[var(--google-red-on-container)] font-mono text-[10px]">
                  ${expiredProfiles.length} ${expiredProfiles.length === 1 ? 'Account' : 'Accounts'} Need Relogin
                </span>
              </h3>
            </div>
            <p class="text-xs text-[var(--m3-on-surface)] leading-relaxed">
              Notebooks from <strong class="text-[var(--google-red)]">${expiredProfiles.map(p => escapeHtml(p.displayName || p.id) + (p.email ? ` (${escapeHtml(p.email)})` : '')).join(', ')}</strong> cannot be displayed or queried because Google authentication has expired.
            </p>
            ${expiredProfiles.some(p => p.lastError) ? `
              <p class="text-[11px] font-mono text-[var(--m3-on-surface-subtle)] bg-[var(--m3-surface-container-low)] px-2.5 py-1 rounded-lg border border-[var(--m3-outline-variant)]/60 truncate max-w-2xl" title="${escapeHtml(expiredProfiles.map(p => `${p.displayName}: ${p.lastError || ''}`).join(' | '))}">
                Error: ${escapeHtml(expiredProfiles.map(p => `${p.displayName}: ${p.lastError || 'Session expired or missing cookies'}`).join(' • '))}
              </p>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end md:self-center w-full md:w-auto justify-end pt-2 md:pt-0 border-t md:border-t-0 border-[var(--m3-outline-variant)]/40 flex-wrap">
          ${expiredProfiles.map(p => `
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

  if (window.lucide) lucide.createIcons({ root: container });
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
      renderAuthAlertBanner();
      renderAccountPills();
    }
  } catch (err) {
    console.error('Failed to load profiles:', err);
  } finally {
    setGlobalLoading(false);
  }
}

async function loadFolderMappings() {
  try {
    const res = await fetch('/api/folders/mappings');
    if (res.ok) {
      state.folderMappings = await res.json();
    }
  } catch (err) {
    console.warn('Failed to load folder mappings:', err);
  }
}

async function loadNotebooks() {
  setGlobalLoading(true);
  try {
    const [nbRes] = await Promise.all([
      fetch('/api/notebooks'),
      loadFolderMappings()
    ]);
    if (nbRes.ok) {
      state.notebooks = await nbRes.json();
      
      const telemetryNotebooks = document.getElementById('telemetry-notebooks');
      if (telemetryNotebooks) telemetryNotebooks.textContent = new Set(state.notebooks.map(n => n.id)).size;

      renderAuthAlertBanner();
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

    renderAuthAlertBanner();
    renderAccountPills();
    renderCategoryChips();
    renderNotebooksGrid();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    const expiredProfiles = state.profiles.filter(p => p.status === 'expired' || p.status === 'not_logged_in');
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
    const isExpired = p.status === 'expired' || p.status === 'not_logged_in';
    const count = state.notebooks.filter(n => n.profileId === p.id).length;
    const pill = createPill({
      id: p.id,
      label: p.displayName || p.id,
      count: count,
      color: p.color,
      isActive: state.activeProfileFilter === p.id,
      isPro: p.isDefaultPro || p.tier === 'pro',
      isExpired: isExpired,
      email: p.email,
      lastError: p.lastError
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

  // Synchronize sidebar accounts list
  renderSidebarAccounts();

  if (window.lucide) lucide.createIcons();
}

function renderSidebarAccounts() {
  const listEl = document.getElementById('sidebar-accounts-list');
  if (!listEl) return;

  if (state.profiles.length === 0) {
    listEl.innerHTML = `
      <div class="h-8 rounded-xl google-skeleton"></div>
      <div class="h-8 rounded-xl google-skeleton"></div>
    `;
    return;
  }

  const uniqueNotebookCount = new Set(state.notebooks.map(n => n.id)).size;

  let html = `
    <button
      type="button"
      data-filter="all"
      class="sidebar-account-btn w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition cursor-pointer ${
        state.activeProfileFilter === 'all'
          ? 'bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)] font-medium'
          : 'hover:bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-variant)]'
      }"
    >
      <div class="flex items-center gap-2 min-w-0">
        <i data-lucide="users" class="w-3.5 h-3.5 shrink-0 ${state.activeProfileFilter === 'all' ? 'text-[var(--google-blue)]' : 'text-[var(--m3-on-surface-subtle)]'}"></i>
        <span class="truncate">All Accounts</span>
      </div>
      <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard font-mono shrink-0 ${state.activeProfileFilter === 'all' ? 'text-[var(--google-blue-on-container)]' : 'text-[var(--m3-on-surface-subtle)]'}">${uniqueNotebookCount}</span>
    </button>
  `;

  state.profiles.forEach(p => {
    const isExpired = p.status === 'expired' || p.status === 'not_logged_in';
    const count = state.notebooks.filter(n => n.profileId === p.id).length;
    const isActive = state.activeProfileFilter === p.id;
    const isPro = p.isDefaultPro || p.tier === 'pro';

    html += `
      <button
        type="button"
        data-filter="${escapeHtml(p.id)}"
        class="sidebar-account-btn w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs transition cursor-pointer ${
          isExpired
            ? 'border border-[var(--google-red)]/40 bg-[var(--google-red-container)]/10 text-[var(--m3-on-surface)]'
            : (isActive
              ? 'bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)] font-medium'
              : 'hover:bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-variant)]')
        }"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          ${isExpired ? `
            <span class="w-2.5 h-2.5 rounded-full shrink-0 bg-[var(--google-red)] pulse-dot-red"></span>
          ` : `
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${p.color || '#8ab4f8'};"></span>
          `}
          <span class="truncate text-left ${isExpired ? 'text-[var(--google-red)] font-medium' : ''}" title="${escapeHtml(p.displayName || p.id)} (${escapeHtml(p.email || '')})${isExpired ? ' - ⚠️ Auth Expired! Click to relogin' : ''}">${escapeHtml(p.displayName || p.id)}</span>
          ${isExpired ? `
            <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[var(--google-red-container)] text-[var(--google-red)] border border-[var(--google-red)]/30 shrink-0 flex items-center gap-0.5" title="Google session expired">
              <i data-lucide="alert-triangle" class="w-2.5 h-2.5"></i> EXPIRED
            </span>
          ` : (isPro ? `
            <span class="text-[9px] font-medium px-1 py-0.2 rounded bg-[var(--google-yellow-container)] text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 shrink-0">PRO</span>
          ` : '')}
        </div>
        <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard font-mono shrink-0 ml-1.5 ${isExpired ? 'text-[var(--google-red)] font-bold' : (isActive ? 'text-[var(--google-blue-on-container)]' : 'text-[var(--m3-on-surface-subtle)]')}">${count}</span>
      </button>
    `;
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll('.sidebar-account-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter');
      state.activeProfileFilter = filter;
      renderAccountPills();
      renderNotebooksGrid();
      const name = filter === 'all' ? 'All Accounts' : (state.profiles.find(x => x.id === filter)?.displayName || filter);
      showToast(`Filter: ${name}`, 'info');
    });
  });
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

function createPill({ id, label, count, color, isActive, isPro, isExpired, email, lastError }) {
  const btn = document.createElement('button');
  const baseClasses = 'm3-chip flex items-center gap-2 px-3.5 py-1.5 text-xs transition whitespace-nowrap cursor-pointer';
  const activeClasses = isActive ? 'active' : 'hover:text-[var(--m3-on-surface)]';
  const expiredClasses = isExpired ? 'auth-expired-pill border-[var(--google-red)]/50 text-[var(--google-red)]' : '';

  btn.className = `${baseClasses} ${activeClasses} ${expiredClasses}`;
  if (isExpired) {
    btn.title = `⚠️ Auth Expired for ${label} (${email || ''})${lastError ? ` - ${lastError}` : ''}. Click to filter or relogin.`;
  }
  
  let dotHtml = '';
  if (isExpired) {
    dotHtml = `<span class="w-2 h-2 rounded-full shrink-0 bg-[var(--google-red)] pulse-dot-red"></span>`;
  } else if (color) {
    dotHtml = `<span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color};"></span>`;
  }

  let badgeHtml = '';
  if (isExpired) {
    badgeHtml = `<span class="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-[var(--google-red-container)] text-[var(--google-red)] border border-[var(--google-red)]/30 flex items-center gap-0.5"><i data-lucide="alert-circle" class="w-2.5 h-2.5"></i> EXPIRED</span>`;
  } else if (isPro) {
    badgeHtml = `<span class="text-[9px] font-medium px-1.5 py-0.2 rounded-full bg-[var(--google-yellow-container)] text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 flex items-center gap-1"><i data-lucide="sparkles" class="w-2.5 h-2.5 text-[var(--google-yellow)]"></i> PRO</span>`;
  }

  btn.innerHTML = `
    ${dotHtml}
    <span class="tracking-tight">${escapeHtml(label)}</span>
    ${badgeHtml}
    <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard font-mono ${isExpired ? 'text-[var(--google-red)] font-bold' : 'text-[var(--m3-on-surface-subtle)]'}">${count}</span>
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

function syncSelectionUI() {
  const grid = document.getElementById('notebooks-grid');
  if (grid) {
    const cards = grid.querySelectorAll('.m3-card');
    cards.forEach(card => {
      const cb = card.querySelector('.notebook-select-checkbox');
      const id = card.getAttribute('data-id') || (cb ? cb.getAttribute('data-id') : null);
      if (!id) return;
      const isSelected = state.selectedNotebooks.has(id);
      card.classList.toggle('selected', isSelected);
      if (cb) {
        cb.checked = isSelected;
      }
    });
  }
  updateSelectionBanner();
}

function handleNotebookSelection(clickedNotebookId, event, isDirectCheckbox = false) {
  const visible = getVisibleNotebooks();
  const clickedNotebook = visible.find(n => n.id === clickedNotebookId) || state.notebooks.find(n => n.id === clickedNotebookId);
  if (!clickedNotebook) return;

  const isCtrl = event.ctrlKey || event.metaKey;
  const isShift = event.shiftKey;

  // Clear any unwanted text selection highlighting triggered by Shift + click
  if (isShift && window.getSelection) {
    try {
      window.getSelection().removeAllRanges();
    } catch (_) {}
  }

  if (isShift) {
    // Windows File Explorer Range Selection (Shift + Click)
    const anchorId = state.lastSelectedNotebookId;
    let anchorIdx = visible.findIndex(n => n.id === anchorId);
    const currentIdx = visible.findIndex(n => n.id === clickedNotebookId);

    // If anchor is missing or not visible in current filtered view, default to index 0
    if (anchorIdx === -1) {
      anchorIdx = 0;
    }

    if (currentIdx !== -1) {
      const start = Math.min(anchorIdx, currentIdx);
      const end = Math.max(anchorIdx, currentIdx);

      // If Ctrl is not pressed, clear selection outside of this range (standard Windows Explorer behavior)
      if (!isCtrl) {
        state.selectedNotebooks.clear();
      }

      for (let i = start; i <= end; i++) {
        const item = visible[i];
        state.selectedNotebooks.set(item.id, {
          notebookId: item.id,
          profileId: item.profileId,
          title: item.title || 'Untitled Notebook'
        });
      }

      // In Windows Explorer, the anchor remains at the original item during Shift-click
      if (!state.lastSelectedNotebookId) {
        state.lastSelectedNotebookId = visible[anchorIdx]?.id || clickedNotebookId;
      }
    }
  } else if (isCtrl) {
    // Ctrl + Click: Toggle individual notebook selection
    if (state.selectedNotebooks.has(clickedNotebookId)) {
      state.selectedNotebooks.delete(clickedNotebookId);
    } else {
      state.selectedNotebooks.set(clickedNotebookId, {
        notebookId: clickedNotebook.id,
        profileId: clickedNotebook.profileId,
        title: clickedNotebook.title || 'Untitled Notebook'
      });
    }
    state.lastSelectedNotebookId = clickedNotebookId;
  } else if (isDirectCheckbox) {
    // Direct checkbox click without Ctrl or Shift: toggle this item
    if (state.selectedNotebooks.has(clickedNotebookId)) {
      state.selectedNotebooks.delete(clickedNotebookId);
    } else {
      state.selectedNotebooks.set(clickedNotebookId, {
        notebookId: clickedNotebook.id,
        profileId: clickedNotebook.profileId,
        title: clickedNotebook.title || 'Untitled Notebook'
      });
    }
    state.lastSelectedNotebookId = clickedNotebookId;
  } else {
    // Normal single click on card (no Ctrl, no Shift): select ONLY this notebook
    state.selectedNotebooks.clear();
    state.selectedNotebooks.set(clickedNotebookId, {
      notebookId: clickedNotebook.id,
      profileId: clickedNotebook.profileId,
      title: clickedNotebook.title || 'Untitled Notebook'
    });
    state.lastSelectedNotebookId = clickedNotebookId;
  }

  syncSelectionUI();
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
    state.lastSelectedNotebookId = null;
    showToast(`Deselected ${visible.length} notebook${visible.length > 1 ? 's' : ''}`, 'info');
  } else {
    visible.forEach(n => {
      state.selectedNotebooks.set(n.id, {
        notebookId: n.id,
        profileId: n.profileId,
        title: n.title || 'Untitled Notebook'
      });
    });
    state.lastSelectedNotebookId = visible[visible.length - 1]?.id || null;
    showToast(`Selected ${visible.length} notebook${visible.length > 1 ? 's' : ''}`, 'info');
  }
  syncSelectionUI();
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

    const activeProfile = state.activeProfileFilter !== 'all' ? state.profiles.find(x => x.id === state.activeProfileFilter) : null;
    const isFilteredExpired = activeProfile && (activeProfile.status === 'expired' || activeProfile.status === 'not_logged_in');

    if (isFilteredExpired) {
      emptyState.innerHTML = `
        <div class="w-14 h-14 rounded-2xl bg-[var(--google-red-container)] text-[var(--google-red)] flex items-center justify-center shadow-sm">
          <i data-lucide="alert-triangle" class="w-7 h-7"></i>
        </div>
        <div class="space-y-1.5 max-w-md">
          <h3 class="text-sm font-bold text-[var(--google-red)]">Authentication Expired for ${escapeHtml(activeProfile.displayName || activeProfile.id)}</h3>
          <p class="text-xs text-[var(--m3-on-surface-variant)] leading-relaxed">
            Google session for <strong class="font-mono text-[var(--m3-on-surface)]">${escapeHtml(activeProfile.email || activeProfile.id)}</strong> has expired. Notebooks cannot be loaded until you re-authenticate.
          </p>
          ${activeProfile.lastError ? `
            <p class="text-[11px] font-mono text-[var(--google-red)] bg-[var(--m3-surface-container)] p-2.5 rounded-xl border border-[var(--google-red)]/30 text-left">
              ${escapeHtml(activeProfile.lastError)}
            </p>
          ` : ''}
        </div>
        <div class="flex items-center gap-2 pt-2">
          <button onclick="handleTriggerLogin('${escapeHtml(activeProfile.id)}')" class="google-btn-primary bg-[var(--google-red)] hover:bg-[var(--google-red)]/90 text-white px-4 py-2 text-xs flex items-center gap-1.5 cursor-pointer shadow-sm">
            <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
            <span>Re-login to ${escapeHtml(activeProfile.displayName || activeProfile.id)}</span>
          </button>
          <button onclick="handleSyncAll()" class="google-btn-outlined px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span>Retry Sync</span>
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ root: emptyState });
    } else {
      emptyState.innerHTML = `
        <div class="w-12 h-12 rounded-full m3-subcard flex items-center justify-center text-[var(--m3-on-surface-subtle)]">
          <i data-lucide="book-open" class="w-5 h-5"></i>
        </div>
        <div class="space-y-1 max-w-sm">
          <h3 class="text-sm font-medium text-[var(--m3-on-surface)]">No notebooks found</h3>
          <p class="text-xs text-[var(--m3-on-surface-subtle)] leading-relaxed">No notebooks match your current search query or active account filter.</p>
        </div>
        <button id="btn-empty-sync" onclick="handleSyncAll()" class="google-btn-outlined px-4 py-1.5 text-xs cursor-pointer">
          Sync Notebooks Now
        </button>
      `;
      if (window.lucide) lucide.createIcons({ root: emptyState });
    }
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
    const mapping = (state.folderMappings && state.folderMappings[notebook.id]) || null;

    return `
      <div 
        class="m3-card animate-m3-stagger p-5 flex flex-col justify-between group relative overflow-hidden cursor-pointer ${isSelected ? 'selected' : ''}"
        data-id="${notebook.id}"
        style="animation-delay: ${Math.min(idx * 20, 200)}ms;"
      >
        
        <!-- Top row: Selection Checkbox, Account Tag, Course Badge, Pro Tier Badge -->
        <div class="flex items-center justify-between gap-2 mb-3 min-w-0">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <input
              type="checkbox"
              data-id="${notebook.id}"
              data-profile="${notebook.profileId}"
              data-title="${escapeHtml(notebook.title)}"
              class="notebook-select-checkbox rounded bg-[var(--m3-surface)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer w-4 h-4 shrink-0 transition-transform active:scale-95"
              ${isSelected ? 'checked' : ''}
            >
            ${notebook.allProfiles && notebook.allProfiles.length > 1 ? `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)] min-w-0 max-w-full" title="${escapeHtml(notebook.allProfiles.map(p => p.profileName || p.profileId).join(' • '))}">
                <span class="flex items-center -space-x-1 shrink-0">
                  ${notebook.allProfiles.map(p => `<span class="w-2 h-2 rounded-full border border-[var(--m3-surface)]" style="background-color: ${p.color || '#3b82f6'}"></span>`).join('')}
                </span>
                <span class="truncate max-w-[85px] sm:max-w-[110px]">${escapeHtml(notebook.profileName)}</span>
                <span class="text-[10px] text-[var(--google-blue)] font-medium font-mono bg-[var(--google-blue-container)]/50 px-1.5 py-0.2 rounded shrink-0" title="Shared across ${notebook.allProfiles.length} accounts">+${notebook.allProfiles.length - 1}</span>
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)] min-w-0 max-w-full">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${notebook.color}"></span>
                <span class="truncate max-w-[110px] sm:max-w-[140px]">${escapeHtml(notebook.profileName)}</span>
              </span>
            `}
          </div>

          <div class="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            ${isStudy && courseCode ? `
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-blue-container)]/70 text-[var(--google-blue)] border border-[var(--google-blue)]/30 font-mono tracking-tight shrink-0" title="Academic Course NLM: ${escapeHtml(courseCode)}">
                <i data-lucide="graduation-cap" class="w-3 h-3 text-[var(--google-blue)] shrink-0"></i> ${escapeHtml(courseCode)}
              </span>
            ` : ''}

            ${isPro ? `
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-yellow-container)]/50 text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 shrink-0">
                <i data-lucide="sparkles" class="w-3 h-3 text-[var(--google-yellow)] shrink-0"></i> PRO AI
              </span>
            ` : `
              <span class="text-[10px] font-mono text-[var(--m3-on-surface-subtle)] shrink-0">${escapeHtml(notebook.profileId)}</span>
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

          <div class="flex items-center gap-1.5 shrink-0">
            <!-- Folder Sync Button -->
            <button
              type="button"
              data-id="${notebook.id}"
              data-title="${escapeHtml(notebook.title)}"
              title="${mapping ? `Mapped to ${escapeHtml(mapping.display_name || mapping.target_path)}` : 'Map Course Folder or Google Drive'}"
              class="btn-open-folder-modal google-btn-outlined flex items-center gap-1 text-xs py-1 px-2.5 cursor-pointer ${mapping ? 'text-[var(--google-blue)] border-[var(--google-blue)]/40 bg-[var(--google-blue-container)]/10 font-medium' : 'text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)]'}"
            >
              <i data-lucide="${mapping ? (mapping.folder_type === 'drive_web' ? 'cloud' : 'folder-check') : 'folder'}" class="w-3 h-3"></i>
              <span>${mapping ? 'Folder' : 'Map'}</span>
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

  // Wire up Folder modal button listeners
  grid.querySelectorAll('.btn-open-folder-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      const title = e.currentTarget.getAttribute('data-title');
      if (window.openFolderMappingModal) {
        window.openFolderMappingModal(id, title);
      }
    });
  });

  // Wire up checkbox click listeners (Windows Explorer checkbox toggling + Shift-click support)
  grid.querySelectorAll('.notebook-select-checkbox').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = cb.getAttribute('data-id');
      handleNotebookSelection(id, e, true);
    });
  });

  // Card click: Windows File Explorer selection paradigm
  // - Click: Selects only this item (clears other selections)
  // - Ctrl + Click: Toggles individual item selection (multi-select)
  // - Shift + Click: Selects continuous range from anchor to clicked item
  // - Double-click: Quick query
  grid.querySelectorAll('.m3-card').forEach(card => {
    card.addEventListener('mousedown', (e) => {
      if (e.shiftKey) {
        // Prevent default browser text selection highlighting during Shift + click
        e.preventDefault();
      }
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, label')) return;
      const id = card.getAttribute('data-id');
      if (id) {
        handleNotebookSelection(id, e, false);
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
  state.lastSelectedNotebookId = null;
  syncSelectionUI();
}

// ----------------- ACCOUNTS MANAGER MODAL -----------------

const PROFILE_COLOR_PRESETS = ['#8ab4f8', '#81c995', '#fdd663', '#f28b82', '#c58af9', '#78d9ec', '#ff8bc9', '#f9ab00'];

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

            <!-- Quick Color Preset Swatches -->
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

            <!-- Default Pro Checkbox -->
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

            <!-- Actions -->
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

    const isExpired = p.status === 'expired' || p.status === 'not_logged_in';

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
              ` : ''}
              ${isPro ? `
                <span class="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--google-yellow-container)]/50 text-[var(--google-yellow)] border border-[var(--google-yellow)]/30 flex items-center gap-1">
                  <i data-lucide="sparkles" class="w-2.5 h-2.5"></i> DEFAULT PRO
                </span>
              ` : (p.tier === 'pro' ? `
                <span class="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--google-blue-container)]/50 text-[var(--google-blue)] border border-[var(--google-blue)]/30 flex items-center gap-1">
                  PRO
                </span>
              ` : '')}
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
          <!-- Edit button -->
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

          <!-- Re-login button -->
          <button
            type="button"
            data-action="login"
            data-profile-id="${escapeHtml(p.id)}"
            title="Authenticate with Google Chrome"
            class="btn-account-login ${
              isExpired
                ? 'google-btn-primary bg-[var(--google-red)] hover:bg-[var(--google-red)]/90 text-white shadow-sm'
                : 'google-btn-outlined'
            } px-2.5 py-1 text-xs font-medium cursor-pointer flex items-center gap-1"
          >
            <i data-lucide="log-in" class="w-3.5 h-3.5 inline pointer-events-none ${isExpired ? 'text-white' : 'text-[var(--m3-on-surface-subtle)]'}"></i>
            <span class="pointer-events-none">${isExpired ? 'Re-login' : 'Login'}</span>
          </button>

          <!-- Toggle Pro button -->
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

          <!-- Delete account button -->
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
  }).join('');

  // Wire event listeners
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

async function handleEditProfileSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const oldProfileId = form.getAttribute('data-profile-id');
  const displayName = form.querySelector('input[name="displayName"]').value.trim();
  const email = form.querySelector('input[name="email"]').value.trim();
  const newId = form.querySelector('input[name="newId"]').value.trim();
  const tier = form.querySelector('select[name="tier"]').value;
  const color = form.querySelector('input[name="color"]').value;
  const isDefaultPro = form.querySelector('input[name="isDefaultPro"]').checked;

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
    const res = await fetch(`/api/profiles/${encodeURIComponent(oldProfileId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newId: newId !== oldProfileId ? newId : undefined,
        displayName: displayName,
        email: email,
        tier: tier,
        color: color,
        isDefaultPro: isDefaultPro
      })
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
      chatInput.value = state.chatDrafts.get(notebookId) || '';
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
  state.chatDrafts.delete(notebookId);

  const input = document.getElementById('chat-input');
  if (input) input.value = '';

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

  state.chatDrafts.delete(notebookId);
  if (input) input.value = '';

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

function renderCrossSynthesisResults(data) {
  const resultsBody = document.getElementById('cross-results-body');
  if (!resultsBody || !data) return;

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
            ${escapeHtml(data.synthesisModel || 'gemini-2.5-flash')}
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
           <span>Stage 2 LLM synthesis was skipped or unavailable (${escapeHtml(data.synthesisError)}). Displaying raw parallel extractions below.</span>
         </div>`
      : '';
    renderedHtml = `
      ${fallbackNotice}
      <div class="nlm-markdown text-xs leading-relaxed font-sans text-[var(--m3-on-surface)]">
        ${renderMarkdown(data.combinedContext || 'No synthesis produced.')}
      </div>
    `;
  }

  resultsBody.innerHTML = renderedHtml;
  resultsBody.setAttribute('data-raw-markdown', data.synthesizedBrief || data.combinedContext || '');
  if (window.lucide) lucide.createIcons({ root: resultsBody });
}

function handleResetCrossSynthesis() {
  if (state.crossSynthesis.inFlight) {
    showToast('Synthesis is currently in progress. Please wait for completion before resetting.', 'warning');
    return;
  }
  state.crossSynthesis = {
    prompt: '',
    inFlight: false,
    startTime: null,
    timerInterval: null,
    selectedNotebooks: [],
    data: null,
    error: null,
  };
  lastCrossSynthesisResult = null;
  try {
    sessionStorage.removeItem('super_nlm_cross_synthesis');
  } catch (e) {}

  const promptInput = document.getElementById('cross-prompt-input');
  if (promptInput) promptInput.value = '';
  const resultsContainer = document.getElementById('cross-results-container');
  if (resultsContainer) resultsContainer.classList.add('hidden');
  const resultsBody = document.getElementById('cross-results-body');
  if (resultsBody) {
    resultsBody.innerHTML = '';
    resultsBody.removeAttribute('data-raw-markdown');
  }
  const loadingState = document.getElementById('cross-loading-state');
  if (loadingState) loadingState.classList.add('hidden');

  const btn = document.getElementById('btn-run-cross-synthesis');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span>Execute Multi-Account Synthesis</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }
  showToast('Synthesis workspace reset.', 'info');
}

function openCrossSynthesisModal() {
  const container = document.getElementById('cross-notebooks-chips');
  const selected = Array.from(state.selectedNotebooks.values());

  if (selected.length === 0 && (!state.crossSynthesis.selectedNotebooks || state.crossSynthesis.selectedNotebooks.length === 0)) {
    showToast('Select at least 2 notebooks from different accounts first.', 'info');
    return;
  }

  // Use current selection if available, else keep prior saved synthesis selection
  const activeList = selected.length > 0 ? selected : state.crossSynthesis.selectedNotebooks;
  state.crossSynthesis.selectedNotebooks = activeList;

  if (container) {
    container.innerHTML = activeList.map(n => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs m3-subcard shadow-sm">
        <span class="font-mono text-[var(--google-blue)] text-[10px] font-medium">${escapeHtml(n.profileId)}</span>
        <span class="text-[var(--m3-outline-variant)]">:</span>
        <strong class="font-medium tracking-normal text-[var(--m3-on-surface)]">${escapeHtml(n.title)}</strong>
      </span>
    `).join('');
  }

  const promptInput = document.getElementById('cross-prompt-input');
  if (promptInput && state.crossSynthesis.prompt && !promptInput.value) {
    promptInput.value = state.crossSynthesis.prompt;
  }

  const loadingState = document.getElementById('cross-loading-state');
  const resultsContainer = document.getElementById('cross-results-container');
  const btn = document.getElementById('btn-run-cross-synthesis');

  if (state.crossSynthesis.inFlight) {
    if (loadingState) loadingState.classList.remove('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> <span>Synthesizing across accounts...</span>';
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  } else if (state.crossSynthesis.data) {
    if (loadingState) loadingState.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.remove('hidden');
    renderCrossSynthesisResults(state.crossSynthesis.data);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span>Re-execute Multi-Account Synthesis</span>';
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  } else {
    if (loadingState) loadingState.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span>Execute Multi-Account Synthesis</span>';
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  }

  openModal('modal-cross');
  if (window.lucide) lucide.createIcons();
}

async function handleRunCrossSynthesis() {
  const promptInput = document.getElementById('cross-prompt-input');
  const prompt = promptInput ? promptInput.value.trim() : '';
  if (!prompt) {
    showToast('Please enter a synthesis prompt or research goal.', 'info');
    return;
  }

  const selected = Array.from(state.selectedNotebooks.values());
  const targetNotebooks = selected.length > 0 ? selected : state.crossSynthesis.selectedNotebooks;
  if (!targetNotebooks || targetNotebooks.length === 0) {
    showToast('Please select at least 2 notebooks to synthesize.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-run-cross-synthesis');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> <span>Synthesizing across accounts...</span>';
    if (window.lucide) lucide.createIcons({ root: btn });
  }

  const loadingState = document.getElementById('cross-loading-state');
  const resultsContainer = document.getElementById('cross-results-container');
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

  state.crossSynthesis.inFlight = true;
  state.crossSynthesis.prompt = prompt;
  state.crossSynthesis.startTime = Date.now();
  state.crossSynthesis.selectedNotebooks = targetNotebooks;
  state.crossSynthesis.data = null;
  state.crossSynthesis.error = null;
  saveCrossSynthesisToSession();

  const startTime = state.crossSynthesis.startTime;
  if (state.crossSynthesis.timerInterval) clearInterval(state.crossSynthesis.timerInterval);

  state.crossSynthesis.timerInterval = setInterval(() => {
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
        notebooks: targetNotebooks,
        question: prompt
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.crossSynthesis.inFlight = false;
      state.crossSynthesis.data = data;
      state.crossSynthesis.error = null;

      lastCrossSynthesisResult = {
        ...data,
        prompt: prompt,
        notebooks: targetNotebooks,
        timestamp: new Date().toLocaleString()
      };
      saveCrossSynthesisToSession();

      if (loadingState) loadingState.classList.add('hidden');
      if (resultsContainer) resultsContainer.classList.remove('hidden');
      renderCrossSynthesisResults(data);
      showToast('Cross-account synthesis completed successfully.', 'success');
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      state.crossSynthesis.inFlight = false;
      state.crossSynthesis.error = err.detail || 'Failed to synthesize';
      saveCrossSynthesisToSession();
      if (loadingState) loadingState.classList.add('hidden');
      showToast('Synthesis error: ' + (err.detail || 'Failed to synthesize'), 'error');
    }
  } catch (err) {
    state.crossSynthesis.inFlight = false;
    state.crossSynthesis.error = err.message;
    saveCrossSynthesisToSession();
    if (loadingState) loadingState.classList.add('hidden');
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (state.crossSynthesis.timerInterval) {
      clearInterval(state.crossSynthesis.timerInterval);
      state.crossSynthesis.timerInterval = null;
    }
    setGlobalLoading(false);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> <span>Re-execute Multi-Account Synthesis</span>';
      if (window.lucide) lucide.createIcons({ root: btn });
    }
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
  if (id === 'modal-accounts') state.editingProfileId = null;
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

function fallbackCopyText(text, callback) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful && callback) callback();
  } catch (err) {
    console.warn('Fallback copy failed:', err);
  }
}

// ----------------- BATCH SHARE NOTEBOOKS MODAL -----------------

let batchShareSelectedNotebookIds = new Set();
let batchShareSelectedProfileIds = new Set();

function openBatchShareModal() {
  const modal = document.getElementById('modal-batch-share');
  if (!modal) {
    showToast('Batch Share modal dialog not found', 'error');
    return;
  }

  // Initialize selected notebooks from state.selectedNotebooks if any, else default to all study notebooks
  batchShareSelectedNotebookIds.clear();
  if (state.selectedNotebooks.size > 0) {
    state.selectedNotebooks.forEach((val, id) => batchShareSelectedNotebookIds.add(id));
  } else {
    // Default preset: select study course notebooks
    let studyCount = 0;
    state.notebooks.forEach(nb => {
      if (isStudyNotebook(nb)) {
        batchShareSelectedNotebookIds.add(nb.id);
        studyCount++;
      }
    });
    // If no study notebooks found, select all notebooks
    if (studyCount === 0) {
      state.notebooks.forEach(nb => batchShareSelectedNotebookIds.add(nb.id));
    }
  }

  // Initialize selected target accounts: all profiles except 'main' (or the primary owner)
  batchShareSelectedProfileIds.clear();
  const nonMainProfiles = state.profiles.filter(p => p.id !== 'main');
  if (nonMainProfiles.length > 0) {
    nonMainProfiles.forEach(p => batchShareSelectedProfileIds.add(p.id));
  } else if (state.profiles.length > 1) {
    state.profiles.slice(1).forEach(p => batchShareSelectedProfileIds.add(p.id));
  }

  // Reset progress section & button
  const progSection = document.getElementById('batch-share-progress-section');
  if (progSection) progSection.classList.add('hidden');
  const execBtn = document.getElementById('btn-execute-batch-share');
  if (execBtn) {
    execBtn.disabled = false;
    execBtn.innerHTML = '<i data-lucide="share-2" class="w-3.5 h-3.5"></i><span>Execute Batch Share</span>';
  }

  renderBatchShareNotebooksList();
  renderBatchShareAccountsList();
  updateBatchShareCounts();

  openModal('modal-batch-share');
  if (window.lucide) lucide.createIcons({ root: modal });

  const nbCount = batchShareSelectedNotebookIds.size;
  const accCount = batchShareSelectedProfileIds.size;
  showToast(`Batch Share: ${nbCount} notebook${nbCount === 1 ? '' : 's'} ready to share with ${accCount} account${accCount === 1 ? '' : 's'}`, 'info');
}

function updateBatchShareCounts() {
  const nbCountEl = document.getElementById('batch-share-selected-nb-count');
  if (nbCountEl) nbCountEl.textContent = batchShareSelectedNotebookIds.size;
  const accCountEl = document.getElementById('batch-share-selected-acc-count');
  if (accCountEl) accCountEl.textContent = batchShareSelectedProfileIds.size;
}

function renderBatchShareNotebooksList() {
  const container = document.getElementById('batch-share-notebooks-list');
  if (!container) return;

  // Deduplicate notebooks by ID
  const seenIds = new Set();
  const uniqueNotebooks = [];
  state.notebooks.forEach(nb => {
    if (!seenIds.has(nb.id)) {
      seenIds.add(nb.id);
      uniqueNotebooks.push(nb);
    }
  });

  // Sort so study courses are at the top
  uniqueNotebooks.sort((a, b) => {
    const aStudy = isStudyNotebook(a) ? 1 : 0;
    const bStudy = isStudyNotebook(b) ? 1 : 0;
    if (aStudy !== bStudy) return bStudy - aStudy;
    return (a.title || '').localeCompare(b.title || '');
  });

  container.innerHTML = uniqueNotebooks.map(nb => {
    const isChecked = batchShareSelectedNotebookIds.has(nb.id);
    const isStudy = isStudyNotebook(nb);
    const code = getCourseCode(nb);
    const ownerProfile = state.profiles.find(p => p.id === nb.profileId);
    const ownerLabel = ownerProfile ? ownerProfile.displayName : nb.profileName || 'Personal';

    return `
      <label class="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--m3-surface-container-high)] cursor-pointer transition border border-transparent ${isChecked ? 'bg-[var(--m3-surface-container-high)] border-[var(--google-blue)]/30' : ''}">
        <div class="flex items-center gap-2.5 min-w-0">
          <input type="checkbox" value="${nb.id}" class="batch-share-nb-check rounded bg-[var(--m3-surface)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer" ${isChecked ? 'checked' : ''}>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-medium text-[var(--m3-on-surface)] truncate max-w-xs sm:max-w-md">${escapeHtml(nb.title)}</span>
              ${code ? `<span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--google-blue-container)] text-[var(--google-blue)] font-medium">${escapeHtml(code)}</span>` : ''}
              ${isStudy ? `<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-[var(--google-yellow-container)]/80 text-[var(--google-yellow)] font-medium">Study Course</span>` : ''}
            </div>
            <div class="text-[10px] text-[var(--m3-on-surface-subtle)] flex items-center gap-2 mt-0.5">
              <span>${nb.source_count || 0} sources</span>
              <span>•</span>
              <span>Owner: ${escapeHtml(ownerLabel)}</span>
            </div>
          </div>
        </div>
      </label>
    `;
  }).join('');

  container.querySelectorAll('.batch-share-nb-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const id = e.target.value;
      if (e.target.checked) {
        batchShareSelectedNotebookIds.add(id);
      } else {
        batchShareSelectedNotebookIds.delete(id);
      }
      const parent = e.target.closest('label');
      if (parent) {
        if (e.target.checked) {
          parent.classList.add('bg-[var(--m3-surface-container-high)]', 'border-[var(--google-blue)]/30');
        } else {
          parent.classList.remove('bg-[var(--m3-surface-container-high)]', 'border-[var(--google-blue)]/30');
        }
      }
      updateBatchShareCounts();
    });
  });
}

function renderBatchShareAccountsList() {
  const container = document.getElementById('batch-share-accounts-list');
  if (!container) return;

  container.innerHTML = state.profiles.map(p => {
    const isChecked = batchShareSelectedProfileIds.has(p.id);
    const isOwnerCandidate = p.id === 'main';

    return `
      <label class="flex items-center justify-between p-2.5 rounded-lg border border-[var(--m3-outline-variant)]/60 hover:border-[var(--google-blue)]/50 bg-[var(--m3-surface)] cursor-pointer transition ${isChecked ? 'border-[var(--google-blue)] bg-[var(--google-blue-container)]/10' : ''}">
        <div class="flex items-center gap-2.5 min-w-0">
          <input type="checkbox" value="${p.id}" class="batch-share-acc-check rounded bg-[var(--m3-surface-container)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer" ${isChecked ? 'checked' : ''}>
          <div class="w-3 h-3 rounded-full shrink-0" style="background-color: ${p.color || '#8ab4f8'};"></div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-medium text-[var(--m3-on-surface)] truncate">${escapeHtml(p.displayName)}</span>
              ${p.tier === 'pro' ? `<span class="text-[9px] px-1 py-0.1 rounded-full bg-[var(--google-yellow-container)]/80 text-[var(--google-yellow)] font-medium">PRO AI</span>` : ''}
              ${isOwnerCandidate ? `<span class="text-[9px] px-1 py-0.1 rounded-full bg-[var(--google-blue-container)] text-[var(--google-blue)] font-medium">Manager</span>` : ''}
            </div>
            <div class="text-[10px] text-[var(--m3-on-surface-subtle)] truncate font-mono">${escapeHtml(p.email || 'No email')}</div>
          </div>
        </div>
      </label>
    `;
  }).join('');

  container.querySelectorAll('.batch-share-acc-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const pid = e.target.value;
      if (e.target.checked) {
        batchShareSelectedProfileIds.add(pid);
      } else {
        batchShareSelectedProfileIds.delete(pid);
      }
      const parent = e.target.closest('label');
      if (parent) {
        if (e.target.checked) {
          parent.classList.add('border-[var(--google-blue)]', 'bg-[var(--google-blue-container)]/10');
        } else {
          parent.classList.remove('border-[var(--google-blue)]', 'bg-[var(--google-blue-container)]/10');
        }
      }
      updateBatchShareCounts();
    });
  });
}

async function handleExecuteBatchShare() {
  if (batchShareSelectedNotebookIds.size === 0) {
    showToast('Please select at least 1 notebook to share.', 'warning');
    return;
  }
  if (batchShareSelectedProfileIds.size === 0) {
    showToast('Please select at least 1 target Google account.', 'warning');
    return;
  }

  const roleEl = document.querySelector('input[name="batch-share-role"]:checked');
  const role = roleEl ? roleEl.value : 'editor';
  const autoSyncEl = document.getElementById('check-batch-share-autosync');
  const autoSync = autoSyncEl ? autoSyncEl.checked : true;

  const notebookIds = Array.from(batchShareSelectedNotebookIds);
  const targetProfileIds = Array.from(batchShareSelectedProfileIds);

  const execBtn = document.getElementById('btn-execute-batch-share');
  execBtn.disabled = true;
  execBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Inviting Accounts...</span>';
  if (window.lucide) lucide.createIcons({ root: execBtn });

  const progSection = document.getElementById('batch-share-progress-section');
  const progBar = document.getElementById('batch-share-progress-bar');
  const progCounter = document.getElementById('batch-share-progress-counter');
  const statusTitle = document.getElementById('batch-share-status-title');
  const logsEl = document.getElementById('batch-share-logs');

  if (progSection) progSection.classList.remove('hidden');
  if (progBar) progBar.style.width = '30%';
  if (progCounter) progCounter.textContent = `0 / ${notebookIds.length * targetProfileIds.length}`;
  if (logsEl) {
    logsEl.innerHTML = `<div>[Init] Preparing batch share for ${notebookIds.length} notebook(s) to ${targetProfileIds.length} account(s) with role: ${role.toUpperCase()}...</div>`;
  }

  try {
    const res = await fetch('/api/notebooks/batch-share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebookIds: notebookIds,
        targetProfileIds: targetProfileIds,
        role: role,
        autoSync: autoSync
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server returned error ${res.status}`);
    }

    const data = await res.json();
    if (progBar) progBar.style.width = '100%';
    if (progCounter) progCounter.textContent = `${data.totalOperations || 0} / ${data.totalOperations || 0}`;

    if (logsEl) {
      const details = data.details || [];
      const logHtml = details.map(d => {
        const icon = d.status === 'shared' ? '✅' : (d.status === 'already_shared' ? 'ℹ️' : (d.status === 'owner' ? '👑' : '❌'));
        return `<div>${icon} <strong>${escapeHtml(d.notebookTitle || d.notebookId)}</strong> &rarr; ${escapeHtml(d.targetEmail)}: <em>${escapeHtml(d.message)}</em></div>`;
      }).join('');
      logsEl.innerHTML = logHtml + `
        <div class="pt-1 font-semibold text-[var(--google-green)]">
          🎉 Completed! Shared: ${data.shared}, Already Access: ${data.alreadyShared}, Skipped Owner: ${data.skippedOwner}, Failed: ${data.failed}
        </div>
      `;
      logsEl.scrollTop = logsEl.scrollHeight;
    }

    if (statusTitle) {
      statusTitle.innerHTML = `
        <i data-lucide="check-circle-2" class="w-4 h-4 text-[var(--google-green)]"></i>
        <span class="text-[var(--google-green)] font-medium">Batch sharing completed successfully!</span>
      `;
      if (window.lucide) lucide.createIcons({ root: statusTitle });
    }

    execBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Shared!</span>';
    if (window.lucide) lucide.createIcons({ root: execBtn });

    showToast(`Batch sharing complete: ${data.shared} accounts invited, ${data.alreadyShared} had access.`, 'success');

    if (autoSync) {
      setTimeout(async () => {
        await loadNotebooks();
      }, 1500);
    }

  } catch (err) {
    console.error('Batch share failed:', err);
    if (progBar) progBar.style.width = '100%';
    if (logsEl) {
      logsEl.innerHTML += `<div class="text-[var(--google-red)]">❌ Error: ${escapeHtml(err.message)}</div>`;
    }
    showToast(`Batch sharing error: ${err.message}`, 'error');
    execBtn.disabled = false;
    execBtn.innerHTML = '<i data-lucide="share-2" class="w-3.5 h-3.5"></i><span>Retry Batch Share</span>';
    if (window.lucide) lucide.createIcons({ root: execBtn });
  }
}

// ==========================================================================
// Google Calendar Agenda & Study Copilot Controller
// ==========================================================================

const AGENDA_COLLAPSED_KEY = 'supernlm_agenda_collapsed';
const UPCOMING_OPEN_KEY = 'supernlm_upcoming_open';

async function loadCalendarAgenda(forceRefresh = false) {
  const section = document.getElementById('calendar-agenda-section');
  if (!section) return;

  const refreshIcon = document.getElementById('agenda-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const endpoint = forceRefresh ? '/api/calendar/refresh?days=14' : '/api/calendar/agenda?days=14';
    const method = forceRefresh ? 'POST' : 'GET';
    const res = await fetch(endpoint, { method });
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

function toggleAgendaCollapse(forceState = null) {
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

function toggleUpcomingEvents() {
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

function renderCalendarAgenda() {
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
    const email = agenda.calendar_email ? `${escapeHtml(agenda.calendar_email)} • ` : '';
    subtitleEl.textContent = `${email}${agenda.today_count} scheduled today, ${agenda.upcoming_count} upcoming this week`;
  }
  if (badgeCountEl) {
    badgeCountEl.textContent = `${agenda.today_count} Today`;
  }

  // Render Today's Events
  const todayContainer = document.getElementById('agenda-today-container');
  if (todayContainer) {
    if (!agenda.today_events || agenda.today_events.length === 0) {
      todayContainer.innerHTML = `
        <div class="p-3.5 rounded-xl m3-subcard text-xs text-[var(--m3-on-surface-subtle)] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i data-lucide="check-circle-2" class="w-4 h-4 text-[var(--google-green)]"></i>
            <span>No lectures or exams scheduled for today.</span>
          </div>
          ${agenda.upcoming_count > 0 ? `<span class="text-[11px] text-[var(--google-blue)] font-medium">${agenda.upcoming_count} upcoming events this week</span>` : ''}
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

function renderAgendaEventItem(event, isToday) {
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

// ==========================================================================
// Google Account Fleet Usage & Quota Limits Controller
// ==========================================================================

function formatResetCountdown(isoDate) {
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

async function openUsageLimitsModal() {
  openModal('modal-usage');
  if (!state.fleetUsage || (Date.now() - (state.fleetUsageTimestamp || 0) > 45000)) {
    await loadFleetUsage(false);
  } else {
    renderUsageModal();
  }
}

async function loadFleetUsage(forceRefresh = false) {
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
    const res = await fetch(endpoint);
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

async function refreshProfileUsage(profileId) {
  const btn = document.querySelector(`.btn-refresh-single-usage[data-profile="${profileId}"]`);
  const icon = btn ? btn.querySelector('i') : null;
  if (icon) icon.classList.add('animate-spin');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/usage`);
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

function renderSidebarFleetQuota() {
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
    dotsContainer.innerHTML = data.profiles.map(p => {
      const rolling = (p.windows || []).find(w => w.window === 'rolling');
      const used = rolling ? rolling.percent_used : 0;
      let statusColor = 'var(--google-green)';
      if (used >= 90) statusColor = 'var(--google-red)';
      else if (used >= 70) statusColor = 'var(--google-yellow)';

      return `<div class="quota-dot shrink-0 cursor-pointer" style="background-color: ${statusColor};" title="${escapeHtml(p.display_name)} (${escapeHtml(p.profile_id)}): ${used.toFixed(1)}% used"></div>`;
    }).join('');
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

function renderUsageModal() {
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

  // Render 6-Account Cards
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

function renderUsageSkeletons() {
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

// ==========================================================================
// Batch Creation & Fleet Rotation Queue Controller
// ==========================================================================

let schedulerPollTimer = null;
let schedulerSelectedNotebooks = new Set();

function initSchedulerController() {
  const btnOpen = document.getElementById('btn-open-scheduler-modal');
  const btnClose = document.getElementById('close-modal-scheduler');
  const btnCancel = document.getElementById('btn-cancel-scheduler');
  const tabCreate = document.getElementById('tab-scheduler-create');
  const tabQueue = document.getElementById('tab-scheduler-queue');
  const btnRefresh = document.getElementById('btn-refresh-queue');
  const btnExecute = document.getElementById('btn-execute-scheduler-batch');
  const btnSelectStudy = document.getElementById('btn-select-all-study-scheduler');
  const btnSelectAll = document.getElementById('btn-select-all-scheduler');
  const btnClearAll = document.getElementById('btn-clear-all-scheduler');
  const btnClearCompleted = document.getElementById('btn-clear-completed-jobs');
  const artifactRadios = document.querySelectorAll('input[name="scheduler-artifact-type"]');
  const triggerRadios = document.querySelectorAll('input[name="scheduler-trigger-type"]');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => openSchedulerModal());
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => closeSchedulerModal());
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', () => closeSchedulerModal());
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => loadSchedulerQueue(true));
  }

  if (tabCreate && tabQueue) {
    tabCreate.addEventListener('click', () => switchSchedulerTab('create'));
    tabQueue.addEventListener('click', () => switchSchedulerTab('queue'));
  }

  if (btnSelectStudy) {
    btnSelectStudy.addEventListener('click', () => {
      schedulerSelectedNotebooks.clear();
      state.notebooks.forEach(nb => {
        if (isStudyNotebook(nb)) schedulerSelectedNotebooks.add(nb.id);
      });
      renderSchedulerNotebooksList();
    });
  }

  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      state.notebooks.forEach(nb => schedulerSelectedNotebooks.add(nb.id));
      renderSchedulerNotebooksList();
    });
  }

  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      schedulerSelectedNotebooks.clear();
      renderSchedulerNotebooksList();
    });
  }

  if (btnClearCompleted) {
    btnClearCompleted.addEventListener('click', handleClearCompletedJobs);
  }

  if (btnExecute) {
    btnExecute.addEventListener('click', handleExecuteBatchSchedule);
  }

  // Artifact selection dynamic controls
  artifactRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const val = radio.value;
      const formatSelect = document.getElementById('scheduler-format-select');
      const styleSelect = document.getElementById('scheduler-style-select');
      if (!formatSelect) return;

      if (val === 'video') {
        formatSelect.innerHTML = `
          <option value="cinematic">Cinematic (Dramatic Narrative)</option>
          <option value="explainer">Explainer (Detailed Overview)</option>
          <option value="brief">Brief (Quick 2-minute summary)</option>
          <option value="short">Short (Bite-sized clip)</option>
        `;
        if (styleSelect) styleSelect.parentElement.style.display = 'block';
      } else if (val === 'audio') {
        formatSelect.innerHTML = `
          <option value="deep_dive">Deep Dive (Comprehensive Podcast)</option>
          <option value="brief">Brief (5-minute summary)</option>
          <option value="critique">Critique (Analytical evaluation)</option>
          <option value="debate">Debate (Two opposing viewpoints)</option>
        `;
        if (styleSelect) styleSelect.parentElement.style.display = 'none';
      } else if (val === 'report') {
        formatSelect.innerHTML = `
          <option value="Study Guide">Study Guide</option>
          <option value="Briefing Doc">Briefing Doc</option>
          <option value="FAQ">FAQ Document</option>
          <option value="Timeline">Chronological Timeline</option>
        `;
        if (styleSelect) styleSelect.parentElement.style.display = 'none';
      } else if (val === 'quiz') {
        formatSelect.innerHTML = `
          <option value="quiz">Interactive Quiz (10 questions)</option>
          <option value="flashcards">Flashcards (Key concepts)</option>
        `;
        if (styleSelect) styleSelect.parentElement.style.display = 'none';
      }
    });
  });

  // Trigger timing dynamic controls
  triggerRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const dtContainer = document.getElementById('scheduler-datetime-container');
      if (dtContainer) {
        dtContainer.classList.toggle('hidden', radio.value !== 'custom_time');
      }
    });
  });

  // Start background queue polling
  loadSchedulerQueue(false);
  startSchedulerPolling();
}

function openSchedulerModal() {
  const modal = document.getElementById('modal-scheduler');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Preselect currently selected notebooks if any
  if (state.selectedNotebooks && state.selectedNotebooks.size > 0) {
    schedulerSelectedNotebooks.clear();
    state.selectedNotebooks.forEach((val, key) => schedulerSelectedNotebooks.add(key));
  } else if (schedulerSelectedNotebooks.size === 0) {
    // Default to all study notebooks
    state.notebooks.forEach(nb => {
      if (isStudyNotebook(nb)) schedulerSelectedNotebooks.add(nb.id);
    });
  }

  renderSchedulerNotebooksList();
  loadSchedulerQueue(true);
  if (window.lucide) lucide.createIcons({ root: modal });
}

function closeSchedulerModal() {
  const modal = document.getElementById('modal-scheduler');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function switchSchedulerTab(tab) {
  const tabCreate = document.getElementById('tab-scheduler-create');
  const tabQueue = document.getElementById('tab-scheduler-queue');
  const panelCreate = document.getElementById('panel-scheduler-create');
  const panelQueue = document.getElementById('panel-scheduler-queue');
  const btnExecute = document.getElementById('btn-execute-scheduler-batch');

  if (tab === 'create') {
    tabCreate.className = 'pb-2.5 text-xs font-semibold text-[var(--google-blue)] border-b-2 border-[var(--google-blue)] flex items-center gap-1.5 cursor-pointer';
    tabQueue.className = 'pb-2.5 text-xs font-medium text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] border-b-2 border-transparent flex items-center gap-1.5 cursor-pointer';
    panelCreate.classList.remove('hidden');
    panelQueue.classList.add('hidden');
    if (btnExecute) btnExecute.style.display = 'flex';
  } else {
    tabQueue.className = 'pb-2.5 text-xs font-semibold text-[var(--google-blue)] border-b-2 border-[var(--google-blue)] flex items-center gap-1.5 cursor-pointer';
    tabCreate.className = 'pb-2.5 text-xs font-medium text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] border-b-2 border-transparent flex items-center gap-1.5 cursor-pointer';
    panelQueue.classList.remove('hidden');
    panelCreate.classList.add('hidden');
    if (btnExecute) btnExecute.style.display = 'none';
    loadSchedulerQueue(true);
  }
}

function renderSchedulerNotebooksList() {
  const container = document.getElementById('scheduler-notebooks-list');
  const countLabel = document.getElementById('scheduler-selected-count-label');
  if (!container) return;

  if (!state.notebooks || state.notebooks.length === 0) {
    container.innerHTML = '<p class="text-xs text-[var(--m3-on-surface-subtle)] p-2">No notebooks available. Run sync first.</p>';
    return;
  }

  // Sort: study notebooks first, then alphabetical
  const sorted = [...state.notebooks].sort((a, b) => {
    const aStudy = isStudyNotebook(a);
    const bStudy = isStudyNotebook(b);
    if (aStudy && !bStudy) return -1;
    if (!aStudy && bStudy) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });

  container.innerHTML = sorted.map(nb => {
    const isChecked = schedulerSelectedNotebooks.has(nb.id);
    const isStudy = isStudyNotebook(nb);
    const code = getCourseCode(nb);
    const badge = code ? `<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--google-green-container)] text-[var(--google-green)] font-semibold">${escapeHtml(code)}</span>` : '';

    return `
      <label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[var(--m3-surface-container-high)] cursor-pointer transition select-none ${isChecked ? 'bg-[var(--google-blue-container)]/15' : ''}">
        <input
          type="checkbox"
          class="scheduler-nb-checkbox rounded bg-[var(--m3-surface-container)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0"
          value="${escapeHtml(nb.id)}"
          ${isChecked ? 'checked' : ''}
        >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          ${badge}
          <span class="text-xs font-medium text-[var(--m3-on-surface)] truncate" title="${escapeHtml(nb.title)}">
            ${escapeHtml(nb.title)}
          </span>
          <span class="text-[10px] text-[var(--m3-on-surface-subtle)] font-mono shrink-0 ml-auto">
            ${escapeHtml(nb.profileName || nb.profileId)}
          </span>
        </div>
      </label>
    `;
  }).join('');

  if (countLabel) {
    countLabel.textContent = `${schedulerSelectedNotebooks.size} of ${state.notebooks.length} notebooks selected`;
  }

  container.querySelectorAll('.scheduler-nb-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.value;
      if (cb.checked) {
        schedulerSelectedNotebooks.add(id);
      } else {
        schedulerSelectedNotebooks.delete(id);
      }
      renderSchedulerNotebooksList();
    });
  });

  if (window.lucide) lucide.createIcons({ root: container });
}

// ----------------- DOWNLOAD NOTIFICATION & AUDIO ALARM -----------------
const NOTIFIED_JOBS_STORAGE_KEY = 'supernlm_notified_download_jobs';

function getNotifiedJobIds() {
  try {
    const raw = localStorage.getItem(NOTIFIED_JOBS_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function saveNotifiedJobIds(set) {
  try {
    localStorage.setItem(NOTIFIED_JOBS_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch (e) {}
}

let hasInitializedSchedulerQueue = false;

function playDownloadChime() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Google-style 4-tone melodic chime: C5 (523.25Hz) -> E5 (659.25Hz) -> G5 (783.99Hz) -> C6 (1046.50Hz)
    const notes = [
      { freq: 523.25, time: 0, dur: 0.18, vol: 0.15 },
      { freq: 659.25, time: 0.10, dur: 0.18, vol: 0.18 },
      { freq: 783.99, time: 0.20, dur: 0.22, vol: 0.20 },
      { freq: 1046.50, time: 0.32, dur: 0.45, vol: 0.25 }
    ];

    notes.forEach(({ freq, time, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + time);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + time);
      gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + time);
      osc.stop(ctx.currentTime + time + dur + 0.05);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1200);
  } catch (err) {
    console.warn('Audio chime playback omitted:', err);
  }
}

async function loadSchedulerQueue(showAnimation = false) {
  const refreshIcon = document.getElementById('queue-refresh-icon');
  if (showAnimation && refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const res = await fetch('/api/scheduler/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Check for newly completed downloads to trigger toast alarm + audio chime
    const notifiedSet = getNotifiedJobIds();
    const completedJobs = (data.jobs || []).filter(j => j.status === 'completed' && j.download_filename);

    if (!hasInitializedSchedulerQueue) {
      // Seed existing completed jobs on first load so we don't blast historical notifications
      completedJobs.forEach(j => notifiedSet.add(j.id));
      saveNotifiedJobIds(notifiedSet);
      hasInitializedSchedulerQueue = true;
    } else {
      let hasNewDownload = false;
      for (const job of completedJobs) {
        if (!notifiedSet.has(job.id)) {
          notifiedSet.add(job.id);
          hasNewDownload = true;
          
          const artLabel = (job.artifact_type || 'Artifact').toUpperCase();
          const targetTitle = job.notebook_title || 'Notebook';
          const filename = job.download_filename || 'download.bin';

          showToast(
            `🎬 ${artLabel} Ready: "${targetTitle}" downloaded to downloads/`,
            'success',
            {
              label: 'Open File',
              onClick: () => {
                const dlUrl = `/api/scheduler/downloads/${encodeURIComponent(filename)}`;
                window.open(dlUrl, '_blank');
              }
            }
          );
        }
      }

      if (hasNewDownload) {
        playDownloadChime();
        saveNotifiedJobIds(notifiedSet);
      }
    }

    renderSchedulerQueueData(data);
    updateQueueBadge(data);
  } catch (e) {
    console.warn('Could not fetch scheduler status:', e);
  } finally {
    if (showAnimation && refreshIcon) {
      setTimeout(() => refreshIcon.classList.remove('animate-spin'), 400);
    }
  }
}

function updateQueueBadge(data) {
  const badge = document.getElementById('queue-active-badge');
  const tabBadge = document.getElementById('tab-queue-count');
  if (!data) return;

  const activeCount = (data.in_progress_count || 0) + (data.queued_count || 0);
  if (badge) {
    if (activeCount > 0) {
      badge.textContent = activeCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  if (tabBadge) {
    tabBadge.textContent = (data.jobs || []).length;
  }
}

function renderSchedulerQueueData(data) {
  const statRendering = document.getElementById('queue-stat-rendering');
  const statQueued = document.getElementById('queue-stat-queued');
  const statCompleted = document.getElementById('queue-stat-completed');
  const statWorkers = document.getElementById('queue-stat-workers');
  const container = document.getElementById('scheduler-jobs-container');

  if (statRendering) statRendering.textContent = data.in_progress_count || 0;
  if (statQueued) statQueued.textContent = data.queued_count || 0;
  if (statCompleted) statCompleted.textContent = data.completed_count || 0;

  if (statWorkers && data.active_workers) {
    const busy = Object.values(data.active_workers).filter(Boolean).length;
    const total = Object.keys(data.active_workers).length || (state.profiles ? state.profiles.length : 1);
    statWorkers.textContent = `${busy}/${total} Busy`;
  }

  if (!container) return;

  const jobs = data.jobs || [];
  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="p-8 rounded-2xl m3-subcard text-center space-y-2">
        <i data-lucide="inbox" class="w-8 h-8 text-[var(--m3-on-surface-subtle)] mx-auto"></i>
        <h4 class="text-xs font-semibold text-[var(--m3-on-surface)]">Queue is empty</h4>
        <p class="text-[11px] text-[var(--m3-on-surface-subtle)]">Schedule video or study generations to start background fleet rendering.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons({ root: container });
    return;
  }

  container.innerHTML = jobs.map(job => {
    const isRendering = job.status === 'in_progress';
    const isQueued = job.status === 'queued' || job.status === 'scheduled';
    const isCompleted = job.status === 'completed';
    const isFailed = job.status === 'failed';
    const isDownloadFailed = job.status === 'download_failed';

    let statusBadge = '';
    if (isRendering) {
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--google-blue-container)] text-[var(--google-blue)] text-[10px] font-mono font-semibold border border-[var(--google-blue)]/30 animate-pulse">
          <i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>
          Rendering on ${escapeHtml(job.assigned_profile_id || 'Fleet')}
        </span>
      `;
    } else if (isQueued) {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#fdd663]/20 text-[#fdd663] text-[10px] font-mono font-semibold border border-[#fdd663]/30">
          <i data-lucide="clock" class="w-3 h-3"></i>
          Wave ${job.rotation_wave || 1} • Queued
        </span>
      `;
    } else if (isCompleted) {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#81c995]/20 text-[#81c995] text-[10px] font-mono font-semibold border border-[#81c995]/30">
          <i data-lucide="check-circle" class="w-3 h-3"></i>
          Completed & Cached
        </span>
      `;
    } else if (isDownloadFailed) {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#fdd663]/20 text-[#fdd663] text-[10px] font-mono font-semibold border border-[#fdd663]/30" title="${escapeHtml(job.error_message || '')}">
          <i data-lucide="download-x" class="w-3 h-3"></i>
          Download Failed
        </span>
      `;
    } else if (isFailed) {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#f28b82]/20 text-[#f28b82] text-[10px] font-mono font-semibold border border-[#f28b82]/30" title="${escapeHtml(job.error_message || '')}">
          <i data-lucide="alert-circle" class="w-3 h-3"></i>
          Failed
        </span>
      `;
    } else {
      statusBadge = `<span class="text-[10px] font-mono text-[var(--m3-on-surface-subtle)]">${escapeHtml(job.status)}</span>`;
    }

    let actionButtons = '';
    if (isCompleted && job.download_filename) {
      actionButtons = `
        <a
          href="/api/scheduler/downloads/${encodeURIComponent(job.download_filename)}"
          download="${escapeHtml(job.download_filename)}"
          class="google-btn-primary px-3 py-1 text-[11px] flex items-center gap-1 shadow-xs cursor-pointer"
        >
          <i data-lucide="download" class="w-3 h-3"></i>
          <span>Download ${escapeHtml(job.artifact_type)}</span>
        </a>
      `;
    } else if (isQueued || isFailed || isDownloadFailed) {
      actionButtons = `
        <button
          type="button"
          class="btn-run-job-now google-btn-tonal px-2.5 py-1 text-[11px] flex items-center gap-1 cursor-pointer"
          data-id="${escapeHtml(job.id)}"
          title="Force Run Immediately"
        >
          <i data-lucide="play" class="w-3 h-3"></i>
          <span>Run Now</span>
        </button>
        <button
          type="button"
          class="btn-cancel-job google-btn-outlined px-2 py-1 text-[11px] text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-red)] cursor-pointer"
          data-id="${escapeHtml(job.id)}"
          title="Cancel/Delete Job"
        >
          <i data-lucide="trash-2" class="w-3 h-3"></i>
        </button>
      `;
    }

    const typeIcons = {
      video: 'clapperboard',
      audio: 'headphones',
      report: 'file-text',
      quiz: 'help-circle',
      flashcards: 'layers',
      mindmap: 'network',
      slides: 'presentation'
    };
    const iconName = typeIcons[job.artifact_type] || 'file';

    return `
      <div class="p-3.5 rounded-2xl m3-subcard border border-[var(--m3-outline-variant)]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isRendering ? 'ring-1 ring-[var(--google-blue)]/50' : ''}">
        <div class="flex items-start gap-3 min-w-0">
          <div class="p-2 rounded-xl bg-[var(--m3-surface-container)] text-[var(--google-blue)] shrink-0 mt-0.5">
            <i data-lucide="${iconName}" class="w-4 h-4"></i>
          </div>
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-xs font-semibold text-[var(--m3-on-surface)] truncate max-w-xs sm:max-w-md" title="${escapeHtml(job.notebook_title)}">
                ${escapeHtml(job.notebook_title)}
              </h4>
              ${statusBadge}
            </div>
            <div class="flex items-center gap-2 text-[10px] text-[var(--m3-on-surface-subtle)] font-mono flex-wrap">
              <span class="uppercase font-semibold text-[var(--google-blue)]">${escapeHtml(job.artifact_type)}</span>
              <span>•</span>
              <span>Format: ${escapeHtml(job.format_option || 'default')}</span>
              ${job.assigned_profile_id ? `<span>•</span><span>Account: ${escapeHtml(job.assigned_profile_id)}</span>` : ''}
              ${job.download_filename ? `<span>•</span><span class="text-[var(--google-green)]">${escapeHtml(job.download_filename)}</span>` : ''}
            </div>
            ${job.error_message ? `<p class="text-[10px] text-[var(--google-red)] truncate max-w-md">${escapeHtml(job.error_message)}</p>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-run-job-now').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (id) {
        try {
          await fetch(`/api/scheduler/jobs/${id}/run-now`, { method: 'POST' });
          showToast('Job queued for immediate dispatch', 'success');
          loadSchedulerQueue(true);
        } catch (e) {
          showToast(`Error: ${e.message}`, 'error');
        }
      }
    });
  });

  container.querySelectorAll('.btn-cancel-job').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (id) {
        try {
          await fetch(`/api/scheduler/jobs/${id}`, { method: 'DELETE' });
          showToast('Job removed from queue', 'info');
          loadSchedulerQueue(true);
        } catch (e) {
          showToast(`Error: ${e.message}`, 'error');
        }
      }
    });
  });

  if (window.lucide) lucide.createIcons({ root: container });
}

async function handleExecuteBatchSchedule() {
  if (schedulerSelectedNotebooks.size === 0) {
    showToast('Please select at least 1 notebook for generation.', 'warning');
    return;
  }

  const selectedArtifact = document.querySelector('input[name="scheduler-artifact-type"]:checked')?.value || 'video';
  const formatSelect = document.getElementById('scheduler-format-select');
  const styleSelect = document.getElementById('scheduler-style-select');
  const customPromptInput = document.getElementById('scheduler-custom-prompt');
  const triggerType = document.querySelector('input[name="scheduler-trigger-type"]:checked')?.value || 'immediate';
  const customDtInput = document.getElementById('scheduler-custom-datetime');

  let scheduledTime = null;
  if (triggerType === 'custom_time' && customDtInput && customDtInput.value) {
    scheduledTime = new Date(customDtInput.value).toISOString();
  }

  const payload = {
    notebook_ids: Array.from(schedulerSelectedNotebooks),
    artifact_type: selectedArtifact,
    format_option: formatSelect ? formatSelect.value : 'cinematic',
    style: styleSelect ? styleSelect.value : 'auto_select',
    custom_prompt: customPromptInput ? customPromptInput.value.trim() || null : null,
    trigger_type: triggerType,
    scheduled_time: scheduledTime
  };

  const btnExecute = document.getElementById('btn-execute-scheduler-batch');
  const btnLabel = document.getElementById('btn-execute-scheduler-label');
  if (btnExecute) btnExecute.disabled = true;
  if (btnLabel) btnLabel.textContent = 'Queueing across fleet...';

  try {
    const res = await fetch('/api/scheduler/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    showToast(`✅ Successfully queued ${data.total_queued} generation job(s) across fleet accounts!`, 'success');
    switchSchedulerTab('queue');
    loadSchedulerQueue(true);
  } catch (e) {
    showToast(`Failed to schedule batch: ${e.message}`, 'error');
  } finally {
    if (btnExecute) btnExecute.disabled = false;
    if (btnLabel) btnLabel.textContent = 'Queue Batch Creation';
  }
}

async function handleClearCompletedJobs() {
  try {
    const res = await fetch('/api/scheduler/jobs?status=completed');
    if (!res.ok) return;
    const completed = await res.json();
    for (const job of completed) {
      await fetch(`/api/scheduler/jobs/${job.id}`, { method: 'DELETE' });
    }
    showToast('Cleared completed jobs from history', 'info');
    loadSchedulerQueue(true);
  } catch (e) {
    console.warn('Error clearing jobs:', e);
  }
}

function startSchedulerPolling() {
  if (schedulerPollTimer) clearInterval(schedulerPollTimer);
  schedulerPollTimer = setInterval(() => {
    loadSchedulerQueue(false);
  }, 12000);
}

// Auto-initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSchedulerController();
    initFolderMappingController();
  });
} else {
  initSchedulerController();
  initFolderMappingController();
}

// ==========================================================================
// Hybrid Folder Mapping & Auto-Sync Controller
// ==========================================================================

function initFolderMappingController() {
  const modal = document.getElementById('modal-folder-mapping');
  const btnClose = document.getElementById('close-modal-folder');
  const btnCancel = document.getElementById('btn-close-folder-modal');
  const btnSave = document.getElementById('btn-save-folder-mapping');
  const btnUnlink = document.getElementById('btn-unlink-folder-mapping');
  const btnIngest = document.getElementById('btn-ingest-folder-files');
  const btnSyncStale = document.getElementById('btn-sync-stale-docs');
  const btnSelectAll = document.getElementById('btn-select-all-new');
  const btnClearSel = document.getElementById('btn-deselect-all-files');

  if (btnClose) btnClose.addEventListener('click', closeFolderMappingModal);
  if (btnCancel) btnCancel.addEventListener('click', closeFolderMappingModal);
  if (btnSave) btnSave.addEventListener('click', handleSaveOrScanFolder);
  if (btnUnlink) btnUnlink.addEventListener('click', handleUnlinkFolder);
  if (btnIngest) btnIngest.addEventListener('click', () => handleSyncFolderAction('ingest_new'));
  if (btnSyncStale) btnSyncStale.addEventListener('click', () => handleSyncFolderAction('sync_stale'));

  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.folder-file-cb[data-status="new"]').forEach(cb => {
        cb.checked = true;
      });
      updateIngestButtonCount();
    });
  }

  if (btnClearSel) {
    btnClearSel.addEventListener('click', () => {
      document.querySelectorAll('.folder-file-cb').forEach(cb => {
        cb.checked = false;
      });
      updateIngestButtonCount();
    });
  }
}

window.openFolderMappingModal = async function(notebookId, title) {
  state.activeFolderNotebookId = notebookId;
  const modal = document.getElementById('modal-folder-mapping');
  const nbTitleEl = document.getElementById('folder-modal-nb-title');
  if (nbTitleEl) nbTitleEl.textContent = title || `Notebook ${notebookId.slice(0, 8)}`;

  openModal('modal-folder-mapping');
  if (modal && window.lucide) {
    lucide.createIcons({ root: modal });
  }

  await loadFolderMappingStatus(notebookId);
};

function closeFolderMappingModal() {
  closeModal('modal-folder-mapping');
  state.activeFolderNotebookId = null;
  state.activeFolderStatus = null;
}

async function loadFolderMappingStatus(notebookId) {
  const filesList = document.getElementById('folder-files-list');
  const targetInput = document.getElementById('folder-target-input');
  const recursiveToggle = document.getElementById('folder-recursive-toggle');
  const typeBadge = document.getElementById('folder-type-badge');
  const btnUnlink = document.getElementById('btn-unlink-folder-mapping');
  const lastScannedEl = document.getElementById('folder-last-scanned');

  if (filesList) {
    filesList.innerHTML = `
      <div class="p-8 text-center text-xs text-[var(--m3-on-surface-subtle)] flex flex-col items-center gap-2">
        <div class="google-quad-dots">
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
        </div>
        <span>Comparing folder files against NotebookLM sources...</span>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/notebooks/${notebookId}/folder`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.activeFolderStatus = data;

    // Populate inputs
    if (data.mapping) {
      if (targetInput) targetInput.value = data.mapping.target_path || '';
      if (recursiveToggle) recursiveToggle.checked = Boolean(data.mapping.recursive);
      if (btnUnlink) btnUnlink.classList.remove('hidden');
      if (typeBadge) {
        typeBadge.classList.remove('hidden');
        typeBadge.textContent = data.mapping.folder_type === 'drive_web' ? '☁️ Google Drive Web' : '📁 Local Folder';
        typeBadge.className = data.mapping.folder_type === 'drive_web'
          ? 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--google-blue)]/40 bg-[var(--google-blue-container)]/20 text-[var(--google-blue)]'
          : 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--google-green)]/40 bg-[var(--google-green-container)]/20 text-[var(--google-green)]';
      }
      if (lastScannedEl && data.mapping.last_scanned) {
        const d = new Date(data.mapping.last_scanned);
        lastScannedEl.textContent = `Scanned ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
    } else {
      if (targetInput) targetInput.value = '';
      if (btnUnlink) btnUnlink.classList.add('hidden');
      if (typeBadge) typeBadge.classList.add('hidden');
      if (lastScannedEl) lastScannedEl.textContent = '';
    }

    renderFolderStatusUI(data);
  } catch (err) {
    console.error('Error loading folder status:', err);
    if (filesList) {
      filesList.innerHTML = `
        <div class="p-6 text-center text-xs text-[var(--google-red)]">
          Could not load folder status. Please check path or network.
        </div>
      `;
    }
  }
}

function renderFolderStatusUI(data) {
  // Update capacity meter
  const capLabel = document.getElementById('folder-capacity-label');
  const capBar = document.getElementById('folder-capacity-bar');
  const tierBadge = document.getElementById('folder-modal-tier-badge');

  const used = data.current_source_count || 0;
  const max = data.max_capacity || 300;
  const pct = Math.min(Math.round((used / max) * 100), 100);

  if (capLabel) {
    capLabel.textContent = `${used} / ${max} sources (${max - used} slots free)`;
  }
  if (capBar) {
    capBar.style.width = `${pct}%`;
    if (pct >= 85) {
      capBar.classList.add('near-limit');
    } else {
      capBar.classList.remove('near-limit');
    }
  }
  if (tierBadge) {
    tierBadge.textContent = `${data.tier === 'pro' ? 'Pro 300' : 'Standard 50'}`;
  }

  // Update badge counts
  const badgeNew = document.getElementById('folder-badge-new-count');
  const badgeStale = document.getElementById('folder-badge-stale-count');
  const badgeIngested = document.getElementById('folder-badge-ingested-count');
  const badgeSkipped = document.getElementById('folder-badge-skipped-count');

  if (badgeNew) badgeNew.textContent = data.new_count || 0;
  if (badgeStale) badgeStale.textContent = data.stale_count || 0;
  if (badgeIngested) badgeIngested.textContent = data.ingested_count || 0;
  if (badgeSkipped) badgeSkipped.textContent = data.unsupported_count || 0;

  // Sync stale button visibility
  const btnSyncStale = document.getElementById('btn-sync-stale-docs');
  if (btnSyncStale) {
    if (data.stale_count > 0) {
      btnSyncStale.classList.remove('hidden');
      btnSyncStale.classList.add('inline-flex');
    } else {
      btnSyncStale.classList.add('hidden');
      btnSyncStale.classList.remove('inline-flex');
    }
  }

  // Render file list
  const filesList = document.getElementById('folder-files-list');
  if (!filesList) return;

  if (!data.files || data.files.length === 0) {
    filesList.innerHTML = `
      <div class="p-8 text-center text-xs text-[var(--m3-on-surface-subtle)]">
        ${data.mapping ? 'No supported files found in this folder.' : 'No folder mapped yet. Paste a local folder path or Google Drive link above.'}
      </div>
    `;
    updateIngestButtonCount();
    return;
  }

  filesList.innerHTML = data.files.map((file) => {
    const isNew = file.status === 'new';
    const isStale = file.status === 'stale';
    const isIngested = file.status === 'ingested';
    const isUnsupported = file.status === 'unsupported';

    let iconName = 'file-text';
    if (file.category === 'code') iconName = 'code';
    else if (file.category === 'media') iconName = 'music';
    else if (file.category === 'spreadsheet') iconName = 'table';
    else if (file.extension === '.pdf') iconName = 'file-type-2';

    let badgeHtml = '';
    if (isNew) {
      badgeHtml = `<span class="folder-badge-pill folder-badge-new text-[10px] py-0.5">📥 New</span>`;
    } else if (isStale) {
      badgeHtml = `<span class="folder-badge-pill folder-badge-stale text-[10px] py-0.5">⚡ Stale</span>`;
    } else if (isIngested) {
      badgeHtml = `<span class="folder-badge-pill folder-badge-ingested text-[10px] py-0.5">✅ Ingested</span>`;
    } else {
      badgeHtml = `<span class="folder-badge-pill folder-badge-skipped text-[10px] py-0.5">⏭️ Skipped</span>`;
    }

    const sizeStr = file.size_bytes ? `${Math.round(file.size_bytes / 1024)} KB` : '';

    return `
      <div class="p-3 flex items-center justify-between gap-3 hover:bg-[var(--m3-surface-container-high)]/60 transition ${isNew ? 'bg-[var(--google-blue-container)]/5' : ''}">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <input
            type="checkbox"
            class="folder-file-cb rounded bg-[var(--m3-surface)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer w-4 h-4 shrink-0"
            data-path="${escapeHtml(file.path_or_id)}"
            data-name="${escapeHtml(file.name)}"
            data-status="${file.status}"
            ${isNew ? 'checked' : ''}
            ${isUnsupported ? 'disabled' : ''}
          >
          <div class="p-1.5 rounded-lg bg-[var(--m3-surface-container-highest)] text-[var(--m3-on-surface-variant)] shrink-0">
            <i data-lucide="${iconName}" class="w-3.5 h-3.5"></i>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium text-[var(--m3-on-surface)] truncate" title="${escapeHtml(file.name)}">
              ${escapeHtml(file.name)}
            </p>
            <div class="flex items-center gap-2 text-[10px] text-[var(--m3-on-surface-subtle)] font-mono mt-0.5">
              ${sizeStr ? `<span>${sizeStr}</span> • ` : ''}
              <span>${escapeHtml(file.extension.toUpperCase())}</span>
              ${file.requires_code_adapter ? `<span class="text-[var(--google-blue)] font-sans">• Markdown Adapter</span>` : ''}
            </div>
          </div>
        </div>

        <div class="shrink-0 flex items-center gap-2">
          ${badgeHtml}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: filesList });

  // Attach change listener to checkboxes
  filesList.querySelectorAll('.folder-file-cb').forEach(cb => {
    cb.addEventListener('change', updateIngestButtonCount);
  });

  updateIngestButtonCount();
}

function updateIngestButtonCount() {
  const btnIngest = document.getElementById('btn-ingest-folder-files');
  const btnLabel = document.getElementById('btn-ingest-folder-label');
  if (!btnIngest || !btnLabel) return;

  const checkedCount = document.querySelectorAll('.folder-file-cb:checked').length;
  if (checkedCount > 0) {
    btnIngest.disabled = false;
    btnLabel.textContent = `Ingest ${checkedCount} File${checkedCount === 1 ? '' : 's'}`;
  } else {
    btnIngest.disabled = true;
    btnLabel.textContent = 'No Files Selected';
  }
}

async function handleSaveOrScanFolder() {
  if (!state.activeFolderNotebookId) return;
  const targetInput = document.getElementById('folder-target-input');
  const recursiveToggle = document.getElementById('folder-recursive-toggle');
  const btnSave = document.getElementById('btn-save-folder-mapping');

  const path = targetInput ? targetInput.value.trim() : '';
  if (!path) {
    showToast('Please enter a folder path or Google Drive link', 'error');
    return;
  }

  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = '<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin"></i> Scanning...';
    if (window.lucide) lucide.createIcons({ root: btnSave });
  }

  try {
    const res = await fetch(`/api/notebooks/${state.activeFolderNotebookId}/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_path: path,
        recursive: recursiveToggle ? recursiveToggle.checked : false
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to save mapping');
    }

    const data = await res.json();
    state.activeFolderStatus = data;
    if (data.mapping) {
      state.folderMappings[state.activeFolderNotebookId] = data.mapping;
    }
    renderFolderStatusUI(data);
    renderNotebooksGrid();
    showToast(`Folder scanned: ${data.new_count} new, ${data.ingested_count} ingested`, 'success');
  } catch (e) {
    showToast(`Scan error: ${e.message}`, 'error');
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i data-lucide="search" class="w-3.5 h-3.5"></i> Scan Folder';
      if (window.lucide) lucide.createIcons({ root: btnSave });
    }
  }
}

async function handleUnlinkFolder() {
  if (!state.activeFolderNotebookId) return;
  if (!confirm('Unlink this folder from the notebook? No files will be deleted from your drive.')) return;

  try {
    const res = await fetch(`/api/notebooks/${state.activeFolderNotebookId}/folder`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to unlink');

    delete state.folderMappings[state.activeFolderNotebookId];
    renderNotebooksGrid();
    closeFolderMappingModal();
    showToast('Folder unlinked from notebook', 'info');
  } catch (e) {
    showToast(`Unlink error: ${e.message}`, 'error');
  }
}

async function handleSyncFolderAction(action) {
  if (!state.activeFolderNotebookId || state.isFolderSyncing) return;

  const btnIngest = document.getElementById('btn-ingest-folder-files');
  const btnSyncStale = document.getElementById('btn-sync-stale-docs');
  const progressBanner = document.getElementById('folder-sync-progress-banner');
  const progressText = document.getElementById('folder-sync-progress-text');

  // Collect selected files
  const selected = [];
  document.querySelectorAll('.folder-file-cb:checked').forEach(cb => {
    selected.push(cb.getAttribute('data-path'));
  });

  if (action === 'ingest_new' && selected.length === 0) {
    showToast('Please select at least one file to ingest', 'warning');
    return;
  }

  state.isFolderSyncing = true;
  if (btnIngest) btnIngest.disabled = true;
  if (btnSyncStale) btnSyncStale.disabled = true;
  if (progressBanner) progressBanner.classList.remove('hidden');
  if (progressText) {
    progressText.textContent = action === 'sync_stale'
      ? 'Syncing stale Google Drive sources...'
      : `Sequentially ingesting ${selected.length} file(s) with 1.5s rate-limit delay...`;
  }

  try {
    const res = await fetch(`/api/notebooks/${state.activeFolderNotebookId}/folder/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: action,
        selected_files: selected.length > 0 ? selected : null
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Sync failed');
    }

    const data = await res.json();
    showToast(data.message || 'Folder sync completed!', data.success ? 'success' : 'warning');

    // Reload status and notebooks grid
    await loadFolderMappingStatus(state.activeFolderNotebookId);
    await loadNotebooks();
  } catch (e) {
    showToast(`Sync error: ${e.message}`, 'error');
  } finally {
    state.isFolderSyncing = false;
    if (progressBanner) progressBanner.classList.add('hidden');
    if (btnIngest) btnIngest.disabled = false;
    if (btnSyncStale) btnSyncStale.disabled = false;
  }
}

// Global window bindings for inline HTML event handlers
window.handleTriggerLogin = handleTriggerLogin;
window.handleSyncAll = handleSyncAll;
window.renderAuthAlertBanner = renderAuthAlertBanner;

