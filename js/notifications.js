// ============================================
// VORTEX — Real-Time Notifications System
// Bell icon with badge + dropdown panel
// ============================================

import {
  db, collection, query, where, orderBy, limit,
  onSnapshot, updateDoc, doc
} from './config.js';
import { timeAgo } from './utils.js';

let unsubNotifications = null;
let notifContainer = null;

/**
 * Initialize the notifications system for the current user.
 * Creates the bell icon in the sidebar and listens for new notifications.
 */
export function initNotifications(userId) {
  if (!userId) return;

  // Create bell icon in sidebar header
  createBellIcon();

  // Listen for notifications
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    orderBy('timestamp', 'desc'),
    limit(20)
  );

  unsubNotifications = onSnapshot(q, (snap) => {
    const notifications = [];
    let unreadCount = 0;

    snap.forEach(d => {
      const notif = { id: d.id, ...d.data() };
      notifications.push(notif);
      if (!notif.read) unreadCount++;
    });

    updateBadge(unreadCount);
    renderNotifications(notifications);
  }, (err) => {
    console.warn('Notifications listener error:', err);
  });
}

function createBellIcon() {
  const sidebar = document.querySelector('.sidebar-header');
  if (!sidebar) return;

  // Check if bell already exists
  if (document.getElementById('notifBell')) return;

  const bellWrapper = document.createElement('div');
  bellWrapper.id = 'notifBell';
  bellWrapper.style.cssText = 'position:relative;cursor:pointer;margin-left:auto;';
  bellWrapper.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary);transition:color 0.2s;">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
    <span id="notifBadge" style="display:none;position:absolute;top:-4px;right:-4px;background:var(--accent-red);color:white;font-size:0.6rem;font-weight:700;min-width:16px;height:16px;border-radius:8px;display:none;align-items:center;justify-content:center;padding:0 3px;">0</span>
  `;

  // Make sidebar header flex
  sidebar.style.display = 'flex';
  sidebar.style.alignItems = 'center';
  sidebar.style.justifyContent = 'space-between';

  sidebar.appendChild(bellWrapper);

  // Create dropdown panel
  notifContainer = document.createElement('div');
  notifContainer.id = 'notifPanel';
  notifContainer.style.cssText = `
    position:fixed;width:320px;max-height:400px;overflow-y:auto;
    background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-lg);
    box-shadow:var(--shadow-lg);z-index:9999;display:none;
  `;
  notifContainer.innerHTML = `
    <div style="padding:1rem 1.25rem;border-bottom:1px solid var(--border-primary);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-weight:600;font-size:0.9rem;">Notifications</span>
      <button id="markAllRead" style="background:none;border:none;color:var(--accent-green);font-size:0.75rem;cursor:pointer;font-weight:600;">Mark all read</button>
    </div>
    <div id="notifList" style="padding:0.5rem;"></div>
  `;
  // Append to body instead of bellWrapper to avoid sidebar overflow clipping
  document.body.appendChild(notifContainer);

  // Toggle panel on click
  bellWrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = notifContainer.style.display === 'block';
    if (isVisible) {
      notifContainer.style.display = 'none';
    } else {
      // Position relative to bell icon
      const rect = bellWrapper.getBoundingClientRect();
      notifContainer.style.top = (rect.bottom + 8) + 'px';
      notifContainer.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 330)) + 'px';
      notifContainer.style.display = 'block';
    }
  });

  // Close on outside click
  document.addEventListener('click', () => {
    if (notifContainer) notifContainer.style.display = 'none';
  });

  // Mark all read
  document.getElementById('markAllRead')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const unread = document.querySelectorAll('.notif-item.unread');
    for (const item of unread) {
      const id = item.dataset.id;
      if (id) {
        try {
          await updateDoc(doc(db, 'notifications', id), { read: true });
        } catch (err) {
          console.warn('Failed to mark read:', err);
        }
      }
    }
  });
}

function updateBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;

  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count > 9 ? '9+' : count;
  } else {
    badge.style.display = 'none';
  }
}

function renderNotifications(notifications) {
  const list = document.getElementById('notifList');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:2rem;">No notifications yet</div>';
    return;
  }

  list.innerHTML = '';
  notifications.forEach(notif => {
    const item = document.createElement('div');
    item.className = `notif-item ${notif.read ? '' : 'unread'}`;
    item.dataset.id = notif.id;
    item.style.cssText = `
      padding:0.75rem;border-radius:var(--radius-sm);cursor:pointer;transition:background 0.2s;
      margin-bottom:0.25rem;border-left:3px solid ${notif.read ? 'transparent' : 'var(--accent-green)'};
      background:${notif.read ? 'transparent' : 'rgba(0,255,135,0.03)'};
    `;

    const iconMap = {
      'trade_settled': '⚡',
      'bid_expired': '⏰',
      'low_balance': '💰',
      'system': '🔔'
    };

    item.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:0.5rem;">
        <span style="font-size:1.1rem;flex-shrink:0;">${iconMap[notif.type] || '🔔'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8rem;font-weight:${notif.read ? '400' : '600'};color:var(--text-primary);margin-bottom:0.15rem;">${notif.title || 'Notification'}</div>
          <div style="font-size:0.75rem;color:var(--text-secondary);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${notif.message || ''}</div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.25rem;">${timeAgo(notif.timestamp)}</div>
        </div>
      </div>
    `;

    // Mark as read on click
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!notif.read) {
        try {
          await updateDoc(doc(db, 'notifications', notif.id), { read: true });
        } catch (err) {
          console.warn('Failed to mark notification read:', err);
        }
      }
    });

    list.appendChild(item);
  });
}
