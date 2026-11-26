// Batch Share Notebooks Modal controller.
import { apiFetch, loadNotebooks } from './api.js';
import { getCourseCode, isStudyNotebook, state } from './state.js';
import { escapeHtml, openModal, showToast } from './ui.js';

export const batchShareSelectedNotebookIds = new Set();
export const batchShareSelectedProfileIds = new Set();

export function openBatchShareModal() {
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

export function updateBatchShareCounts() {
  const nbCountEl = document.getElementById('batch-share-selected-nb-count');
  if (nbCountEl) nbCountEl.textContent = batchShareSelectedNotebookIds.size;
  const accCountEl = document.getElementById('batch-share-selected-acc-count');
  if (accCountEl) accCountEl.textContent = batchShareSelectedProfileIds.size;
}

export function renderBatchShareNotebooksList() {
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

export function renderBatchShareAccountsList() {
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

export async function handleExecuteBatchShare() {
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
    const res = await apiFetch('/api/notebooks/batch-share', {
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
