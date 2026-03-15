// ============================================
// VORTEX — Shared Utilities
// Toast notifications, number animation, helpers
// ============================================

// --- Toast Notification System ---
let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TOAST_ICONS = {
  success: '⚡',
  error: '✕',
  warning: '⚠',
  info: 'ℹ'
};

function showToast(title, message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type]}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// --- Number Count-Up Animation ---
function animateCount(element, target, duration = 1500, prefix = '', suffix = '', decimals = 0) {
  const start = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;
    element.textContent = prefix + current.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suffix;
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  requestAnimationFrame(update);
}

// --- Currency Formatter ---
function formatCurrency(amount) {
  return '₹' + Number(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatCurrencyShort(amount) {
  if (amount >= 1000000) return '₹' + (amount / 1000000).toFixed(1) + 'M';
  if (amount >= 1000) return '₹' + (amount / 1000).toFixed(1) + 'K';
  return '₹' + Number(amount).toFixed(2);
}

// --- Date/Time Formatters ---
function formatTime(timestamp) {
  if (!timestamp) return '—';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(timestamp) {
  if (!timestamp) return '—';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// --- Countdown Timer ---
function startCountdown(element, expiresAt) {
  function tick() {
    const now = Date.now();
    const expiry = expiresAt.toDate ? expiresAt.toDate().getTime() : new Date(expiresAt).getTime();
    const remaining = Math.max(0, expiry - now);

    if (remaining === 0) {
      element.textContent = 'Expired';
      element.classList.add('text-red');
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    element.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    if (remaining < 120000) {
      element.style.color = 'var(--accent-red)';
    } else if (remaining < 300000) {
      element.style.color = 'var(--accent-amber)';
    }

    requestAnimationFrame(tick);
  }
  tick();
}

// --- Skeleton Loader ---
function showSkeletons(container, count = 3, type = 'card') {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const skel = document.createElement('div');
    skel.className = `skeleton skeleton-${type}`;
    if (type === 'text') {
      skel.style.width = (60 + Math.random() * 30) + '%';
    }
    container.appendChild(skel);
  }
}

function clearSkeletons(container) {
  container.querySelectorAll('.skeleton').forEach(s => s.remove());
}

// --- Number Fluctuation (for live ticker) ---
function fluctuateValue(baseValue, percentage = 0.02) {
  const change = baseValue * percentage * (Math.random() > 0.5 ? 1 : -1);
  return baseValue + change;
}

// --- Debounce ---
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// --- Page Title ---
function setPageTitle(title) {
  document.title = `${title} — Vortex`;
}

// --- Sidebar Active Link ---
function setActiveSidebarLink() {
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// --- Mobile Sidebar & Role Access ---
function initSidebar(role = 'consumer') {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  if (overlay && sidebar) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
    });
  }

  // Hide Admin tab for non-admins
  if (role !== 'admin') {
    const adminLink = document.querySelector('.sidebar-nav a[href="admin.html"]');
    if (adminLink) adminLink.style.display = 'none';
  }
}

export {
  showToast, animateCount, formatCurrency, formatCurrencyShort,
  formatTime, formatDateTime, timeAgo, startCountdown,
  showSkeletons, clearSkeletons, fluctuateValue, debounce,
  setPageTitle, setActiveSidebarLink, initSidebar
};
