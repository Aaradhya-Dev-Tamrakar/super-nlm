// Central reactive state, session persistence, and course classification helpers.

export const state = {
  profiles: [],
  notebooks: [],
  activeProfileFilter: 'all',
  activeCategoryFilter: 'all', // 'all' | 'study' | 'projects'
  searchQuery: '',
  notebookPage: 0,
  notebookPageFilter: null,
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
  showPendingAccountPills: false,
  showPendingSidebarAccounts: false,
  accountsModalFilter: 'all',
  accountsModalSearch: '',
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

export function saveCrossSynthesisToSession() {
  try {
    const payload = {
      prompt: state.crossSynthesis.prompt || '',
      selectedNotebooks: state.crossSynthesis.selectedNotebooks || [],
      data: state.crossSynthesis.data || null,
      error: state.crossSynthesis.error || null,
    };
    sessionStorage.setItem('super_nlm_cross_synthesis', JSON.stringify(payload));
  } catch (_) {}
}

export function loadCrossSynthesisFromSession() {
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
  } catch (_) {}
}

loadCrossSynthesisFromSession();

const COURSE_CODE_REGEX = /^([A-Z]{2,4}\s*\d{3}(?:\s*\d{2})?)\s*[-:]\s*(.+)/i;

export function isStudyNotebook(notebook) {
  if (!notebook) return false;
  if (notebook.is_study === true || notebook.category === 'study') return true;
  const title = (notebook.title || '').trim();
  return COURSE_CODE_REGEX.test(title);
}

export function getCourseCode(notebook) {
  if (!notebook) return null;
  if (notebook.course_code) return notebook.course_code;
  const title = (notebook.title || '').trim();
  const match = title.match(COURSE_CODE_REGEX);
  if (match) return match[1].toUpperCase();
  return null;
}
