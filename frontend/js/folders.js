// Hybrid Folder Mapping & Auto-Sync Controller.
import { apiFetch, loadNotebooks } from './api.js';
import { renderNotebooksGrid } from './notebooks.js';
import { state } from './state.js';
import { closeModal, escapeHtml, openModal, showToast } from './ui.js';

export function initFolderMappingController() {
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

export async function openFolderMappingModal(notebookId, title) {
  state.activeFolderNotebookId = notebookId;
  const modal = document.getElementById('modal-folder-mapping');
  const nbTitleEl = document.getElementById('folder-modal-nb-title');
  if (nbTitleEl) nbTitleEl.textContent = title || `Notebook ${notebookId.slice(0, 8)}`;

  openModal('modal-folder-mapping');
  if (modal && window.lucide) {
    lucide.createIcons({ root: modal });
  }

  await loadFolderMappingStatus(notebookId);
}

export function closeFolderMappingModal() {
  closeModal('modal-folder-mapping');
  state.activeFolderNotebookId = null;
  state.activeFolderStatus = null;
}

export async function loadFolderMappingStatus(notebookId) {
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
    const res = await apiFetch(`/api/notebooks/${notebookId}/folder`);
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

export function renderFolderStatusUI(data) {
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

export function updateIngestButtonCount() {
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

export async function handleSaveOrScanFolder() {
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
    const res = await apiFetch(`/api/notebooks/${state.activeFolderNotebookId}/folder`, {
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

export async function handleUnlinkFolder() {
  if (!state.activeFolderNotebookId) return;
  if (!confirm('Unlink this folder from the notebook? No files will be deleted from your drive.')) return;

  try {
    const res = await apiFetch(`/api/notebooks/${state.activeFolderNotebookId}/folder`, {
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

export async function handleSyncFolderAction(action) {
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
    const res = await apiFetch(`/api/notebooks/${state.activeFolderNotebookId}/folder/sync`, {
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
