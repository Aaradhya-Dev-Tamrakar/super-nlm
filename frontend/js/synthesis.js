// Cross-account synthesis modal, execution, result rendering, and PDF export.
import { apiFetch, setGlobalLoading } from './api.js';
import { renderMarkdown } from './chat.js';
import { saveCrossSynthesisToSession, state } from './state.js';
import { escapeHtml, openModal, showToast } from './ui.js';

let lastCrossSynthesisResult = null;

export function renderCrossSynthesisResults(data) {
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

export function handleResetCrossSynthesis() {
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
  } catch (_) {}

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

export function openCrossSynthesisModal() {
  const container = document.getElementById('cross-notebooks-chips');
  const selected = Array.from(state.selectedNotebooks.values());

  if (selected.length === 0 && (!state.crossSynthesis.selectedNotebooks || state.crossSynthesis.selectedNotebooks.length === 0)) {
    showToast('Select at least 2 notebooks from different accounts first.', 'info');
    return;
  }

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

export async function handleRunCrossSynthesis() {
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
    const res = await apiFetch('/api/cross-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebooks: targetNotebooks,
        question: prompt,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      state.crossSynthesis.inFlight = false;
      state.crossSynthesis.data = data;
      state.crossSynthesis.error = null;

      lastCrossSynthesisResult = {
        ...data,
        prompt,
        notebooks: targetNotebooks,
        timestamp: new Date().toLocaleString(),
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

export function exportSynthesisPdf(scope = 'both') {
  if (!lastCrossSynthesisResult) {
    showToast('No active synthesis result to export as PDF.', 'info');
    return;
  }

  const { prompt, notebooks, synthesizedBrief, combinedContext, synthesisModel, timestamp, notebookResults } = lastCrossSynthesisResult;

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
    @page { size: A4 portrait; margin: 18mm 16mm 18mm 16mm; }
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; background: #ffffff; line-height: 1.6; font-size: 10.5pt; margin: 0; padding: 0; }
    .print-header { border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-start; }
    .brand-title { font-size: 16pt; font-weight: 700; color: #1e3a8a; letter-spacing: -0.4px; margin: 0 0 3px 0; }
    .brand-subtitle { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; margin: 0; font-weight: 600; }
    .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 22px; page-break-inside: avoid; break-inside: avoid; }
    .meta-row { display: flex; margin-bottom: 6px; font-size: 9pt; line-height: 1.4; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label { font-weight: 600; width: 140px; color: #475569; flex-shrink: 0; }
    .meta-value { color: #0f172a; flex: 1; }
    .chip { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 2px 7px; border-radius: 4px; font-size: 8pt; font-weight: 500; margin-right: 5px; margin-bottom: 3px; }
    .badge-scope { display: inline-block; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 2px 7px; border-radius: 4px; font-size: 8pt; font-weight: 600; }
    .badge-pro { display: inline-block; background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; padding: 2px 7px; border-radius: 4px; font-size: 8pt; font-weight: 600; }
    .section-badge { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #2563eb; background: #eff6ff; display: inline-block; padding: 2px 8px; border-radius: 4px; border: 1px solid #bfdbfe; margin-bottom: 8px; }
    h1, h2, h3, h4, h5, h6 { color: #0f172a; font-weight: 600; page-break-after: avoid; break-after: avoid; }
    h1 { font-size: 14pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 20px; margin-bottom: 10px; }
    h2 { font-size: 12.5pt; margin-top: 18px; margin-bottom: 8px; color: #1e40af; }
    h3 { font-size: 11pt; margin-top: 14px; margin-bottom: 6px; }
    p { margin: 0 0 9px 0; }
    ul, ol { margin: 0 0 10px 0; padding-left: 22px; }
    li { margin-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 9pt; page-break-inside: avoid; break-inside: avoid; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    tr:nth-child(even) td { background: #f8fafc; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 8.5pt; background: #f1f5f9; padding: 1.5px 4.5px; border-radius: 3px; color: #0f172a; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 8pt; page-break-inside: avoid; break-inside: avoid; }
    blockquote { margin: 10px 0; padding: 6px 12px; border-left: 3.5px solid #2563eb; background: #f8fafc; color: #334155; font-style: italic; }
    .appendix-page { page-break-before: always; break-before: page; margin-top: 28px; padding-top: 18px; border-top: 2px dashed #94a3b8; }
    .standalone-appendix { margin-top: 10px; }
    .appendix-title { font-size: 13pt; font-weight: 700; color: #1e293b; margin-bottom: 6px; }
    .appendix-desc { font-size: 8.5pt; color: #64748b; margin-bottom: 16px; line-height: 1.4; }
    .raw-card { background: #fbfcfe; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; page-break-inside: avoid; break-inside: avoid; }
    .raw-card-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
    .raw-card-title { font-weight: 700; font-size: 10.5pt; color: #1e3a8a; }
    .chip-profile { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-size: 7.5pt; font-family: ui-monospace, SFMono-Regular, monospace; }
    .print-footer { margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 8pt; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
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
