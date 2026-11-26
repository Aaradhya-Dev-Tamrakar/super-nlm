// Quick Chat modal, markdown/citation rendering, history persistence, and background query runner.
import { apiFetch, setGlobalLoading } from './api.js';
import { state } from './state.js';
import { escapeHtml, isModalOpen, openModal, showToast } from './ui.js';

const CHAT_STORAGE_PREFIX = 'supernlm_chat_';
const activeThinkingTimers = new Map();

export function loadAllChatHistories() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CHAT_STORAGE_PREFIX)) {
        const notebookId = key.substring(CHAT_STORAGE_PREFIX.length);
        const stored = localStorage.getItem(key);
        if (stored) {
          state.chatHistories.set(notebookId, JSON.parse(stored));
        }
      }
    }
  } catch (err) {
    console.warn('Could not read chat histories from localStorage:', err);
  }
}

export function saveNotebookChatHistory(notebookId) {
  try {
    const history = state.chatHistories.get(notebookId) || [];
    localStorage.setItem(CHAT_STORAGE_PREFIX + notebookId, JSON.stringify(history));
  } catch (err) {
    console.warn(`Could not save chat history for ${notebookId}:`, err);
  }
}

export function clearNotebookChatHistory(notebookId) {
  state.chatHistories.delete(notebookId);
  try {
    localStorage.removeItem(CHAT_STORAGE_PREFIX + notebookId);
  } catch (err) {
    console.warn(`Could not remove chat history for ${notebookId}:`, err);
  }
}

export function renderMarkdown(text) {
  if (!text) return '';
  if (window.marked && window.DOMPurify) {
    try {
      const rawHtml = marked.parse(text, { breaks: true, gfm: true });
      return DOMPurify.sanitize(rawHtml);
    } catch (e) {
      console.warn('Markdown parsing error:', e);
    }
  }
  return escapeHtml(text);
}

export function renderCitationsHtml(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return '';
  const chips = citations.map((cite, idx) => {
    let title = '';
    if (typeof cite === 'string') {
      title = cite;
    } else if (typeof cite === 'object' && cite !== null) {
      title = cite.title || cite.source_title || cite.text || `Source ${idx + 1}`;
    } else {
      title = `Source ${idx + 1}`;
    }
    return `
      <span class="citation-chip" title="${escapeHtml(title)}">
        <i data-lucide="file-text"></i>
        <span>[${idx + 1}] ${escapeHtml(title)}</span>
      </span>
    `;
  }).join('');

  return `
    <div class="citation-container">
      <div class="w-full text-[10px] font-medium text-[var(--m3-on-surface-subtle)] uppercase tracking-wider mb-1 flex items-center gap-1">
        <i data-lucide="bookmark" class="w-3 h-3 text-[var(--google-blue)]"></i>
        <span>Cited Sources (${citations.length})</span>
      </div>
      ${chips}
    </div>
  `;
}

export function renderChatMessageBubble(msg) {
  if (msg.role === 'user') {
    return `
      <div class="flex justify-end animate-m3-enter">
        <div class="max-w-md p-3.5 rounded-2xl rounded-tr-sm bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)] text-xs leading-relaxed shadow-sm font-medium">
          ${escapeHtml(msg.content)}
        </div>
      </div>
    `;
  }

  const fallbackBadge = msg.handledByProFallback ? `
    <div class="mb-2.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--google-yellow-container)] text-[var(--google-yellow)] border border-[var(--google-yellow)]/30">
      <i data-lucide="sparkles" class="w-3 h-3 text-[var(--google-yellow)]"></i>
      <span>${escapeHtml(msg.fallbackReason || 'Handled via Pro AI Fallback')}</span>
    </div>
  ` : '';

  const formattedAnswer = renderMarkdown(msg.content);
  const citationsHtml = renderCitationsHtml(msg.citations);

  return `
    <div class="flex items-start gap-2.5 animate-m3-enter">
      <div class="w-8 h-8 rounded-full bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] flex items-center justify-center text-[var(--google-blue)] shadow-sm shrink-0">
        <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
      </div>
      <div class="flex-1 p-4 rounded-2xl rounded-tl-sm m3-subcard text-[var(--m3-on-surface)] text-xs leading-relaxed shadow-sm">
        ${fallbackBadge}
        <div class="nlm-markdown">${formattedAnswer}</div>
        ${citationsHtml}

        <div class="flex items-center justify-between mt-3 pt-2.5 border-t border-[var(--m3-outline-variant)]/60 text-[11px] text-[var(--m3-on-surface-subtle)]">
          <span class="flex items-center gap-1.5 font-sans">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--google-green)]"></span>
            <span>Gemini Notebook Verified</span>
            ${msg.executedProfileId ? `<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] border border-[var(--google-blue)]/20" title="Answered via account ${escapeHtml(msg.executedProfileId)}">via ${escapeHtml(msg.executedProfileId)}</span>` : ''}
          </span>
          <button
            type="button"
            class="btn-copy-response google-btn-outlined px-2.5 py-1 text-[11px] flex items-center gap-1 text-[var(--m3-on-surface-subtle)] hover:text-[var(--google-blue)] hover:border-[var(--google-blue)] transition cursor-pointer"
            title="Copy response to clipboard"
            data-content="${escapeHtml(msg.content)}"
          >
            <i data-lucide="copy" class="w-3 h-3"></i>
            <span>Copy</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

export function startThinkingTimer(notebookId, queryStartTime = Date.now()) {
  stopThinkingTimer(notebookId);

  const update = () => {
    const elapsedSec = ((Date.now() - queryStartTime) / 1000).toFixed(1);
    const timerEl = document.getElementById(`loader-timer-${notebookId}`);
    if (timerEl) {
      timerEl.textContent = `${elapsedSec}s`;
    }

    const phaseEl = document.getElementById(`loader-phase-text-${notebookId}`);
    if (phaseEl) {
      const sec = parseFloat(elapsedSec);
      if (sec < 2.5) {
        phaseEl.textContent = 'Connecting to notebook & indexing sources...';
      } else if (sec < 5.5) {
        phaseEl.textContent = 'Searching source passages & extracting citations...';
      } else {
        phaseEl.textContent = 'Synthesizing answer with Gemini...';
      }
    }
  };

  update();
  const intervalId = setInterval(update, 150);
  activeThinkingTimers.set(notebookId, { intervalId, startTime: queryStartTime });
}

export function stopThinkingTimer(notebookId) {
  if (activeThinkingTimers.has(notebookId)) {
    const { intervalId } = activeThinkingTimers.get(notebookId);
    clearInterval(intervalId);
    activeThinkingTimers.delete(notebookId);
  }
}

export function renderLoaderBubble(notebookId) {
  return `
    <div id="loader-${notebookId}" class="flex items-start gap-2.5 animate-m3-enter chat-loader-bubble">
      <div class="w-8 h-8 rounded-full bg-[var(--m3-surface-container)] border border-[var(--m3-outline-variant)] flex items-center justify-center text-[var(--google-blue)] shadow-sm shrink-0">
        <i data-lucide="sparkles" class="w-3.5 h-3.5 animate-pulse"></i>
      </div>
      <div class="flex-1 p-4 rounded-2xl m3-subcard space-y-3">
        <div class="flex items-center justify-between text-xs text-[var(--m3-on-surface-subtle)] font-medium">
          <div class="flex items-center gap-2.5">
            <div class="google-quad-dots">
              <span class="google-quad-dot"></span>
              <span class="google-quad-dot"></span>
              <span class="google-quad-dot"></span>
              <span class="google-quad-dot"></span>
            </div>
            <span id="loader-phase-text-${notebookId}" class="transition-all duration-300 font-sans">
              Gemini Notebook is synthesizing...
            </span>
          </div>
          <span id="loader-timer-${notebookId}" class="text-[11px] font-mono text-[var(--google-blue)] bg-[var(--google-blue-container)]/50 px-2 py-0.5 rounded-full font-medium">
            0.0s
          </span>
        </div>

        <div class="space-y-2 pt-1">
          <div class="h-2.5 w-[92%] rounded-full google-skeleton"></div>
          <div class="h-2.5 w-[84%] rounded-full google-skeleton"></div>
          <div class="h-2.5 w-[60%] rounded-full google-skeleton"></div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-[var(--m3-outline-variant)]/40">
          <div class="h-4 w-24 rounded-full google-skeleton"></div>
          <div class="h-4 w-28 rounded-full google-skeleton"></div>
        </div>
      </div>
    </div>
  `;
}

export function appendChatMessageToThread(msg) {
  const thread = document.getElementById('chat-thread');
  if (!thread) return;
  const temp = document.createElement('div');
  temp.innerHTML = renderChatMessageBubble(msg).trim();
  const bubble = temp.firstElementChild;
  if (bubble) {
    thread.appendChild(bubble);
    if (window.lucide) lucide.createIcons({ root: bubble });
    thread.scrollTop = thread.scrollHeight;
  }
}

export function getConversationIdForNotebook(notebookId) {
  if (state.conversationIds.has(notebookId)) {
    return state.conversationIds.get(notebookId);
  }
  const history = state.chatHistories.get(notebookId) || [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].conversationId) {
      state.conversationIds.set(notebookId, history[i].conversationId);
      return history[i].conversationId;
    }
  }
  return null;
}

export function updateAllNotebookCardButtons() {
  document.querySelectorAll('.btn-query-notebook').forEach(btn => {
    const id = btn.getAttribute('data-id');
    const isSynthesizing = state.activeQueries.has(id);
    if (isSynthesizing) {
      btn.innerHTML = `
        <div class="google-quad-dots scale-75 pointer-events-none">
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
          <span class="google-quad-dot"></span>
        </div>
        <span class="pointer-events-none text-[var(--google-blue)] font-medium">Synthesizing...</span>
      `;
      btn.classList.add('border-[var(--google-blue)]/50', 'bg-[var(--google-blue-container)]/30');
    } else {
      btn.innerHTML = `
        <i data-lucide="message-square" class="w-3.5 h-3.5 pointer-events-none"></i>
        <span class="pointer-events-none">Query</span>
      `;
      btn.classList.remove('border-[var(--google-blue)]/50', 'bg-[var(--google-blue-container)]/30');
    }
  });
  if (window.lucide) lucide.createIcons();
}

export function updateBackgroundQueryStatus() {
  const dock = document.getElementById('floating-query-dock');
  const titleEl = document.getElementById('floating-query-title');
  const chatModalOpen = isModalOpen('modal-chat');

  if (state.activeQueries.size === 0) {
    if (dock) {
      dock.classList.add('hidden');
      dock.classList.remove('flex');
    }
    updateAllNotebookCardButtons();
    return;
  }

  const firstActive = state.activeQueries.values().next().value;
  if (chatModalOpen && state.activeChat && state.activeQueries.has(state.activeChat.notebookId) && state.activeQueries.size === 1) {
    if (dock) {
      dock.classList.add('hidden');
      dock.classList.remove('flex');
    }
  } else if (dock && titleEl && firstActive) {
    const count = state.activeQueries.size;
    if (count === 1) {
      titleEl.textContent = `Synthesizing answer for "${firstActive.title}"...`;
    } else {
      titleEl.textContent = `Synthesizing ${count} answers in background...`;
    }
    dock.classList.remove('hidden');
    dock.classList.add('flex');
    dock.onclick = () => {
      openChatModal(firstActive.notebookId, firstActive.profileId, firstActive.title);
    };
    if (window.lucide) lucide.createIcons({ root: dock });
  }

  updateAllNotebookCardButtons();
}

export function openChatModal(notebookId, profileId, title) {
  const defaultProProfile = state.profiles.find(p => p.isDefaultPro || p.tier === 'pro');
  const initialProfileId = profileId || (defaultProProfile ? defaultProProfile.id : (state.profiles[0]?.id || 'default'));

  state.activeChat = { notebookId, profileId: initialProfileId, title };
  const titleEl = document.getElementById('chat-modal-title');
  if (titleEl) titleEl.textContent = title;

  const profileSelect = document.getElementById('chat-profile-select');
  const profileBadge = document.getElementById('chat-profile-badge');

  if (profileSelect) {
    profileSelect.innerHTML = state.profiles.map(p => {
      const isSelected = p.id === initialProfileId;
      const tierLabel = (p.isDefaultPro || p.tier === 'pro') ? 'PRO AI ⭐' : 'Standard';
      return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.displayName || p.id)} (${tierLabel})</option>`;
    }).join('');

    const updateProfileUI = () => {
      const selectedId = profileSelect.value;
      const selProfile = state.profiles.find(p => p.id === selectedId);
      if (state.activeChat) state.activeChat.profileId = selectedId;
      if (profileBadge) {
        if (selProfile && (selProfile.isDefaultPro || selProfile.tier === 'pro')) {
          profileBadge.classList.remove('hidden');
          profileBadge.classList.add('inline-flex');
        } else {
          profileBadge.classList.add('hidden');
          profileBadge.classList.remove('inline-flex');
        }
      }
      const introProfileEl = document.getElementById('chat-intro-profile-code');
      if (introProfileEl) {
        introProfileEl.textContent = selectedId;
      }
    };

    profileSelect.onchange = updateProfileUI;
    updateProfileUI();
  }

  const thread = document.getElementById('chat-thread');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-chat-send');

  const introCard = `
    <div class="p-4 rounded-2xl m3-subcard text-xs text-[var(--m3-on-surface-variant)] flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-[var(--google-blue)] shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong>. Querying via account <code id="chat-intro-profile-code" class="px-1.5 py-0.5 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] font-mono">${initialProfileId}</code>. Select your query profile above or ask any question below.</span>
    </div>
  `;

  const history = state.chatHistories.get(notebookId) || [];
  let contentHtml = introCard;
  if (history.length > 0) {
    contentHtml += history.map(msg => renderChatMessageBubble(msg)).join('');
  }

  const isQueryActive = state.activeQueries.has(notebookId);
  if (isQueryActive) {
    contentHtml += renderLoaderBubble(notebookId);
    const activeQuery = state.activeQueries.get(notebookId);
    startThinkingTimer(notebookId, activeQuery ? activeQuery.startTime : Date.now());
  }

  thread.innerHTML = contentHtml;

  if (isQueryActive) {
    if (chatInput) {
      chatInput.disabled = true;
      chatInput.placeholder = 'Gemini Notebook is thinking & synthesizing...';
    }
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Synthesizing</span>';
    }
  } else {
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.placeholder = "Ask a question about this notebook's sources...";
      chatInput.value = state.chatDrafts.get(notebookId) || '';
    }
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>Ask</span><i data-lucide="send" class="w-3.5 h-3.5"></i>';
    }
  }

  openModal('modal-chat');
  updateBackgroundQueryStatus();
  if (window.lucide) lucide.createIcons();
  thread.scrollTop = thread.scrollHeight;
  if (chatInput && !isQueryActive) chatInput.focus();
}

export function handleClearCurrentChat() {
  if (!state.activeChat) return;
  const notebookId = state.activeChat.notebookId;
  const title = state.activeChat.title;
  const profileId = state.activeChat.profileId;

  if (state.activeQueries.has(notebookId)) {
    showToast('Cannot clear chat while an answer is actively being synthesized.', 'info');
    return;
  }

  stopThinkingTimer(notebookId);
  clearNotebookChatHistory(notebookId);
  state.conversationIds.delete(notebookId);
  state.chatDrafts.delete(notebookId);

  const input = document.getElementById('chat-input');
  if (input) input.value = '';

  const profileSelect = document.getElementById('chat-profile-select');
  const activeProf = (profileSelect && profileSelect.value) || profileId;

  const thread = document.getElementById('chat-thread');
  thread.innerHTML = `
    <div class="p-4 rounded-2xl m3-subcard text-xs text-[var(--m3-on-surface-variant)] flex items-center gap-2.5">
      <i data-lucide="info" class="w-4 h-4 text-[var(--google-blue)] shrink-0"></i>
      <span>Connected to <strong>${escapeHtml(title)}</strong>. Querying via account <code id="chat-intro-profile-code" class="px-1.5 py-0.5 rounded bg-[var(--m3-surface-container)] text-[var(--google-blue)] font-mono">${activeProf}</code>. Select your query profile above or ask any question below.</span>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  showToast('Chat history cleared for this notebook', 'info');
}

export async function handleChatSubmit(e) {
  e.preventDefault();
  if (!state.activeChat) return;

  const profileSelect = document.getElementById('chat-profile-select');
  const profileId = (profileSelect && profileSelect.value) ? profileSelect.value : state.activeChat.profileId;
  state.activeChat.profileId = profileId;

  const notebookId = state.activeChat.notebookId;
  const title = state.activeChat.title;

  if (state.activeQueries.has(notebookId)) {
    showToast('Please wait, an answer is already being synthesized for this notebook.', 'info');
    return;
  }

  const input = document.getElementById('chat-input');
  const question = input ? input.value.trim() : '';
  if (!question) return;

  state.chatDrafts.delete(notebookId);
  if (input) input.value = '';

  const thread = document.getElementById('chat-thread');
  const sendBtn = document.getElementById('btn-chat-send');

  let history = state.chatHistories.get(notebookId);
  if (!history) {
    history = [];
    state.chatHistories.set(notebookId, history);
  }

  const userMsg = {
    role: 'user',
    content: question,
    timestamp: Date.now(),
  };
  history.push(userMsg);
  saveNotebookChatHistory(notebookId);
  appendChatMessageToThread(userMsg);

  const loaderEl = document.createElement('div');
  loaderEl.innerHTML = renderLoaderBubble(notebookId).trim();
  const loaderNode = loaderEl.firstElementChild;
  if (loaderNode && thread) {
    thread.appendChild(loaderNode);
    if (window.lucide) lucide.createIcons({ root: loaderNode });
    thread.scrollTop = thread.scrollHeight;
  }

  const queryStartTime = Date.now();
  state.activeQueries.set(notebookId, {
    notebookId,
    profileId,
    title,
    question,
    startTime: queryStartTime,
  });
  startThinkingTimer(notebookId, queryStartTime);
  setGlobalLoading(true);

  if (input) {
    input.value = '';
    input.disabled = true;
    input.placeholder = 'Gemini Notebook is thinking & synthesizing...';
  }
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Synthesizing</span>';
    if (window.lucide) lucide.createIcons({ root: sendBtn });
  }

  updateBackgroundQueryStatus();

  const conversationId = getConversationIdForNotebook(notebookId);

  try {
    const res = await apiFetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebookId,
        profileId,
        question,
        conversationId: conversationId || null,
      }),
    });

    state.activeQueries.delete(notebookId);
    updateBackgroundQueryStatus();

    if (res.ok) {
      const data = await res.json();

      if (!data.success) {
        const errMsg = data.error || 'Query failed or timed out. Please check your login credentials.';
        handleQueryFailure(notebookId, profileId, title, errMsg);
        return;
      }

      if (data.conversationId) {
        state.conversationIds.set(notebookId, data.conversationId);
      }

      const answer = data.answer || 'No response returned.';
      const assistantMsg = {
        role: 'assistant',
        content: answer,
        citations: data.citations || [],
        conversationId: data.conversationId || conversationId,
        handledByProFallback: !!data.handledByProFallback,
        fallbackReason: data.fallbackReason || '',
        executedProfileId: data.executedProfileId || profileId,
        timestamp: Date.now(),
      };
      history.push(assistantMsg);
      saveNotebookChatHistory(notebookId);

      handleQuerySuccess(notebookId, profileId, title, assistantMsg);
    } else {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      handleQueryFailure(notebookId, profileId, title, err.detail || 'Error running query');
    }
  } catch (err) {
    state.activeQueries.delete(notebookId);
    updateBackgroundQueryStatus();
    handleQueryFailure(notebookId, profileId, title, `Network error: ${err.message}`);
  }
}

export function handleQuerySuccess(notebookId, profileId, title, assistantMsg) {
  stopThinkingTimer(notebookId);
  setGlobalLoading(false);

  const isCurrentlyOpenForThisNotebook =
    isModalOpen('modal-chat') &&
    state.activeChat &&
    state.activeChat.notebookId === notebookId;

  if (isCurrentlyOpenForThisNotebook) {
    const loader = document.getElementById(`loader-${notebookId}`);
    if (loader) loader.remove();

    appendChatMessageToThread(assistantMsg);
    resetChatInputState();
  } else {
    showToast(`Answer ready for "${title}"`, 'success', {
      label: 'View Answer',
      onClick: () => openChatModal(notebookId, profileId, title),
    });
  }
}

export function handleQueryFailure(notebookId, profileId, title, errorMsg) {
  stopThinkingTimer(notebookId);
  setGlobalLoading(false);

  const isCurrentlyOpenForThisNotebook =
    isModalOpen('modal-chat') &&
    state.activeChat &&
    state.activeChat.notebookId === notebookId;

  if (isCurrentlyOpenForThisNotebook) {
    const loader = document.getElementById(`loader-${notebookId}`);
    if (loader) loader.remove();

    const thread = document.getElementById('chat-thread');
    if (thread) {
      const errEl = document.createElement('div');
      errEl.className = 'p-3.5 rounded-2xl bg-[var(--google-red-container)]/30 border border-[var(--google-red)]/30 text-[var(--google-red)] text-xs animate-m3-enter flex items-center gap-2';
      errEl.innerHTML = `
        <i data-lucide="alert-circle" class="w-4 h-4 shrink-0"></i>
        <span>Query failed: ${escapeHtml(errorMsg)}</span>
      `;
      thread.appendChild(errEl);
      if (window.lucide) lucide.createIcons({ root: errEl });
      thread.scrollTop = thread.scrollHeight;
    }

    resetChatInputState();
  } else {
    showToast(`Query failed for "${title}": ${errorMsg}`, 'error', {
      label: 'Open Chat',
      onClick: () => openChatModal(notebookId, profileId, title),
    });
  }
}

export function resetChatInputState() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-chat-send');
  if (input) {
    input.disabled = false;
    input.placeholder = "Ask a question about this notebook's sources...";
    input.focus();
  }
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span>Ask</span><i data-lucide="send" class="w-3.5 h-3.5"></i>';
    if (window.lucide) lucide.createIcons({ root: sendBtn });
  }
}
