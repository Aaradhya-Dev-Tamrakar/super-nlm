// Super-NLM Hub Studio Frontend Entrypoint (ES Module Orchestrator)
import {
  handleTriggerLogin,
  initAccountsModalControls,
  initLoginReconcileListeners,
  registerAccountHooks,
  renderAccountsModalList,
  renderAuthAlertBanner,
} from './js/accounts.js';
import {
  apiFetch,
  handleSyncAll,
  loadNotebooks,
  loadProfiles,
  registerApiRenderHooks,
  showSkeletons,
  updateRemoteApiKeyBadge,
} from './js/api.js';
import { loadCalendarAgenda } from './js/calendar.js';
import {
  loadAllChatHistories,
  openChatModal,
  stopThinkingTimer,
  updateBackgroundQueryStatus,
} from './js/chat.js';
import { initFolderMappingController, openFolderMappingModal } from './js/folders.js';
import {
  registerNotebookHooks,
  renderAccountPills,
  renderCategoryChips,
  renderNotebooksGrid,
} from './js/notebooks.js';
import { initSchedulerController, loadSchedulerQueue } from './js/scheduler.js';
import { setupEventListeners } from './js/shortcuts.js';
import { isStudyNotebook, state } from './js/state.js';
import {
  escapeHtml,
  initGoogleRipple,
  initSidebarState,
  initTheme,
  registerChatModalCloseHook,
} from './js/ui.js';
import { loadFleetUsage } from './js/usage.js';

// Wire cross-module hooks to keep dependency graph acyclic
registerChatModalCloseHook(() => {
  if (state.activeChat && state.activeChat.notebookId) {
    stopThinkingTimer(state.activeChat.notebookId);
  }
  updateBackgroundQueryStatus();
});

registerApiRenderHooks({
  renderAuthAlertBanner,
  renderAccountPills,
  renderCategoryChips,
  renderNotebooksGrid,
});

registerNotebookHooks({
  renderAccountsModalList,
  openChatModal,
});

registerAccountHooks({
  loadFleetUsage,
});

// Expose globals required by classic script fleet.js and inline HTML handlers
window.state = state;
window.apiFetch = apiFetch;
window.isStudyNotebook = isStudyNotebook;
window.escapeHtml = escapeHtml;
window.loadSchedulerQueue = loadSchedulerQueue;
window.openChatModal = openChatModal;
window.openFolderMappingModal = openFolderMappingModal;
window.handleTriggerLogin = handleTriggerLogin;
window.handleSyncAll = handleSyncAll;
window.renderAuthAlertBanner = renderAuthAlertBanner;

async function bootApp() {
  initTheme();
  initSidebarState();
  initGoogleRipple();
  loadAllChatHistories();
  setupEventListeners();
  initAccountsModalControls();
  updateRemoteApiKeyBadge();
  renderAccountPills();
  renderCategoryChips();
  showSkeletons(true);
  // Fire non-critical widgets in parallel without blocking initial render
  loadCalendarAgenda();
  loadFleetUsage(false);
  initSchedulerController();
  initFolderMappingController();
  await Promise.all([loadProfiles(), loadNotebooks()]);
  renderAccountPills();
  renderNotebooksGrid();
  showSkeletons(false);
  initLoginReconcileListeners();
  if (window.lucide) lucide.createIcons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
