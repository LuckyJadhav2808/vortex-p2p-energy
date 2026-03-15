// ============================================
// VORTEX — Shared Sidebar Component
// Renders sidebar HTML into any app page
// ============================================

import { renderCompactLogo, renderAdminLogo, injectFavicon } from './logo.js';
import { setPageTitle, setActiveSidebarLink, initSidebar } from './utils.js';
import { initNotifications } from './notifications.js';

const SIDEBAR_NAV_ITEMS = [
  { href: 'dashboard.html', label: 'Dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
  { href: 'marketplace.html', label: 'Marketplace', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18M9 21V9"/></svg>' },
  { href: 'analytics.html', label: 'Analytics', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg>' },
  { href: 'wallet.html', label: 'Wallet', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>' },
  { href: 'profile.html', label: 'Profile', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>' },
  { href: 'admin.html', label: 'Admin', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4"/></svg>' }
];

/**
 * Render the complete app shell (sidebar + toggle + overlay)
 * @param {HTMLElement} container - The .app-layout container
 * @param {string} activePage - The current page filename (e.g., 'dashboard.html')
 * @param {object} userProfile - The user's Firestore profile
 * @param {function} logoutFn - The logout function
 */
export function renderAppShell(container, activePage, userProfile, logoutFn) {
  const isAdmin = userProfile?.isAdmin || false;
  const role = userProfile?.role || 'consumer';

  // Build nav items HTML
  const navHtml = SIDEBAR_NAV_ITEMS
    .filter(item => item.href !== 'admin.html' || isAdmin)
    .map(item => {
      const activeClass = item.href === activePage ? ' class="active"' : '';
      return `<a href="${item.href}"${activeClass}>${item.icon}${item.label}</a>`;
    })
    .join('\n        ');

  // Find existing main content
  const mainContent = container.querySelector('main.main-content') || container.querySelector('main');

  // Build shell
  const shellHtml = `
    <button class="sidebar-toggle" id="sidebarToggle">☰</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="appSidebar">
      <div class="sidebar-header" id="sidebarLogo"></div>
      <nav class="sidebar-nav">
        ${navHtml}
      </nav>
      <div class="sidebar-user">
        <div class="sidebar-user-zone" id="userZone">Zone ${userProfile?.zone || '—'}</div>
        <span class="sidebar-user-role ${role === 'prosumer' ? 'role-prosumer' : 'role-consumer'}" id="userRole">
          ${role === 'prosumer' ? '☀ Prosumer' : '🏠 Consumer'}
        </span>
        <div style="font-size:0.8rem;font-weight:500;" id="userName">${userProfile?.name || 'User'}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Energy: <span id="userEnergy">${(userProfile?.energyBalance || 0).toFixed(1)} kWh</span></div>
        <button class="btn btn-ghost btn-sm" id="logoutBtn" style="margin-top:0.5rem;color:var(--accent-red);">
          ↩ Logout
        </button>
      </div>
    </aside>
  `;

  // Insert shell before main content
  if (mainContent) {
    mainContent.insertAdjacentHTML('beforebegin', shellHtml);
  }

  // Setup logo
  const logoContainer = document.getElementById('sidebarLogo');
  if (isAdmin && activePage === 'admin.html') {
    renderAdminLogo(logoContainer);
  } else {
    renderCompactLogo(logoContainer);
  }
  injectFavicon();

  // Setup sidebar toggles
  const toggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
  if (overlay && sidebar) {
    overlay.addEventListener('click', () => sidebar.classList.remove('open'));
  }

  // Setup logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && logoutFn) {
    logoutBtn.addEventListener('click', logoutFn);
  }
  // Also expose globally for inline onclick handlers
  window.handleLogout = logoutFn;

  // Hide admin link for non-admins
  if (!isAdmin) {
    const adminLink = document.querySelector('.sidebar-nav a[href="admin.html"]');
    if (adminLink) adminLink.style.display = 'none';
  }

  // Set page title and active link
  const pageNames = {
    'dashboard.html': 'Dashboard',
    'marketplace.html': 'Marketplace',
    'analytics.html': 'Analytics',
    'wallet.html': 'Wallet',
    'profile.html': 'Profile',
    'admin.html': 'Admin Panel'
  };
  setPageTitle(pageNames[activePage] || 'Vortex');
  setActiveSidebarLink();

  // Initialize notifications
  if (userProfile?.id) {
    initNotifications(userProfile.id);
  }
}
