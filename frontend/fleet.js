/* Bulk fleet interface. Generation/download services are shared with MCP. */
(() => {
  const byId = id => document.getElementById(id);
  const dialog = byId('fleet-dialog');
  const typeLabels = {video: 'Videos', audio: 'Audio', slides: 'Slides', report: 'Reports', quiz: 'Quizzes', flashcards: 'Flashcards', mindmap: 'Mind maps', infographic: 'Infographics', 'data-table': 'Tables'};
  let currentBatch = localStorage.getItem('supernlm_download_batch') || '';
  let generationBatch = localStorage.getItem('supernlm_generation_batch') || '';
  let previewRows = [];
  let timer;
  let busy = false;
  const newKey = () => crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
  let requestKey = newKey();

  async function api(path, method = 'GET', payload) {
    const response = await apiFetch(`/api/fleet${path}`, {method, headers: {'Content-Type': 'application/json'}, ...(payload === undefined ? {} : {body: JSON.stringify(payload)})});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data));
    return data;
  }

  function message(text, error = false) {
    byId('fleet-message').textContent = text;
    byId('fleet-message').classList.toggle('fleet-error', error);
  }

  async function action(callback) {
    if (busy) return;
    busy = true;
    byId('fleet-start').disabled = true;
    byId('fleet-preview').disabled = true;
    byId('fleet-form').setAttribute('aria-busy', 'true');
    try { await callback(); } catch (error) { message(error.message, true); }
    finally { busy = false; byId('fleet-start').disabled = false; byId('fleet-preview').disabled = false; byId('fleet-form').removeAttribute('aria-busy'); }
  }

  function inputPayload() {
    const notebook_ids = [...new Set(byId('fleet-links').value.trim().split(/[\s,]+/).filter(Boolean))];
    if (!notebook_ids.length) throw new Error('Paste notebook links or use one of the notebook selection buttons.');
    if (byId('fleet-mode').value === 'generation') {
      let source_ids_by_notebook = {};
      if (byId('fleet-source-map').value.trim()) source_ids_by_notebook = JSON.parse(byId('fleet-source-map').value);
      return {notebook_ids, artifact_type: byId('fleet-artifact').value, format_option: byId('fleet-format').value.trim() || null,
        style: byId('fleet-style').value, exclude_sources: byId('fleet-exclusions').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean),
        prompts: byId('fleet-prompts').value.split(/^---\s*$/m).map(x => x.trim()).filter(Boolean), source_ids_by_notebook, request_key: requestKey};
    }
    const selected = [...document.querySelectorAll('#fleet-types input:checked')].map(input => input.value);
    if (!selected.length) throw new Error('Select at least one artifact type.');
    const notebook_folders = {};
    document.querySelectorAll('[data-fleet-folder]').forEach(input => { notebook_folders[input.dataset.fleetFolder] = input.value; });
    return {notebook_ids, artifact_types: selected.length === Object.keys(typeLabels).length ? null : selected,
      output_root: byId('fleet-root').value.trim() || null, notebook_folders,
      skip_existing: byId('fleet-skip').checked, artifact_concurrency: byId('fleet-concurrency').value === 'auto' ? 1 : Number(byId('fleet-concurrency').value), download_mode: byId('fleet-concurrency').value === 'auto' ? 'auto' : 'manual', request_key: requestKey};
  }

  function selectNotebooks(mode) {
    let ids;
    if (mode === 'selected') ids = [...state.selectedNotebooks.keys()];
    else {
      let notebooks = state.notebooks;
      if (mode === 'visible') notebooks = notebooks.filter(n =>
        (state.activeProfileFilter === 'all' || n.profileId === state.activeProfileFilter) &&
        (state.activeCategoryFilter === 'all' || (state.activeCategoryFilter === 'study' ? isStudyNotebook(n) : !isStudyNotebook(n))) &&
        `${n.title} ${n.profileName} ${n.course_code || ''}`.toLowerCase().includes(state.searchQuery.toLowerCase()));
      ids = [...new Set(notebooks.map(n => n.id))];
    }
    byId('fleet-links').value = ids.join('\n');
    byId('fleet-links').dispatchEvent(new Event('input', {bubbles: true}));
    message(`${ids.length} notebooks selected.`);
  }

  function renderPreview(rows, generation) {
    previewRows = rows;
    byId('fleet-preview-results').innerHTML = `<div class="fleet-table"><table><thead><tr><th>Notebook</th><th>${generation ? 'Source selection / access' : 'Artifacts / folder'}</th><th>Sharing</th></tr></thead><tbody>${rows.map(row => {
      const title = state.notebooks.find(n => n.id === row.notebook_id)?.title || row.title || row.notebook_id;
      return `<tr><td>${escapeHtml(title)}<br><small>${escapeHtml(row.profile_id || 'Access unavailable')}</small></td><td>${generation
        ? `${row.ready ? `${row.source_ids.length} sources selected` : 'Access check failed'}`
        : `${row.ready_count} ready of ${row.artifact_count} artifacts<label>Notebook folder<input type="text" data-fleet-folder="${escapeHtml(row.notebook_id)}" value="${escapeHtml(row.folder)}"></label>`}
        ${row.error || (row.attempts || []).length ? `<details><summary>Diagnostics</summary><pre>${escapeHtml(JSON.stringify(row.error || row.attempts, null, 2))}</pre></details>` : ''}</td>
        <td><button type="button" data-fleet-sharing="${escapeHtml(row.notebook_id)}">Check status</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
    byId('fleet-preview-results').querySelectorAll('[data-fleet-sharing]').forEach(button => {
      button.addEventListener('click', () => action(async () => {
        const result = await api(`/notebooks/${button.dataset.fleetSharing}/share-status`);
        let details = button.parentElement.querySelector('details');
        if (!details) { details = document.createElement('details'); button.parentElement.append(details); }
        details.innerHTML = '<summary>Live sharing status</summary><pre></pre>';
        details.querySelector('pre').textContent = JSON.stringify(result, null, 2);
        details.open = true;
      }));
    });
  }

  async function history() {
    const batches = await api('/downloads');
    const select = byId('fleet-history');
    select.replaceChildren(new Option('Choose a saved batch', ''));
    batches.forEach(batch => select.add(new Option(`${batch.created_at.slice(0, 16)} · ${batch.notebooks.length} notebooks · ${batch.status}`, batch.id)));
    select.value = currentBatch;
  }

  async function refreshBatch() {
    if (!currentBatch) return;
    const batch = await api(`/downloads/${currentBatch}`);
    const counts = batch.counts || {};
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const done = (counts.downloaded || 0) + (counts.skipped || 0);
    byId('fleet-batch-status').textContent = `${batch.status} · ${done}/${total} downloaded or existing · ${counts.failed || 0} failed · ${counts.waiting || 0} generating`;
    if (batch.adaptive && (batch.download_mode || batch.request.download_mode) === 'auto') {
      const adaptive = batch.adaptive;
      const rate = adaptive.bytes_per_second == null ? 'measuring throughput' : `${(adaptive.bytes_per_second / 1048576).toFixed(2)} MiB/s observed`;
      const detail = document.createElement('span');
      detail.className = 'fleet-adaptive-status';
      detail.textContent = `Auto: up to ${adaptive.concurrency} transfers · ${rate} · ${adaptive.reason}`;
      byId('fleet-batch-status').append(detail);
    }
    byId('fleet-progress').max = Math.max(total, 1);
    byId('fleet-progress').value = done;
    byId('fleet-results').innerHTML = batch.notebooks.map(notebook => `<details><summary>${escapeHtml(notebook.title)} · ${notebook.items.length} artifacts${notebook.error ? ' · access/error' : ''}</summary><p>${escapeHtml(notebook.folder)}</p>
      ${notebook.error ? `<pre class="fleet-error">${escapeHtml(JSON.stringify(notebook.error, null, 2))}</pre>` : ''}
      ${notebook.pending_generations ? `<p>${notebook.pending_generations} generation jobs awaiting submission IDs.</p>` : ''}
      ${notebook.items.map(item => `<p>${escapeHtml(item.type)} · ${escapeHtml(item.title)} · ${escapeHtml(item.status)}</p>${item.error ? `<pre>${escapeHtml(JSON.stringify(item.error, null, 2))}</pre>` : ''}`).join('')}</details>`).join('');
  }

  function setBatch(batch) {
    currentBatch = batch.id;
    localStorage.setItem('supernlm_download_batch', currentBatch);
  }

  byId('btn-open-fleet-downloads').addEventListener('click', async () => {
    dialog.showModal();
    try {
      const defaults = await api('/downloads/defaults');
      if (!byId('fleet-root').value) byId('fleet-root').value = localStorage.getItem('supernlm_download_root') || defaults.output_root;
      await history(); await refreshBatch();
    } catch (error) { message(error.message, true); }
    clearInterval(timer);
    timer = setInterval(() => { if (dialog.open && currentBatch) refreshBatch().catch(error => message(error.message, true)); }, 3000);
  });
  byId('btn-download-selected').addEventListener('click', () => {
    if (!state.selectedNotebooks.size) return;
    byId('fleet-mode').value = 'download';
    byId('fleet-mode').dispatchEvent(new Event('change', {bubbles: true}));
    selectNotebooks('selected');
    byId('btn-open-fleet-downloads').click();
  });
  byId('fleet-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => clearInterval(timer));
  Object.entries(typeLabels).forEach(([type, label]) => {
    const wrapper = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = type; input.checked = true;
    wrapper.append(input, document.createTextNode(label)); byId('fleet-types').append(wrapper);
    byId('fleet-artifact').add(new Option(label, type));
  });
  const formatOptions = {
    video: [['', 'Provider default'], ['explainer', 'Explainer'], ['brief', 'Brief'], ['cinematic', 'Cinematic'], ['short', 'Short']],
    audio: [['', 'Provider default'], ['deep_dive', 'Deep dive'], ['brief', 'Brief'], ['critique', 'Critique'], ['debate', 'Debate']],
    slides: [['', 'Provider default'], ['detailed_deck', 'Detailed deck'], ['presenter_slides', 'Presenter slides']],
    report: [['', 'Provider default']],
  };
  function updateFormats() {
    const select = byId('fleet-format');
    const prior = select.value;
    const choices = formatOptions[byId('fleet-artifact').value] || [['', 'Provider default']];
    select.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
    if (choices.some(([value]) => value === prior)) select.value = prior;
    else if (byId('fleet-artifact').value === 'video') select.value = 'explainer';
  }
  updateFormats();
  byId('fleet-mode').addEventListener('change', () => {
    const generation = byId('fleet-mode').value === 'generation';
    byId('fleet-download-options').hidden = generation;
    byId('fleet-generation-options').hidden = !generation;
    byId('fleet-start').textContent = generation ? 'Generate across fleet' : 'Download batch';
  });
  byId('fleet-artifact').addEventListener('change', updateFormats);
  byId('fleet-form').addEventListener('input', () => {
    requestKey = newKey(); previewRows = []; byId('fleet-preview-results').replaceChildren();
  });
  ['selected', 'visible', 'all'].forEach(mode => byId(`fleet-use-${mode}`).addEventListener('click', () => selectNotebooks(mode)));
  byId('fleet-browse').addEventListener('click', () => action(async () => {
    const result = await api('/folder-picker', 'POST');
    if (result.path) { byId('fleet-root').value = result.path; byId('fleet-root').dispatchEvent(new Event('input', {bubbles: true})); }
  }));
  byId('fleet-preview').addEventListener('click', () => action(async () => {
    message('Checking notebook access and available artifacts…');
    const generation = byId('fleet-mode').value === 'generation';
    const result = await api(generation ? '/generation/preflight' : '/downloads/preview', 'POST', inputPayload());
    renderPreview(result.notebooks, generation); message(`Checked ${result.notebooks.length} notebooks.`);
  }));
  byId('fleet-form').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
      const payload = inputPayload();
      const generation = byId('fleet-mode').value === 'generation';
      message(generation ? 'Submitting generation batch…' : 'Preparing notebook downloads…');
      const result = await api(generation ? '/generation' : '/downloads', 'POST', payload);
      if (generation) {
        generationBatch = result.batch_id; localStorage.setItem('supernlm_generation_batch', generationBatch);
        byId('fleet-download-generated').hidden = false;
        message(`${result.total_queued} generation jobs submitted. Batch: ${generationBatch}`);
      } else {
        setBatch(result); localStorage.setItem('supernlm_download_root', payload.output_root || result.output_root);
        await history(); await refreshBatch(); message(`Download batch started: ${result.id}`);
      }
      requestKey = newKey();
    });
  });
  byId('fleet-preview-results').addEventListener('input', () => { requestKey = newKey(); });
  byId('fleet-history').addEventListener('change', () => { currentBatch = byId('fleet-history').value; if (currentBatch) { localStorage.setItem('supernlm_download_batch', currentBatch); refreshBatch().catch(error => message(error.message, true)); } });
  ['resume', 'pause', 'open-folder'].forEach(operation => byId(`fleet-${operation}`).addEventListener('click', () => action(async () => {
    if (!currentBatch) throw new Error('Choose a saved download batch first.');
    await api(`/downloads/${currentBatch}/${operation}`, 'POST', operation === 'resume' ? {artifact_concurrency: byId('fleet-concurrency').value === 'auto' ? 1 : Number(byId('fleet-concurrency').value), download_mode: byId('fleet-concurrency').value === 'auto' ? 'auto' : 'manual'} : undefined); await refreshBatch();
  })));
  byId('fleet-download-generated').hidden = !generationBatch;
  byId('fleet-download-generated').addEventListener('click', () => action(async () => {
    const batch = await api(`/generation/${generationBatch}/downloads`, 'POST', {output_root: byId('fleet-root').value.trim() || null});
    setBatch(batch); await history(); await refreshBatch();
  }));
  document.querySelectorAll('[data-fleet-queue]').forEach(button => button.addEventListener('click', () => action(async () => {
    const result = await api(`/scheduler/${button.dataset.fleetQueue}`, 'POST');
    message(JSON.stringify(result)); if (typeof loadSchedulerQueue === 'function') await loadSchedulerQueue();
  })));
})();
