// ============================================
// VORTEX — Admin Panel Logic
// System overview, zone CRUD, matching engine, logs, users
// ============================================

import {
  auth, db, API_BASE_URL,
  requireAuth, getUserProfile, logout,
  collection, query, where, orderBy, limit, onSnapshot, getDocs,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp
} from './config.js';
import { renderAdminLogo, injectFavicon } from './logo.js';
import {
  showToast, animateCount, formatCurrency, formatDateTime, timeAgo,
  setPageTitle, setActiveSidebarLink, initSidebar
} from './utils.js';
import { initNotifications } from './notifications.js';

let currentUser = null;
let userProfile = null;
let zonesCache = []; // local cache for zone docs

// ---- Zone CRUD Functions ----
function openZoneModal(data = null) {
  const overlay = document.getElementById('zoneModalOverlay');
  if (!overlay) { console.error('zoneModalOverlay not found!'); return; }
  overlay.style.display = 'flex';
  document.getElementById('zoneEditId').value = '';
  document.getElementById('zoneCode').value = '';
  document.getElementById('zoneCode').disabled = false;
  document.getElementById('zoneLabel').value = '';
  document.getElementById('zoneRate').value = '';
  document.getElementById('zoneStatus').value = 'active';
  document.getElementById('zoneModalTitle').textContent = 'Add New Zone';
  if (data) {
    document.getElementById('zoneEditId').value = data.id;
    document.getElementById('zoneCode').value = data.code || data.id;
    document.getElementById('zoneCode').disabled = true;
    document.getElementById('zoneLabel').value = data.label || '';
    document.getElementById('zoneRate').value = data.baseRate || '';
    document.getElementById('zoneStatus').value = data.status || 'active';
    document.getElementById('zoneModalTitle').textContent = 'Edit Zone ' + (data.code || data.id);
  }
}

function closeZoneModal() {
  const overlay = document.getElementById('zoneModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function saveZoneHandler() {
  const editId = document.getElementById('zoneEditId').value;
  const code = document.getElementById('zoneCode').value.trim().toUpperCase();
  const label = document.getElementById('zoneLabel').value.trim();
  const rate = parseFloat(document.getElementById('zoneRate').value);
  const status = document.getElementById('zoneStatus').value;
  if (!code) { showToast('Error', 'Zone code is required.', 'error'); return; }
  if (!label) { showToast('Error', 'Zone label is required.', 'error'); return; }
  if (isNaN(rate) || rate < 0) { showToast('Error', 'Please enter a valid base rate.', 'error'); return; }
  const btn = document.getElementById('zoneSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const docId = editId || code;
    const zoneData = { code, label, baseRate: rate, status, updatedAt: serverTimestamp() };
    if (!editId) {
      zoneData.createdAt = serverTimestamp();
      const existing = await getDoc(doc(db, 'zones', code));
      if (existing.exists()) {
        showToast('Error', `Zone ${code} already exists.`, 'error');
        btn.disabled = false; btn.textContent = 'Save Zone';
        return;
      }
    }
    await setDoc(doc(db, 'zones', docId), zoneData, { merge: true });
    showToast('Success', editId ? `Zone ${code} updated.` : `Zone ${code} created.`, 'success');
    closeZoneModal();
    loadZoneManagement();
  } catch (err) {
    showToast('Error', 'Failed to save zone: ' + err.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Save Zone';
}

async function deleteZoneHandler(zoneId, zoneCode) {
  if (!confirm(`Delete Zone ${zoneCode}? Users in this zone will not be affected, but no new users can select it.`)) return;
  try {
    await deleteDoc(doc(db, 'zones', zoneId));
    showToast('Deleted', `Zone ${zoneCode} removed.`, 'success');
    loadZoneManagement();
  } catch (err) {
    showToast('Error', 'Failed to delete: ' + err.message, 'error');
  }
}

// ---- Bind all button event listeners when DOM is ready ----
document.addEventListener('DOMContentLoaded', () => {
  // Add Zone button
  const addZoneBtn = document.getElementById('addZoneBtn');
  if (addZoneBtn) addZoneBtn.addEventListener('click', () => openZoneModal());

  // Modal close / cancel
  const closeBtn = document.getElementById('zoneModalCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeZoneModal);
  const cancelBtn = document.getElementById('zoneCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', closeZoneModal);

  // Click overlay to close (but not the modal itself)
  const overlay = document.getElementById('zoneModalOverlay');
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeZoneModal();
  });

  // Save Zone
  const saveBtn = document.getElementById('zoneSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveZoneHandler);

  // Matching engine
  const matchBtn = document.getElementById('triggerMatchBtn');
  if (matchBtn) matchBtn.addEventListener('click', () => triggerMatching());

  // Energy simulation
  const simBtn = document.getElementById('triggerSimBtn');
  if (simBtn) simBtn.addEventListener('click', () => triggerSimulation());

  // Event delegation for zone table edit/delete buttons (dynamically created)
  const tbody = document.getElementById('zoneBreakdownBody');
  if (tbody) tbody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit');
    const delBtn = e.target.closest('.btn-del');
    if (editBtn) {
      const zoneId = editBtn.dataset.zoneId;
      const zone = zonesCache.find(z => z.id === zoneId);
      if (zone) openZoneModal(zone);
    }
    if (delBtn) {
      const zoneId = delBtn.dataset.zoneId;
      const zoneCode = delBtn.dataset.zoneCode;
      deleteZoneHandler(zoneId, zoneCode);
    }
  });
});

requireAuth(async (user) => {
  currentUser = user;

  try {
    userProfile = await getUserProfile(user.uid);
  } catch (e) {
    userProfile = null;
  }

  if (!userProfile || !userProfile.isAdmin) {
    document.getElementById('adminContent').innerHTML = `
      <div class="empty-state" style="padding:5rem 2rem;">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Access Denied</div>
        <div class="empty-state-text">You do not have admin privileges. Contact the system administrator.</div>
        <a href="dashboard.html" class="btn btn-secondary" style="margin-top:1rem;">← Back to Dashboard</a>
      </div>
    `;
    return;
  }

  renderAdminLogo(document.getElementById('sidebarLogo'));
  injectFavicon();
  setPageTitle('Admin Panel');
  setActiveSidebarLink();
  initSidebar();

  document.getElementById('userZone').textContent = 'Zone ' + (userProfile.zone || '—');
  document.getElementById('userRole').textContent = 'ADMIN';
  document.getElementById('userRole').className = 'sidebar-user-role';
  document.getElementById('userRole').style.cssText = 'background:rgba(255,68,68,0.1);color:#FF4444;border:1px solid rgba(255,68,68,0.3);';
  document.getElementById('userName').textContent = userProfile.name || 'Admin';

  initNotifications(currentUser.uid);

  // Each loader is independent — wrap in try/catch so one failure doesn't crash all
  try { await loadSystemOverview(); } catch (e) { console.warn('loadSystemOverview failed:', e.message); }
  try { loadRevenueDashboard(); } catch (e) { console.warn('loadRevenueDashboard failed:', e.message); }
  try { await loadZoneManagement(); } catch (e) { console.warn('loadZoneManagement failed:', e.message); }
  try { loadLogs(); } catch (e) { console.warn('loadLogs failed:', e.message); }
  try { loadUsersTable(); } catch (e) { console.warn('loadUsersTable failed:', e.message); }
});


// ============================================
// SYSTEM OVERVIEW
// ============================================
async function loadSystemOverview() {
  // Try backend API first (uses Admin SDK, no Firestore rules issues)
  try {
    const resp = await fetch(`${API_BASE_URL}/api/stats`);
    if (resp.ok) {
      const stats = await resp.json();
      animateCount(document.getElementById('adminTotalUsers'), stats.totalUsers || 0, 1000);
      animateCount(document.getElementById('adminTradesToday'), stats.totalTrades || 0, 800);
      animateCount(document.getElementById('adminTotalKwh'), stats.totalKwh || 0, 1000, '', '', 1);
      animateCount(document.getElementById('adminTotalSettled'), stats.totalSettled || 0, 1000, '₹', '', 2);
      return; // Success — done
    }
  } catch (e) {
    // Backend offline, fall through to Firestore
  }

  // Fallback: Firestore direct reads (may fail if rules are restrictive)
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    animateCount(document.getElementById('adminTotalUsers'), usersSnap.size, 1000);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tradesSnap = await getDocs(collection(db, 'trades'));
    let todayTrades = 0, totalKwh = 0, totalSettled = 0;
    tradesSnap.forEach(d => {
      const t = d.data();
      totalKwh += t.kwhAmount || 0;
      totalSettled += (t.kwhAmount || 0) * (t.clearingPrice || 0);
      const ts = t.timestamp?.toDate?.();
      if (ts && ts >= today) todayTrades++;
    });

    animateCount(document.getElementById('adminTradesToday'), todayTrades, 800);
    animateCount(document.getElementById('adminTotalKwh'), totalKwh, 1000, '', '', 1);
    animateCount(document.getElementById('adminTotalSettled'), totalSettled, 1000, '₹', '', 2);
  } catch (err) {
    console.warn('System overview error (Firestore fallback):', err.message);
  }
}

// ============================================
// ZONE MANAGEMENT (CRUD)
// ============================================

// Load zones from Firestore 'zones' collection + show stats
async function loadZoneManagement() {
  const tbody = document.getElementById('zoneBreakdownBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Loading...</td></tr>';

  try {
    // Fetch zones from Firestore
    const zonesSnap = await getDocs(collection(db, 'zones'));
    zonesCache = [];
    zonesSnap.forEach(d => {
      zonesCache.push({ id: d.id, ...d.data() });
    });

    // If no zones exist, seed defaults A–E
    if (zonesCache.length === 0) {
      const defaults = [
        { code: 'A', label: 'Downtown East', baseRate: 5.50, status: 'active' },
        { code: 'B', label: 'Greenfield Area', baseRate: 5.20, status: 'active' },
        { code: 'C', label: 'Solar Heights', baseRate: 4.80, status: 'active' },
        { code: 'D', label: 'Riverside', baseRate: 5.80, status: 'active' },
        { code: 'E', label: 'Industrial Park', baseRate: 6.00, status: 'active' }
      ];
      for (const z of defaults) {
        const ref = doc(db, 'zones', z.code);
        await setDoc(ref, { ...z, createdAt: serverTimestamp() });
        zonesCache.push({ id: z.code, ...z });
      }
    }

    // Sort by code
    zonesCache.sort((a, b) => (a.code || a.id).localeCompare(b.code || b.id));

    tbody.innerHTML = '';

    for (const zone of zonesCache) {
      const zoneCode = zone.code || zone.id;

      // Get user count for zone
      let userCount = 0, openBids = 0;
      try {
        const usersQ = query(collection(db, 'users'), where('zone', '==', zoneCode));
        const usersSnap = await getDocs(usersQ);
        userCount = usersSnap.size;

        const bidsQ = query(collection(db, 'bids'), where('zone', '==', zoneCode), where('status', '==', 'open'));
        const bidsSnap = await getDocs(bidsQ);
        openBids = bidsSnap.size;
      } catch (e) {
        // Queries might fail if no index
      }

      const statusBadge = zone.status === 'active'
        ? '<span class="badge badge-green">Active</span>'
        : '<span class="badge badge-amber">Inactive</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge-cyan">Zone ${zoneCode}</span> ${zone.status !== 'active' ? statusBadge : ''}</td>
        <td>${zone.label || '—'}</td>
        <td>₹${(zone.baseRate || 0).toFixed(2)}</td>
        <td>${userCount}</td>
        <td>${openBids}</td>
        <td>
          <div class="zone-actions">
            <button class="btn-edit" data-zone-id="${zone.id}">✏️ Edit</button>
            <button class="btn-del" data-zone-id="${zone.id}" data-zone-code="${zoneCode}">🗑️</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('Zone load error:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--accent-red);padding:1.5rem;">Error loading zones</td></tr>';
  }
}

// (Zone modal functions are defined at the top of this file for early binding)



// ============================================
// MATCHING ENGINE TRIGGER
// ============================================
async function triggerMatching() {
  const btn = document.getElementById('triggerMatchBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';

  try {
    const resp = await fetch(`${API_BASE_URL}/api/match`, { method: 'POST' });
    if (resp.ok) {
      const data = await resp.json();
      showToast('Matching Complete', `${data.matchesCount || 0} trades settled.`, 'success');
    } else {
      showToast('Matching Error', 'Engine returned an error. Check logs.', 'error');
    }
  } catch (err) {
    showToast('Connection Error', 'Could not reach the matching engine. Is the backend running?', 'error');
  }

  btn.disabled = false;
  btn.textContent = '⚡ Run Matching Engine';
  loadSystemOverview();
}

// ============================================
// LIVE LOGS
// ============================================
function loadLogs() {
  // Avoid orderBy which requires a composite Firestore index — sort locally instead
  const logsQ = query(collection(db, 'logs'), limit(50));
  onSnapshot(logsQ, (snap) => {
    const feed = document.getElementById('logFeed');
    feed.innerHTML = '';
    if (snap.empty) {
      feed.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No logs yet. Run the matching engine.</div>';
      return;
    }
    
    // Sort locally by timestamp desc
    const logs = [];
    snap.forEach(d => logs.push(d.data()));
    logs.sort((a, b) => {
      const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return tb - ta;
    });
    
    logs.slice(0, 20).forEach(log => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-primary);font-size:0.8rem;font-family:var(--font-mono);';
      const typeColor = log.type === 'match' ? 'var(--accent-green)' : log.type === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)';
      div.innerHTML = `
        <span style="color:var(--text-muted);">[${formatDateTime(log.timestamp)}]</span>
        <span style="color:${typeColor};font-weight:600;">[${(log.type || 'info').toUpperCase()}]</span>
        <span style="color:var(--text-secondary);">${log.message || ''}</span>
      `;
      feed.appendChild(div);
    });
  }, (err) => {
    console.warn('Logs listener error (likely no index):', err.message);
    const feed = document.getElementById('logFeed');
    if (feed) feed.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;">Logs require Firestore index setup.</div>';
  });
}

// ============================================
// USERS TABLE
// ============================================
function loadUsersTable() {
  onSnapshot(collection(db, 'users'), (snap) => {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    snap.forEach(d => {
      const u = d.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:500;">${u.name || '—'}</td>
        <td><span class="badge badge-cyan">Zone ${u.zone || '?'}</span></td>
        <td><span class="badge ${u.role === 'prosumer' ? 'badge-green' : 'badge-amber'}">${u.role || '—'}</span></td>
        <td style="color:var(--accent-green);">${formatCurrency(u.walletBalance || 0)}</td>
        <td>${u.tradesCompleted || 0}</td>
        <td>${u.energyBalance?.toFixed(1) || '0'} kWh</td>
      `;
      tbody.appendChild(tr);
    });
  });
}

window.handleLogout = logout;

// ============================================
// REVENUE DASHBOARD
// ============================================
async function loadRevenueDashboard() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/platform-revenue`);
    if (resp.ok) {
      const data = await resp.json();
      document.getElementById('adminTotalFees').textContent = formatCurrency(data.totalFees || 0);
      document.getElementById('adminTotalVolume').textContent = formatCurrency(data.totalSettled || 0);

      // Daily revenue chart
      const dailyData = data.dailyRevenue || {};
      const labels = Object.keys(dailyData).sort().slice(-14);
      const values = labels.map(l => dailyData[l] || 0);

      const ctx = document.getElementById('revenueChart');
      if (ctx) {
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: labels.map(l => l.slice(5)),
            datasets: [{
              label: 'Daily Revenue (₹)',
              data: values,
              backgroundColor: 'rgba(0,255,135,0.5)',
              borderRadius: 4
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { family: 'Inter', size: 11 } } } },
            scales: {
              x: { ticks: { color: 'rgba(255,255,255,0.3)' }, grid: { color: 'rgba(255,255,255,0.03)' } },
              y: { ticks: { color: 'rgba(255,255,255,0.3)', callback: v => '₹' + v }, grid: { color: 'rgba(255,255,255,0.03)' } }
            }
          }
        });
      }
    } else {
      // Backend offline — try Firestore directly
      const platformDoc = await getDoc(doc(db, 'platformStats', 'totals'));
      if (platformDoc.exists()) {
        const stats = platformDoc.data();
        document.getElementById('adminTotalFees').textContent = formatCurrency(stats.totalFees || 0);
        document.getElementById('adminTotalVolume').textContent = formatCurrency(stats.totalSettled || 0);
      }
    }
  } catch (err) {
    console.warn('Revenue dashboard error:', err);
    // Firestore fallback
    try {
      const platformDoc = await getDoc(doc(db, 'platformStats', 'totals'));
      if (platformDoc.exists()) {
        const stats = platformDoc.data();
        document.getElementById('adminTotalFees').textContent = formatCurrency(stats.totalFees || 0);
        document.getElementById('adminTotalVolume').textContent = formatCurrency(stats.totalSettled || 0);
      }
    } catch (e) {
      console.warn('Firestore fallback error:', e);
    }
  }
}

// ============================================
// ENERGY SIMULATION TRIGGER
// ============================================
async function triggerSimulation() {
  const btn = document.getElementById('triggerSimBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';
  try {
    const resp = await fetch(`${API_BASE_URL}/api/simulate-generation`, { method: 'POST' });
    if (resp.ok) {
      showToast('Simulation Complete', 'Solar energy generation has been simulated for all prosumers.', 'success');
    } else {
      showToast('Simulation Failed', 'Backend returned an error. Check logs.', 'error');
    }
  } catch (err) {
    showToast('Backend Offline', 'Could not reach the backend to run simulation.', 'error');
  }
  btn.disabled = false;
  btn.textContent = '☀ Run Energy Sim';
}
