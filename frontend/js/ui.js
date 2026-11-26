// Shared UI helpers: theme, sidebars, modals, ripple effects, toasts, escaping.
import { state } from './state.js';

const SIDEBAR_COLLAPSED_KEY = 'supernlm_sidebar_collapsed';
const RIGHT_SIDEBAR_COLLAPSED_KEY = 'supernlm_right_sidebar_collapsed';
const THEME_STORAGE_KEY = 'supernlm_theme_mode';

let onChatModalClosed = null;
export function registerChatModalCloseHook(fn) {
  onChatModalClosed = fn;
}

export function initSidebarState() {
  const isLeftCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  applySidebarCollapsed(isLeftCollapsed, false);

  const savedRight = localStorage.getItem(RIGHT_SIDEBAR_COLLAPSED_KEY);
  const isRightCollapsed = savedRight !== null ? savedRight === 'true' : false;
  applyRightSidebarCollapsed(isRightCollapsed, false);
}

export function toggleSidebarCollapse() {
  const sidebar = document.getElementById('workspace-sidebar');
  if (!sidebar) return;
  const willCollapse = !sidebar.classList.contains('collapsed');
  applySidebarCollapsed(willCollapse, true);
  showToast(willCollapse ? 'Left panel collapsed (shortcut: [)' : 'Left panel expanded (shortcut: [)', 'info');
}

export function applySidebarCollapsed(collapsed, save = true) {
  const sidebar = document.getElementById('workspace-sidebar');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const toggleIcon = document.getElementById('sidebar-toggle-icon');
  if (save) {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  }
  if (!sidebar) return;

  if (collapsed) {
    sidebar.classList.add('collapsed');
    if (toggleBtn) toggleBtn.classList.add('active');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left-open');
  } else {
    sidebar.classList.remove('collapsed');
    if (toggleBtn) toggleBtn.classList.remove('active');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-left');
  }
  if (window.lucide) lucide.createIcons();
}

export function toggleRightSidebarCollapse() {
  const sidebar = document.getElementById('workspace-right-sidebar');
  if (!sidebar) return;
  const willCollapse = !sidebar.classList.contains('collapsed');
  applyRightSidebarCollapsed(willCollapse, true);
  showToast(willCollapse ? 'Fleet tools panel collapsed (shortcut: ])' : 'Fleet tools panel expanded (shortcut: ])', 'info');
}

export function applyRightSidebarCollapsed(collapsed, save = true) {
  const sidebar = document.getElementById('workspace-right-sidebar');
  const toggleBtn = document.getElementById('btn-toggle-right-sidebar');
  const toggleIcon = document.getElementById('sidebar-right-toggle-icon');
  if (save) {
    localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  }
  if (!sidebar) return;

  if (collapsed) {
    sidebar.classList.add('collapsed');
    if (toggleBtn) toggleBtn.classList.remove('active');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-right-open');
  } else {
    sidebar.classList.remove('collapsed');
    if (toggleBtn) toggleBtn.classList.add('active');
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'panel-right');
  }
  if (window.lucide) lucide.createIcons();
}

export function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
  applyTheme(savedTheme, false);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    if (currentTheme === 'system') {
      applyTheme('system', false);
    }
  });
}

export function applyTheme(theme, save = true) {
  if (save) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  const htmlEl = document.documentElement;
  const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveDark = theme === 'dark' || (theme === 'system' && isSystemDark);

  if (effectiveDark) {
    htmlEl.classList.add('dark');
  } else {
    htmlEl.classList.remove('dark');
  }

  const iconEl = document.getElementById('theme-active-icon');
  if (iconEl) {
    const iconName = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'laptop';
    iconEl.setAttribute('data-lucide', iconName);
  }

  document.querySelectorAll('.m3-menu-item[data-theme]').forEach(btn => {
    const btnTheme = btn.getAttribute('data-theme');
    const checkIcon = btn.querySelector('.theme-check-icon');
    if (btnTheme === theme) {
      btn.classList.add('active');
      if (checkIcon) checkIcon.classList.remove('hidden');
    } else {
      btn.classList.remove('active');
      if (checkIcon) checkIcon.classList.add('hidden');
    }
  });

  if (window.lucide) lucide.createIcons();
}

export function toggleThemeMode() {
  const isCurrentlyDark = document.documentElement.classList.contains('dark');
  const targetTheme = isCurrentlyDark ? 'light' : 'dark';
  applyTheme(targetTheme, true);
  showToast(`Switched to ${targetTheme === 'dark' ? 'Dark' : 'Light'} mode (shortcut: 0)`, 'info');
}

export function initGoogleRipple() {
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, textarea, select, .no-ripple')) return;

    const host = e.target.closest(
      '.m3-card, .m3-chip, .google-btn-primary, .google-btn-tonal, .google-btn-outlined, .m3-menu-item, button, .google-search-pill'
    );
    if (!host) return;

    host.classList.add('google-ripple-host');

    const rect = host.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height) * 2;
    const radius = size / 2;

    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - radius}px`;
    ripple.style.top = `${e.clientY - rect.top - radius}px`;
    ripple.className = 'google-ripple-effect';

    const prev = host.querySelector('.google-ripple-effect');
    if (prev) prev.remove();

    host.appendChild(ripple);

    const removeRipple = () => {
      ripple.style.opacity = '0';
      ripple.style.transition = 'opacity 0.3s cubic-bezier(0.2, 0, 0, 1)';
      setTimeout(() => {
        if (ripple.parentNode) ripple.remove();
      }, 300);
      window.removeEventListener('pointerup', removeRipple);
      window.removeEventListener('pointercancel', removeRipple);
    };

    window.addEventListener('pointerup', removeRipple, { once: true });
    window.addEventListener('pointercancel', removeRipple, { once: true });
    setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
    }, 600);
  });
}

export function isModalOpen(id) {
  const modal = document.getElementById(id);
  return !!(modal && !modal.classList.contains('hidden'));
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  const dialog = modal.querySelector('.m3-dialog');
  if (dialog) {
    requestAnimationFrame(() => {
      dialog.classList.add('modal-open');
    });
  }
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === 'modal-accounts') state.editingProfileId = null;
  const dialog = modal.querySelector('.m3-dialog');
  if (dialog) {
    dialog.classList.remove('modal-open');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      if (id === 'modal-chat' && onChatModalClosed) onChatModalClosed();
    }, 240);
  } else {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (id === 'modal-chat' && onChatModalClosed) onChatModalClosed();
  }
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

export function highlightMatch(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return escaped.replace(regex, '<mark class="bg-[var(--google-blue-container)] text-[var(--google-blue-on-container)] rounded px-1 font-medium">$1</mark>');
}

export function showToast(message, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-[var(--google-red-container)] border-[var(--google-red)]/40 text-[var(--google-red)]'
           : type === 'success' ? 'bg-[var(--google-green-container)] border-[var(--google-green)]/40 text-[var(--google-green)]'
           : 'bg-[var(--m3-surface-container-high)] border-[var(--m3-outline-variant)] text-[var(--m3-on-surface)]';
  const icon = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info';

  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full border text-xs font-medium shadow-2xl transition-all duration-300 transform translate-y-3 scale-95 opacity-0 ${bg}`;

  let actionHtml = '';
  if (action && action.label) {
    actionHtml = `<button type="button" class="toast-action-btn ml-2 px-2.5 py-1 rounded-full bg-[var(--google-blue)] text-white font-medium text-[11px] hover:opacity-90 shadow-sm transition cursor-pointer shrink-0">${escapeHtml(action.label)}</button>`;
  }

  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-3.5 h-3.5 shrink-0"></i>
    <span class="flex-1">${escapeHtml(message)}</span>
    ${actionHtml}
  `;

  if (action && action.onClick) {
    const actBtn = toast.querySelector('.toast-action-btn');
    if (actBtn) {
      actBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick();
        toast.remove();
      });
    }
  }

  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons({ root: toast });
  }

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-3', 'scale-95', 'opacity-0');
    toast.classList.add('translate-y-0', 'scale-100', 'opacity-100');
  });

  const duration = action ? 7000 : 4000;
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
    toast.classList.add('opacity-0', 'translate-y-3', 'scale-95');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function fallbackCopyText(text, callback) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful && callback) callback();
  } catch (err) {
    console.warn('Fallback copy failed:', err);
  }
}
