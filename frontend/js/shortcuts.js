// Global keyboard shortcuts, modal wiring, and DOM event listeners.
import { handleAddAccountSubmit, renderAccountsModalList } from './accounts.js';
import {
  closeRemoteAuthModal,
  handleRemoteAuthSubmit,
  handleSyncAll,
  openRemoteAuthModal,
  setStoredApiKey,
  updateRemoteApiKeyBadge,
} from './api.js';
import { loadCalendarAgenda, toggleAgendaCollapse, toggleUpcomingEvents } from './calendar.js';
import { handleChatSubmit, handleClearCurrentChat } from './chat.js';
import {
  clearSelection,
  renderAccountPills,
  renderNotebooksGrid,
  toggleSelectAllVisible,
  toggleStudyFilter,
} from './notebooks.js';
import { closeSchedulerModal, openSchedulerModal } from './scheduler.js';
import {
  batchShareSelectedNotebookIds,
  batchShareSelectedProfileIds,
  handleExecuteBatchShare,
  openBatchShareModal,
  renderBatchShareAccountsList,
  renderBatchShareNotebooksList,
  updateBatchShareCounts,
} from './sharing.js';
import { isStudyNotebook, saveCrossSynthesisToSession, state } from './state.js';
import {
  exportSynthesisPdf,
  handleResetCrossSynthesis,
  handleRunCrossSynthesis,
  openCrossSynthesisModal,
} from './synthesis.js';
import {
  applyTheme,
  closeModal,
  fallbackCopyText,
  isModalOpen,
  openModal,
  showToast,
  toggleRightSidebarCollapse,
  toggleSidebarCollapse,
  toggleThemeMode,
} from './ui.js';
import { loadFleetUsage, openUsageLimitsModal } from './usage.js';

export function setupEventListeners() {
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

    const fleetDialog = document.getElementById('fleet-dialog');
    if (fleetDialog?.open) {
      if (e.key === 'Escape' || (!isInputActive && e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat)) {
        e.preventDefault();
        fleetDialog.close();
      }
      return;
    }

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
      const openModalIds = ['modal-shortcuts', 'modal-chat', 'modal-accounts', 'modal-cross', 'modal-batch-share', 'modal-usage', 'modal-scheduler', 'modal-folder-mapping', 'auth-key-modal'];
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
    const anyModalOpen = ['modal-chat', 'modal-accounts', 'modal-cross', 'modal-shortcuts', 'modal-batch-share', 'modal-usage', 'modal-scheduler', 'modal-folder-mapping', 'auth-key-modal'].some(id => isModalOpen(id));
    if (anyModalOpen) return;

    // Shortcut 'f': Open Fleet Batches (generation and downloads).
    if (e.key.toLowerCase() === 'f' && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      document.getElementById('btn-open-fleet-downloads')?.click();
      return;
    }

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

    // Shortcut 'q': Toggle Batch Queue & Rotation Scheduler
    if (e.key.toLowerCase() === 'q' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (isModalOpen('modal-scheduler')) {
        closeSchedulerModal();
      } else {
        openSchedulerModal();
      }
      return;
    }

    // Shortcut 'l': Toggle Account Usage & Quota Limits
    if (e.key.toLowerCase() === 'l' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (isModalOpen('modal-usage')) {
        closeModal('modal-usage');
      } else {
        openUsageLimitsModal();
      }
      return;
    }

    // Shortcut 'b': Toggle Batch Share Manager
    if (e.key.toLowerCase() === 'b' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (isModalOpen('modal-batch-share')) {
        closeModal('modal-batch-share');
      } else {
        openBatchShareModal();
      }
      return;
    }

    // Shortcut 'k': Toggle Remote Access Key Configuration
    if (e.key.toLowerCase() === 'k' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (isModalOpen('auth-key-modal')) {
        closeRemoteAuthModal();
      } else {
        openRemoteAuthModal();
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

    // Shortcut ']' (without Shift/Ctrl): Toggle Right Sidebar (Fleet Tools Panel)
    if (e.key === ']' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleRightSidebarCollapse();
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

  const openAuthKeyBtn = document.getElementById('btn-open-auth-key-modal');
  if (openAuthKeyBtn) {
    openAuthKeyBtn.addEventListener('click', openRemoteAuthModal);
  }

  const authKeyForm = document.getElementById('auth-key-form');
  if (authKeyForm) {
    authKeyForm.addEventListener('submit', handleRemoteAuthSubmit);
  }

  const clearAuthKeyBtn = document.getElementById('btn-clear-auth-key');
  if (clearAuthKeyBtn) {
    clearAuthKeyBtn.addEventListener('click', () => {
      const input = document.getElementById('auth-key-input');
      if (input) input.value = '';
      setStoredApiKey('');
      updateRemoteApiKeyBadge();
      closeRemoteAuthModal();
      showToast('Remote access key cleared.', 'info');
    });
  }

  const closeAuthKeyBtn = document.getElementById('close-auth-key-modal');
  if (closeAuthKeyBtn) {
    closeAuthKeyBtn.addEventListener('click', closeRemoteAuthModal);
  }

  // Dismiss modals on backdrop click
  ['modal-shortcuts', 'modal-chat', 'modal-accounts', 'modal-cross', 'modal-batch-share', 'modal-usage', 'modal-scheduler', 'modal-folder-mapping', 'auth-key-modal'].forEach(id => {
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

  // Right sidebar toggle buttons
  const rightSidebarToggleBtn = document.getElementById('btn-toggle-right-sidebar');
  if (rightSidebarToggleBtn) {
    rightSidebarToggleBtn.addEventListener('click', toggleRightSidebarCollapse);
  }

  const rightSidebarCollapseChevron = document.getElementById('btn-right-sidebar-collapse-chevron');
  if (rightSidebarCollapseChevron) {
    rightSidebarCollapseChevron.addEventListener('click', toggleRightSidebarCollapse);
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
}
