// Notebook grid rendering, tier grouping, account pills, category filters, and selection.
import { getCourseCode, isStudyNotebook, state } from './state.js';
import { escapeHtml, highlightMatch, openModal, refreshIcons, showToast } from './ui.js';

let notebookHooks = {
  renderAccountsModalList: () => {},
  openChatModal: (..._args) => {},
};

export function registerNotebookHooks(hooks) {
  notebookHooks = { ...notebookHooks, ...hooks };
}

export function partitionProfilesByTier(profiles) {
  const proProfiles = [];
  const standardProfiles = [];
  for (const p of (profiles || [])) {
    if (p.isDefaultPro || p.tier === 'pro') {
      proProfiles.push(p);
    } else {
      standardProfiles.push(p);
    }
  }
  proProfiles.sort((a, b) => Number(Boolean(b.isDefaultPro)) - Number(Boolean(a.isDefaultPro)));
  return { proProfiles, standardProfiles };
}

export function createPill({ id, label, count, color, isActive, isPro, isExpired, email, lastError }) {
  const btn = document.createElement('button');
  const baseClasses = 'm3-chip flex items-center gap-1.5 px-3 py-1 text-xs transition whitespace-nowrap cursor-pointer';
  const activeClasses = isActive ? 'active font-medium' : 'hover:text-[var(--m3-on-surface)]';
  const expiredClasses = isExpired ? 'auth-expired-pill border-[var(--google-red)]/50 text-[var(--google-red)]' : '';

  btn.className = `${baseClasses} ${activeClasses} ${expiredClasses}`;
  if (isExpired) {
    btn.title = `⚠️ Auth Expired for ${label} (${email || ''})${lastError ? ` - ${lastError}` : ''}. Click to filter or relogin.`;
  } else if (isPro) {
    btn.title = `${label} (${email || ''}) • Gemini Pro AI Tier`;
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
  } else if (isPro && id !== 'all') {
    badgeHtml = `<span class="text-[10px] text-[var(--google-yellow)] shrink-0" title="Pro AI Tier">✨</span>`;
  }

  btn.innerHTML = `
    ${dotHtml}
    <span class="tracking-tight">${escapeHtml(label)}</span>
    ${badgeHtml}
    <span class="px-1.5 py-0.2 text-[10px] rounded-full m3-subcard font-mono ${isExpired ? 'text-[var(--google-red)] font-bold' : 'text-[var(--m3-on-surface-subtle)]'}">${count}</span>
  `;
  return btn;
}

export function renderAccountPills() {
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

  const uniqueCount = new Set(state.notebooks.map(n => n.id)).size;
  const allPill = createPill({
    id: 'all',
    label: 'All Accounts',
    count: uniqueCount,
    isActive: state.activeProfileFilter === 'all',
    isPro: false,
  });
  allPill.addEventListener('click', () => {
    state.activeProfileFilter = 'all';
    renderAccountPills();
    renderNotebooksGrid();
  });
  container.appendChild(allPill);

  const isVisiblePill = (p) => p.status === 'connected' || p.id === state.activeProfileFilter;
  const hasConnectedOrActive = state.profiles.some(isVisiblePill);
  const pillsPool = (!state.showPendingAccountPills && hasConnectedOrActive)
    ? state.profiles.filter(isVisiblePill)
    : state.profiles;
  const hiddenPendingCount = state.profiles.length - pillsPool.length;

  const { proProfiles, standardProfiles } = partitionProfilesByTier(pillsPool);
  const appendProfilePill = (p) => {
    const isExpired = p.status === 'expired';
    const count = state.notebooks.filter(n => n.profileId === p.id).length;
    const pill = createPill({
      id: p.id,
      label: p.displayName || p.id,
      count,
      color: p.color,
      isActive: state.activeProfileFilter === p.id,
      isPro: p.isDefaultPro || p.tier === 'pro',
      isExpired,
      email: p.email,
      lastError: p.lastError,
    });
    pill.addEventListener('click', () => {
      state.activeProfileFilter = p.id;
      renderAccountPills();
      renderNotebooksGrid();
    });
    container.appendChild(pill);
  };

  proProfiles.forEach(appendProfilePill);
  if (proProfiles.length > 0 && standardProfiles.length > 0) {
    const divider = document.createElement('span');
    divider.className = 'w-px h-5 bg-[var(--m3-outline-variant)] mx-0.5 shrink-0';
    divider.setAttribute('aria-hidden', 'true');
    container.appendChild(divider);
  }
  standardProfiles.forEach(appendProfilePill);

  if (hiddenPendingCount > 0 || (state.showPendingAccountPills && state.profiles.some(p => !isVisiblePill(p)))) {
    const pendingToggleBtn = document.createElement('button');
    pendingToggleBtn.type = 'button';
    pendingToggleBtn.id = 'btn-toggle-pending-pills';
    pendingToggleBtn.className = 'google-btn-outlined flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] transition whitespace-nowrap cursor-pointer';
    pendingToggleBtn.innerHTML = state.showPendingAccountPills
      ? '<i data-lucide="eye-off" class="w-3.5 h-3.5"></i> <span>Hide Pending</span>'
      : `<i data-lucide="eye" class="w-3.5 h-3.5"></i> <span>+${hiddenPendingCount} Pending</span>`;
    pendingToggleBtn.addEventListener('click', () => {
      state.showPendingAccountPills = !state.showPendingAccountPills;
      renderAccountPills();
    });
    container.appendChild(pendingToggleBtn);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'google-btn-outlined flex items-center gap-1.5 px-3 py-1.5 text-xs transition whitespace-nowrap';
  addBtn.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5 text-[var(--google-blue)]"></i> <span>Add Account</span>';
  addBtn.addEventListener('click', () => {
    openModal('modal-accounts');
    notebookHooks.renderAccountsModalList();
  });
  container.appendChild(addBtn);

  renderSidebarAccounts();

  refreshIcons(container);
}

export function renderSidebarAccounts() {
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

  const html = `
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

  const renderSidebarProfileBtn = (p) => {
    const isExpired = p.status === 'expired';
    const count = state.notebooks.filter(n => n.profileId === p.id).length;
    const isActive = state.activeProfileFilter === p.id;
    const isPro = p.isDefaultPro || p.tier === 'pro';

    return `
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
  };

  const { proProfiles, standardProfiles } = partitionProfilesByTier(state.profiles);
  let innerHtml = '';
  if (proProfiles.length > 0) {
    innerHtml += `
      <div class="flex items-center justify-between px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--google-yellow)]">
        <span class="flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3"></i> AI Pro · Family Plan</span>
        <span class="font-mono text-[var(--m3-on-surface-subtle)]">${proProfiles.length}</span>
      </div>
    `;
    innerHtml += proProfiles.map(renderSidebarProfileBtn).join('');
  }
  if (standardProfiles.length > 0) {
    const activeStandard = standardProfiles.filter(p => p.status !== 'not_logged_in' || p.id === state.activeProfileFilter);
    const pendingStandard = standardProfiles.filter(p => p.status === 'not_logged_in' && p.id !== state.activeProfileFilter);

    innerHtml += `
      <div class="flex items-center justify-between px-2.5 pt-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--m3-on-surface-subtle)]">
        <span>Standard Accounts</span>
        <span class="font-mono">${standardProfiles.length}</span>
      </div>
    `;
    innerHtml += activeStandard.map(renderSidebarProfileBtn).join('');
    if (pendingStandard.length > 0) {
      if (state.showPendingSidebarAccounts) {
        innerHtml += pendingStandard.map(renderSidebarProfileBtn).join('');
      }
      innerHtml += `
        <button
          type="button"
          id="btn-toggle-sidebar-pending"
          class="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 mt-1 rounded-xl text-[11px] font-medium text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] hover:bg-[var(--m3-surface-container-high)] transition cursor-pointer"
        >
          <i data-lucide="${state.showPendingSidebarAccounts ? 'chevron-up' : 'chevron-down'}" class="w-3.5 h-3.5"></i>
          <span>${state.showPendingSidebarAccounts ? 'Hide pending' : `Show ${pendingStandard.length} pending account${pendingStandard.length === 1 ? '' : 's'}`}</span>
        </button>
      `;
    }
  }

  listEl.innerHTML = `<div class="max-h-[340px] overflow-y-auto pr-0.5 space-y-0.5">${html}${innerHtml}</div>`;

  const toggleSidebarPendingBtn = listEl.querySelector('#btn-toggle-sidebar-pending');
  if (toggleSidebarPendingBtn) {
    toggleSidebarPendingBtn.addEventListener('click', () => {
      state.showPendingSidebarAccounts = !state.showPendingSidebarAccounts;
      renderSidebarAccounts();
      if (window.lucide) lucide.createIcons({ root: listEl });
    });
  }

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

export function renderCategoryChips() {
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

  const telemetryCourses = document.getElementById('telemetry-courses');
  if (telemetryCourses) telemetryCourses.textContent = studyCount;

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

export function toggleStudyFilter() {
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

export function getVisibleNotebooks() {
  let list = [];
  if (state.activeProfileFilter !== 'all') {
    list = state.notebooks.filter(n => n.profileId === state.activeProfileFilter);
  } else {
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
            color: n.color,
          }],
        });
      } else {
        const existing = consolidatedMap.get(n.id);
        if (!existing.allProfiles.some(p => p.profileId === n.profileId)) {
          existing.allProfiles.push({
            profileId: n.profileId,
            profileName: n.profileName,
            profileEmail: n.profileEmail,
            tier: n.tier,
            color: n.color,
          });
        }
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

  if (state.activeCategoryFilter === 'study') {
    list = list.filter(n => isStudyNotebook(n));
  } else if (state.activeCategoryFilter === 'projects') {
    list = list.filter(n => !isStudyNotebook(n));
  }

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

export function syncSelectionUI() {
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

export function handleNotebookSelection(clickedNotebookId, event, isDirectCheckbox = false) {
  const visible = getNotebookPage();
  const clickedNotebook = visible.find(n => n.id === clickedNotebookId) || state.notebooks.find(n => n.id === clickedNotebookId);
  if (!clickedNotebook) return;

  const isCtrl = event.ctrlKey || event.metaKey;
  const isShift = event.shiftKey;

  if (isShift && window.getSelection) {
    try {
      window.getSelection().removeAllRanges();
    } catch (_) {}
  }

  if (isShift) {
    const anchorId = state.lastSelectedNotebookId;
    let anchorIdx = visible.findIndex(n => n.id === anchorId);
    const currentIdx = visible.findIndex(n => n.id === clickedNotebookId);

    if (anchorIdx === -1) {
      anchorIdx = 0;
    }

    if (currentIdx !== -1) {
      const start = Math.min(anchorIdx, currentIdx);
      const end = Math.max(anchorIdx, currentIdx);

      if (!isCtrl) {
        state.selectedNotebooks.clear();
      }

      for (let i = start; i <= end; i++) {
        const item = visible[i];
        state.selectedNotebooks.set(item.id, {
          notebookId: item.id,
          profileId: item.profileId,
          title: item.title || 'Untitled Notebook',
        });
      }

      if (!state.lastSelectedNotebookId) {
        state.lastSelectedNotebookId = visible[anchorIdx]?.id || clickedNotebookId;
      }
    }
  } else if (isCtrl) {
    if (state.selectedNotebooks.has(clickedNotebookId)) {
      state.selectedNotebooks.delete(clickedNotebookId);
    } else {
      state.selectedNotebooks.set(clickedNotebookId, {
        notebookId: clickedNotebook.id,
        profileId: clickedNotebook.profileId,
        title: clickedNotebook.title || 'Untitled Notebook',
      });
    }
    state.lastSelectedNotebookId = clickedNotebookId;
  } else if (isDirectCheckbox) {
    if (state.selectedNotebooks.has(clickedNotebookId)) {
      state.selectedNotebooks.delete(clickedNotebookId);
    } else {
      state.selectedNotebooks.set(clickedNotebookId, {
        notebookId: clickedNotebook.id,
        profileId: clickedNotebook.profileId,
        title: clickedNotebook.title || 'Untitled Notebook',
      });
    }
    state.lastSelectedNotebookId = clickedNotebookId;
  } else {
    state.selectedNotebooks.clear();
    state.selectedNotebooks.set(clickedNotebookId, {
      notebookId: clickedNotebook.id,
      profileId: clickedNotebook.profileId,
      title: clickedNotebook.title || 'Untitled Notebook',
    });
    state.lastSelectedNotebookId = clickedNotebookId;
  }

  syncSelectionUI();
}

export function toggleSelectAllVisible() {
  const visible = getNotebookPage();
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
        title: n.title || 'Untitled Notebook',
      });
    });
    state.lastSelectedNotebookId = visible[visible.length - 1]?.id || null;
    showToast(`Selected ${visible.length} notebook${visible.length > 1 ? 's' : ''}`, 'info');
  }
  syncSelectionUI();
}

export const NOTEBOOKS_PER_PAGE = 8;
let gridRenderRaf = null;

export function scheduleNotebooksGridRender() {
  if (gridRenderRaf !== null) {
    cancelAnimationFrame(gridRenderRaf);
  }
  gridRenderRaf = requestAnimationFrame(() => {
    gridRenderRaf = null;
    renderNotebooksGrid();
  });
}

export function getNotebookPage(notebooks = getVisibleNotebooks()) {
  return notebooks.slice(state.notebookPage * NOTEBOOKS_PER_PAGE, (state.notebookPage + 1) * NOTEBOOKS_PER_PAGE);
}

export function renderNotebooksGrid() {
  if (gridRenderRaf !== null) {
    cancelAnimationFrame(gridRenderRaf);
    gridRenderRaf = null;
  }
  const grid = document.getElementById('notebooks-grid');
  const emptyState = document.getElementById('empty-state');
  const visibleCountLabel = document.getElementById('visible-count');
  const filterLabel = document.getElementById('active-filter-label');

  if (!grid || !emptyState) return;

  const filterKey = JSON.stringify([state.activeProfileFilter, state.activeCategoryFilter, state.searchQuery]);
  if (state.notebookPageFilter !== filterKey) {
    state.notebookPage = 0;
    state.notebookPageFilter = filterKey;
  }
  const filtered = getVisibleNotebooks();
  const pageCount = Math.max(1, Math.ceil(filtered.length / NOTEBOOKS_PER_PAGE));
  state.notebookPage = Math.min(state.notebookPage, pageCount - 1);
  const pageNotebooks = getNotebookPage(filtered);
  const start = state.notebookPage * NOTEBOOKS_PER_PAGE;
  const pager = document.getElementById('notebook-pagination');
  if (pager) {
    pager.hidden = filtered.length <= NOTEBOOKS_PER_PAGE;
    document.getElementById('notebook-page-label').textContent = `Page ${state.notebookPage + 1} of ${pageCount}`;
    const previous = document.getElementById('notebook-page-previous');
    const next = document.getElementById('notebook-page-next');
    previous.disabled = state.notebookPage === 0;
    next.disabled = state.notebookPage === pageCount - 1;
    const changePage = delta => {
      state.notebookPage += delta;
      state.lastSelectedNotebookId = null;
      renderNotebooksGrid();
    };
    previous.onclick = () => changePage(-1);
    next.onclick = () => changePage(1);
  }

  if (visibleCountLabel) {
    const visibleCount = new Set(filtered.map(notebook => notebook.id)).size;
    const totalCount = new Set(state.notebooks.map(notebook => notebook.id)).size;
    visibleCountLabel.textContent = filtered.length ? `${start + 1}–${start + pageNotebooks.length}/${visibleCount}` : `0/${totalCount}`;
    visibleCountLabel.setAttribute('aria-label', `${pageNotebooks.length} notebooks on this page, ${visibleCount} matching out of ${totalCount} total notebooks`);
    visibleCountLabel.title = `${visibleCount} matching notebooks out of ${totalCount} unique notebooks across all accounts`;
  }
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
    const isFilteredExpired = activeProfile && activeProfile.status === 'expired';

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
      refreshIcons(emptyState);
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
      refreshIcons(emptyState);
    }
    return;
  }

  emptyState.classList.add('hidden');
  emptyState.classList.remove('flex');

  grid.innerHTML = pageNotebooks.map((notebook, idx) => {
    const isSelected = state.selectedNotebooks.has(notebook.id);
    const dateFormatted = notebook.updated_at ? new Date(notebook.updated_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }) : 'Recent';

    const ownerEmail = notebook.ownerEmail || state.notebooks.find(n => n.id === notebook.id && n.ownerEmail)?.ownerEmail;
    const ownerProfile = ownerEmail ? state.profiles.find(p => (p.email || '').toLowerCase() === ownerEmail.toLowerCase()) : null;
    const ownerName = ownerProfile?.displayName || ownerEmail || 'Owner unknown';
    const ownerColor = ownerProfile?.color || 'var(--m3-outline)';
    const sharedWith = notebook.sharedWith ?? state.notebooks.find(n => n.id === notebook.id && n.sharedWith != null)?.sharedWith;
    const sharingAccounts = (sharedWith || []).filter(c => (c.email || '').toLowerCase() !== (ownerEmail || '').toLowerCase()).map(c => {
      const profile = state.profiles.find(p => (p.email || '').toLowerCase() === (c.email || '').toLowerCase());
      const pending = c.pending === true || c.is_pending === true || c.status === 'pending';
      return { name: profile?.displayName || c.email, color: profile?.color || 'var(--m3-outline)', detail: `${profile?.displayName || c.email} (${c.role || 'shared'}${pending ? ', invitation pending' : ''})`, pending };
    });
    const isPro = notebook.tier === 'pro';
    const isStudy = isStudyNotebook(notebook);
    const courseCode = getCourseCode(notebook);
    const mapping = (state.folderMappings && state.folderMappings[notebook.id]) || null;

    return `
      <div 
        class="m3-card animate-m3-stagger p-3.5 sm:p-4.5 flex flex-col justify-between group relative overflow-hidden cursor-pointer ${isSelected ? 'selected' : ''}"
        data-id="${notebook.id}"
        style="animation-delay: ${Math.min(idx * 20, 200)}ms;"
      >
        <div class="flex items-center justify-between gap-1.5 mb-2 min-w-0">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <input
              type="checkbox"
              data-id="${notebook.id}"
              data-profile="${notebook.profileId}"
              data-title="${escapeHtml(notebook.title)}"
              class="notebook-select-checkbox rounded bg-[var(--m3-surface)] border-[var(--m3-outline)] text-[var(--google-blue)] focus:ring-0 cursor-pointer w-4 h-4 shrink-0 transition-transform active:scale-95"
              ${isSelected ? 'checked' : ''}
            >
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)] min-w-0 max-w-full" title="${escapeHtml(ownerEmail ? `Owner: ${ownerEmail}` : 'Owner has not been verified; sync notebooks to resolve')}">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${ownerColor}"></span>
              <span class="truncate max-w-[100px] sm:max-w-[140px]">${escapeHtml(ownerName)}</span>
              ${sharingAccounts.length ? `<span class="inline-flex items-center -space-x-0.5 shrink-0" aria-label="Shared accounts">${sharingAccounts.slice(0, 6).map(account => `<span class="w-2 h-2 rounded-full border border-[var(--m3-surface)] ${account.pending ? 'opacity-40' : ''}" style="background-color: ${account.color}" title="${escapeHtml(account.detail)}"></span>`).join('')}</span><span class="text-[9px] text-[var(--google-blue)] font-medium font-mono bg-[var(--google-blue-container)]/50 px-1 py-0.2 rounded shrink-0" title="${escapeHtml(`Shared with ${sharingAccounts.length} other accounts: ${sharingAccounts.map(a => a.detail).join('; ')}`)}">+${sharingAccounts.length}</span>` : sharedWith == null ? '<span class="text-[9px] shrink-0" title="Sharing has not been verified; sync notebooks to refresh">+?</span>' : ''}
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0 justify-end">
            ${isStudy && courseCode ? `
              <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-medium bg-[var(--google-blue-container)]/70 text-[var(--google-blue)] border border-[var(--google-blue)]/30 font-mono tracking-tight shrink-0" title="Academic Course NLM: ${escapeHtml(courseCode)}">
                <i data-lucide="graduation-cap" class="w-2.5 h-2.5 text-[var(--google-blue)] shrink-0"></i> ${escapeHtml(courseCode)}
              </span>
            ` : ''}

            ${isPro ? `
              <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-medium text-[var(--google-yellow)] bg-[var(--google-yellow-container)]/30 border border-[var(--google-yellow)]/20 shrink-0" title="Gemini Pro AI Tier">
                <i data-lucide="sparkles" class="w-2.5 h-2.5 text-[var(--google-yellow)] shrink-0"></i> PRO
              </span>
            ` : `
              <span class="text-[9px] sm:text-[10px] font-mono text-[var(--m3-on-surface-subtle)] shrink-0">${escapeHtml(notebook.profileId)}</span>
            `}
          </div>
        </div>

        <div class="mb-3 flex-1 min-w-0">
          <h3 class="text-[13px] sm:text-[14px] font-medium text-[var(--m3-on-surface)] group-hover:text-[var(--google-blue)] transition-colors line-clamp-2 leading-snug tracking-tight min-h-[36px]">
            ${highlightMatch(notebook.title, state.searchQuery)}
          </h3>
          <div class="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--m3-on-surface-subtle)]">
            <span class="flex items-center gap-1 shrink-0">
              <i data-lucide="file-text" class="w-3 h-3 text-[var(--m3-on-surface-subtle)]"></i>
              <span class="font-mono text-[var(--m3-on-surface)] font-medium">${notebook.source_count || 0}</span> sources
            </span>
            <span class="text-[var(--m3-outline-variant)] shrink-0">•</span>
            <span class="flex items-center gap-1 truncate">
              <i data-lucide="clock" class="w-3 h-3 text-[var(--m3-on-surface-subtle)] shrink-0"></i>
              <span class="truncate">${dateFormatted}</span>
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-[var(--m3-outline-variant)] gap-1.5 min-w-0">
          <button
            type="button"
            data-id="${notebook.id}"
            data-profile="${notebook.profileId}"
            data-title="${escapeHtml(notebook.title)}"
            class="btn-query-notebook google-btn-tonal flex items-center gap-1 px-2.5 py-1 text-xs shadow-xs cursor-pointer shrink-0 ${state.activeQueries.has(notebook.id) ? 'border-[var(--google-blue)]/50 bg-[var(--google-blue-container)]/30' : ''}"
            title="Ask or query notebook contents"
          >
            ${state.activeQueries.has(notebook.id) ? `
              <div class="google-quad-dots scale-75 pointer-events-none">
                <span class="google-quad-dot"></span>
                <span class="google-quad-dot"></span>
                <span class="google-quad-dot"></span>
                <span class="google-quad-dot"></span>
              </div>
              <span class="pointer-events-none text-[var(--google-blue)] font-medium text-[11px]">Synthesizing...</span>
            ` : `
              <i data-lucide="message-square" class="w-3 h-3 pointer-events-none"></i>
              <span class="pointer-events-none text-[11px] font-medium">Query</span>
            `}
          </button>

          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-id="${notebook.id}"
              data-title="${escapeHtml(notebook.title)}"
              title="${mapping ? `Mapped to ${escapeHtml(mapping.display_name || mapping.target_path)}` : 'Map Course Folder or Google Drive'}"
              class="btn-open-folder-modal google-btn-outlined flex items-center gap-1 text-[11px] py-1 px-2 cursor-pointer ${mapping ? 'text-[var(--google-blue)] border-[var(--google-blue)]/40 bg-[var(--google-blue-container)]/10 font-medium' : 'text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)]'}"
            >
              <i data-lucide="${mapping ? (mapping.folder_type === 'drive_web' ? 'cloud' : 'folder-check') : 'folder'}" class="w-3 h-3"></i>
              <span>${mapping ? 'Folder' : 'Map'}</span>
            </button>

            <a
              href="https://notebooklm.google.com/notebook/${notebook.id}"
              target="_blank"
              rel="noopener noreferrer"
              title="Open in official Gemini Notebook web interface"
              class="google-btn-outlined flex items-center gap-1 text-[11px] text-[var(--m3-on-surface-subtle)] hover:text-[var(--m3-on-surface)] py-1 px-2"
            >
              <span class="hidden sm:inline">Web</span>
              <span class="sm:hidden">Web</span>
              <i data-lucide="external-link" class="w-2.5 h-2.5 text-[var(--m3-on-surface-subtle)]"></i>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.btn-query-notebook').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.currentTarget;
      const id = target.getAttribute('data-id');
      const profile = target.getAttribute('data-profile');
      const title = target.getAttribute('data-title');
      notebookHooks.openChatModal(id, profile, title);
    });
  });

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

  grid.querySelectorAll('.notebook-select-checkbox').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = cb.getAttribute('data-id');
      handleNotebookSelection(id, e, true);
    });
  });

  grid.querySelectorAll('.m3-card').forEach(card => {
    card.addEventListener('mousedown', (e) => {
      if (e.shiftKey) {
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

  refreshIcons(grid);
}

export function updateSelectionBanner() {
  const banner = document.getElementById('selection-banner');
  if (!banner) return;
  const count = state.selectedNotebooks.size;
  if (count > 0) {
    banner.classList.remove('hidden');
    banner.classList.add('flex');
    const textEl = document.getElementById('selection-text');
    if (textEl) textEl.textContent = `${count} notebook${count > 1 ? 's' : ''} selected across accounts`;
  } else {
    banner.classList.add('hidden');
    banner.classList.remove('flex');
  }
}

export function clearSelection() {
  state.selectedNotebooks.clear();
  state.lastSelectedNotebookId = null;
  syncSelectionUI();
}
