// Batch Creation & Fleet Rotation Queue Controller.
import { apiFetch } from './api.js';
import { getCourseCode, isStudyNotebook, state } from './state.js';
import { escapeHtml, showToast } from './ui.js';

let schedulerPollTimer = null;
const schedulerSelectedNotebooks = new Set();
const NOTIFIED_JOBS_STORAGE_KEY = 'supernlm_notified_download_jobs';
let hasInitializedSchedulerQueue = false;

export function initSchedulerController() {
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

export function openSchedulerModal() {
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

export function closeSchedulerModal() {
  const modal = document.getElementById('modal-scheduler');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

export function switchSchedulerTab(tab) {
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

export function renderSchedulerNotebooksList() {
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

export function getNotifiedJobIds() {
  try {
    const raw = localStorage.getItem(NOTIFIED_JOBS_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

export function saveNotifiedJobIds(set) {
  try {
    localStorage.setItem(NOTIFIED_JOBS_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch (e) {}
}

export function playDownloadChime() {
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

export async function loadSchedulerQueue(showAnimation = false) {
  const refreshIcon = document.getElementById('queue-refresh-icon');
  if (showAnimation && refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const res = await apiFetch('/api/scheduler/status');
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

export function updateQueueBadge(data) {
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

export function renderSchedulerQueueData(data) {
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
          await apiFetch(`/api/scheduler/jobs/${id}/run-now`, { method: 'POST' });
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
          await apiFetch(`/api/scheduler/jobs/${id}`, { method: 'DELETE' });
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

export async function handleExecuteBatchSchedule() {
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
    const res = await apiFetch('/api/scheduler/batch', {
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

export async function handleClearCompletedJobs() {
  try {
    const res = await apiFetch('/api/scheduler/jobs?status=completed');
    if (!res.ok) return;
    const completed = await res.json();
    for (const job of completed) {
      await apiFetch(`/api/scheduler/jobs/${job.id}`, { method: 'DELETE' });
    }
    showToast('Cleared completed jobs from history', 'info');
    loadSchedulerQueue(true);
  } catch (e) {
    console.warn('Error clearing jobs:', e);
  }
}

export function startSchedulerPolling() {
  if (schedulerPollTimer) clearInterval(schedulerPollTimer);
  schedulerPollTimer = setInterval(() => {
    loadSchedulerQueue(false);
  }, 12000);
}
