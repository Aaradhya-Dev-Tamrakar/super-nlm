// Super-NLM Hub Frontend Application Logic
// Enhanced with UI/UX Pro Max & Motion Design Standards

let state = {
  profiles: [],
  notebooks: [],
  activeProfileFilter: 'all',
  searchQuery: '',
  selectedNotebooks: new Map(), // key: notebookId, value: { notebookId, profileId, title }
  activeChat: null, // { notebookId, profileId, title }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadProfiles();
  await loadNotebooks();
  if (window.lucide) lucide.createIcons();
});

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

  // Chat Modal close
  const closeChatBtn = document.getElementById('close-modal-chat');
  if (closeChatBtn) closeChatBtn.addEventListener('click', () => closeModal('modal-chat'));
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

// ----------------- API CALLS -----------------

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    if (res.ok) {
      state.profiles = await res.json();
      const accountsCount = document.getElementById('accounts-count');
      if (accountsCount) accountsCount.textContent = state.profiles.length;
      
      const proProfile = state.profiles.find(p => p.isDefaultPro);
      if (proProfile && proProfile.email) {
        const proLabel = document.getElementById('pro-email-label');
        if (proLabel) proLabel.textContent = proProfile.email;
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
    renderAccountPills();
    renderNotebooksGrid();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    showToast(`Synced ${synced.length} notebooks across ${state.profiles.length} accounts (${elapsed}s)`, 'success');
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Sync error: ' + err.message, 'error');
  } finally {
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
    badge: null
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
      badge: p.isDefaultPro ? '⭐️ PRO AI' : (p.tier === 'pro' ? 'PRO' : null)
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
  addBtn.className = 'btn-tactile flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-indigo-300 hover:bg-slate-800/80 border border-dashed border-slate-700/80 transition whitespace-nowrap';
  addBtn.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5"></i> <span>Add Account</span>';
  addBtn.addEventListener('click', () => {
    openModal('modal-accounts');
    renderAccountsModalList();
  });
  container.appendChild(addBtn);

  if (window.lucide) lucide.createIcons();
}

function createPill({ id, label, count, color, isActive, badge }) {
  const btn = document.createElement('button');
  const baseClasses = 'glass-pill btn-tactile flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap cursor-pointer';
  const activeClasses = isActive ? 'active' : 'text-slate-400 hover:text-slate-200';

  btn.className = `${baseClasses} ${activeClasses}`;
  
  let dotHtml = '';
  if (color) {
    dotHtml = `<span class="w-2 h-2 rounded-full shrink-0 shadow-sm" style="background-color: ${color}; box-shadow: 0 0 6px ${color}80;"></span>`;
  }

  let badgeHtml = '';
  if (badge) {
    badgeHtml = `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">${badge}</span>`;
  }

  btn.innerHTML = `
    ${dotHtml}
    <span class="tracking-tight">${escapeHtml(label)}</span>
    ${badgeHtml}
    <span class="px-1.5 py-0.5 text-[10px] rounded-md bg-slate-800/80 text-slate-400 font-mono font-medium">${count}</span>
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
    const cardClass = isPro ? 'glass-card glass-card-pro' : 'glass-card';

    return `
      <div 
        class="${cardClass} card-stagger-enter rounded-2xl p-5 flex flex-col justify-between group relative ${isSelected ? 'ring-2 ring-indigo-500 bg-indigo-950/30' : ''}"
        style="animation-delay: ${Math.min(idx * 30, 300)}ms;"
      >
        
        <!-- Top row: Selection Checkbox, Account Badge, Pro Badge -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="flex items-center gap-2.5">
            <input
              type="checkbox"
              data-id="${notebook.id}"
              data-profile="${notebook.profileId}"
              data-title="${escapeHtml(notebook.title)}"
              class="notebook-select-checkbox rounded-md bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer w-4 h-4 transition-transform active:scale-90"
              ${isSelected ? 'checked' : ''}
            >
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border shadow-sm"
                  style="border-color: ${notebook.color}40; background-color: ${notebook.color}15; color: ${notebook.color}">
              <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${notebook.color}"></span>
              <span class="font-medium">${escapeHtml(notebook.profileName)}</span>
            </span>
          </div>

          ${isPro ? `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm shadow-amber-500/10">
              <i data-lucide="sparkles" class="w-3 h-3 text-amber-400"></i> PRO AI
            </span>
          ` : `
            <span class="text-[11px] font-mono text-slate-500">${escapeHtml(notebook.profileId)}</span>
          `}
        </div>

        <!-- Notebook Title & Meta -->
        <div class="mb-4 flex-1">
          <h3 class="text-sm font-semibold text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-2 leading-snug tracking-tight">
            ${escapeHtml(notebook.title)}
          </h3>
          <div class="flex items-center gap-3 mt-2 text-[11px] text-slate-400 font-medium">
            <span class="flex items-center gap-1.5">
              <i data-lucide="file-text" class="w-3.5 h-3.5 text-slate-500"></i>
              <span class="font-mono text-slate-300">${notebook.source_count || 0}</span> sources
            </span>
            <span class="text-slate-600">•</span>
            <span class="flex items-center gap-1.5">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-slate-500"></i>
              <span>${dateFormatted}</span>
            </span>
          </div>
        </div>

        <!-- Bottom Action Row -->
        <div class="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-2">
          <!-- Ask Notebook Button -->
          <button
            onclick="openChatModal('${notebook.id}', '${notebook.profileId}', '${escapeHtml(notebook.title)}')"
            class="btn-tactile flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-indigo-600 hover:text-white text-slate-300 border border-slate-700/80 transition-colors shadow-sm"
          >
            <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            <span>Ask</span>
          </button>

          <!-- Deep Link to NotebookLM Web -->
          <a
            href="https://notebooklm.google.com/notebook/${notebook.id}"
            target="_blank"
            rel="noopener noreferrer"
            title="Open in official NotebookLM web interface"
            class="btn-tactile flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-300 transition-colors py-1 px-2 rounded-lg hover:bg-slate-800/50"
          >
            <span>Open Web</span>
            <i data-lucide="external-link" class="w-3 h-3 text-slate-500 group-hover:text-indigo-400"></i>
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
      <div class="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-slate-700/80 transition-all">
        <div class="flex items-center gap-3">
          <span class="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm" style="background-color: ${p.color}; box-shadow: 0 0 8px ${p.color}80;"></span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white tracking-tight">${escapeHtml(p.displayName)}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">${p.id}</span>
              ${isPro ? `
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                  <i data-lucide="sparkles" class="w-2.5 h-2.5"></i> DEFAULT PRO AI
                </span>
              ` : ''}
            </div>
            <p class="text-[11px] text-slate-400 font-mono mt-0.5">${escapeHtml(p.email || 'No email reported yet')}</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Re-login button -->
          <button
            onclick="handleTriggerLogin('${p.id}')"
            title="Authenticate or re-login with Google Chrome"
            class="btn-tactile px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <i data-lucide="log-in" class="w-3.5 h-3.5 inline text-slate-400"></i>
            <span>Login</span>
          </button>

          <!-- Toggle Pro button -->
          ${!isPro ? `
            <button
              onclick="handleSetPro('${p.id}')"
              title="Set this account as the primary Pro AI synthesis engine"
              class="btn-tactile px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition"
            >
              Make Pro
            </button>
          ` : ''}

          <!-- Delete account button -->
          <button
            onclick="handleDeleteAccount('${p.id}')"
            title="Delete account profile"
            class="btn-tactile p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
          >
            <i data-lucide="trash-2" class="w-4 h-4"></i>
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
      showToast(`Account profile '${name}' added! ${launchLogin ? 'Opening Chrome window...' : ''}`, 'success');
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

// ----------------- CHAT MODAL -----------------

window.openChatModal = function(notebookId, profileId, title) {
  state.activeChat = { notebookId, profileId, title };
  document.getElementById('chat-modal-title').textContent = title;
  document.getElementById('chat-modal-subtitle').textContent = `Account: ${profileId}`;
  
  const thread = document.getElementById('chat-thread');
  thread.innerHTML = `
    <div class="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 text-xs text-slate-300 flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-indigo-400 shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong> via account <code class="px-1 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono">${profileId}</code>. Ask any question to its sources below.</span>
    </div>
  `;

  openModal('modal-chat');
  if (window.lucide) lucide.createIcons();
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.focus();
};

async function handleChatSubmit(e) {
  e.preventDefault();
  if (!state.activeChat) return;

  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  const thread = document.getElementById('chat-thread');

  // Append user bubble
  thread.innerHTML += `
    <div class="flex justify-end animate-modal-enter">
      <div class="max-w-md p-3.5 rounded-2xl rounded-tr-sm bg-gradient-to-r from-indigo-600 to-indigo-500 text-white text-xs leading-relaxed shadow-md shadow-indigo-600/20">
        ${escapeHtml(question)}
      </div>
    </div>
  `;

  // Append loading bubble
  const loaderId = 'loader-' + Date.now();
  thread.innerHTML += `
    <div id="${loaderId}" class="flex items-start gap-2.5 animate-modal-enter">
      <div class="w-7 h-7 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-indigo-400 shadow-sm shrink-0">
        <i data-lucide="bot" class="w-4 h-4"></i>
      </div>
      <div class="p-3.5 rounded-2xl rounded-tl-sm bg-slate-900/80 text-slate-300 text-xs flex items-center gap-2 border border-slate-800">
        <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-indigo-400"></i>
        <span>Querying notebook sources...</span>
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
      const fallbackBadge = data.handledByProFallback ? `
        <div class="mb-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <i data-lucide="sparkles" class="w-3 h-3 text-amber-400"></i>
          <span>${escapeHtml(data.fallbackReason || 'Handled via Pro AI Engine Fallback')}</span>
        </div>
      ` : '';

      thread.innerHTML += `
        <div class="flex items-start gap-2.5 animate-modal-enter">
          <div class="w-7 h-7 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-indigo-400 shadow-sm shrink-0">
            <i data-lucide="bot" class="w-4 h-4"></i>
          </div>
          <div class="flex-1 p-4 rounded-2xl rounded-tl-sm bg-slate-900/90 text-slate-200 text-xs leading-relaxed border border-slate-800 shadow-sm whitespace-pre-wrap">
            ${fallbackBadge}
            ${escapeHtml(answer)}
          </div>
        </div>
      `;
    } else {
      const err = await res.json();
      thread.innerHTML += `
        <div class="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs animate-modal-enter flex items-center gap-2">
          <i data-lucide="alert-circle" class="w-4 h-4 text-rose-400 shrink-0"></i>
          <span>Query failed: ${escapeHtml(err.detail || 'Error running query')}</span>
        </div>
      `;
    }
  } catch (err) {
    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();
    thread.innerHTML += `
      <div class="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs animate-modal-enter flex items-center gap-2">
        <i data-lucide="wifi-off" class="w-4 h-4 text-rose-400 shrink-0"></i>
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
    showToast('Please select at least 2 notebooks from different accounts first!', 'info');
    return;
  }

  container.innerHTML = selected.map(n => `
    <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-slate-900/80 border border-slate-700/80 text-slate-200 shadow-sm">
      <span class="font-mono text-indigo-400 text-[10px]">${escapeHtml(n.profileId)}</span>
      <span class="text-slate-600">:</span>
      <strong class="font-medium tracking-tight">${escapeHtml(n.title)}</strong>
    </span>
  `).join('');

  document.getElementById('cross-results-container').classList.add('hidden');
  document.getElementById('cross-results-body').textContent = '';
  openModal('modal-cross');
}

async function handleRunCrossSynthesis() {
  const prompt = document.getElementById('cross-prompt-input').value.trim();
  if (!prompt) {
    showToast('Please enter a synthesis prompt or research goal!', 'info');
    return;
  }

  const selected = Array.from(state.selectedNotebooks.values());
  const btn = document.getElementById('btn-run-cross-synthesis');
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Synthesizing across accounts...</span>';
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
      resultsBody.textContent = data.combinedContext || 'No synthesis produced.';
      resultsContainer.classList.remove('hidden');
      showToast('Cross-account synthesis completed!', 'success');
    } else {
      const err = await res.json();
      showToast('Synthesis error: ' + (err.detail || 'Failed to synthesize'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i> <span>Run Multi-Account Synthesis</span>';
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
  const bg = type === 'error' ? 'bg-rose-950/90 border-rose-600/50 text-rose-200'
           : type === 'success' ? 'bg-emerald-950/90 border-emerald-600/50 text-emerald-200'
           : 'bg-slate-900/95 border-slate-700/80 text-slate-200';
  const icon = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info';

  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs font-semibold shadow-2xl backdrop-blur-xl transition-all duration-300 transform translate-y-3 opacity-0 ${bg}`;
  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons({
      root: toast
    });
  }

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-3', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-3');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}
