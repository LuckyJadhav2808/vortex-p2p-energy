// ============================================
// VORTEX — Profile & Analytics Logic
// Real chart data from Firestore trades
// ============================================

import {
  auth, db,
  requireAuth, getUserProfile, logout,
  collection, query, where, orderBy, limit, onSnapshot, getDocs,
  doc, getDoc, updateDoc, serverTimestamp
} from './config.js';
import { renderCompactLogo, injectFavicon } from './logo.js';
import {
  showToast, formatCurrency, formatDateTime,
  setPageTitle, setActiveSidebarLink, initSidebar
} from './utils.js';
import { initNotifications } from './notifications.js';

let currentUser = null;
let userProfile = null;
let tradeHistoryPage = 1;
const PAGE_SIZE = 10;
let allTrades = [];

requireAuth(async (user) => {
  currentUser = user;
  userProfile = await getUserProfile(user.uid);
  if (!userProfile) { userProfile = { name: currentUser.displayName || 'User', email: currentUser.email, zone: 'A', role: 'consumer', walletBalance: 500, energyBalance: 0, tradesCompleted: 0 }; }

  renderCompactLogo(document.getElementById('sidebarLogo'));
  injectFavicon();
  setPageTitle('Profile');
  setActiveSidebarLink();
  initSidebar(userProfile.role);

  document.getElementById('userZone').textContent = 'Zone ' + userProfile.zone;
  document.getElementById('userRole').textContent = userProfile.role === 'prosumer' ? '☀ Prosumer' : '🏠 Consumer';
  document.getElementById('userRole').className = 'sidebar-user-role ' + (userProfile.role === 'prosumer' ? 'role-prosumer' : 'role-consumer');
  document.getElementById('userName').textContent = userProfile.name;

  initNotifications(currentUser.uid);
  renderProfileCard();
  loadChartsFromFirestore();
  loadGreenImpact();
  loadTradeHistory();
  loadDynamicZones();
});

function renderProfileCard() {
  document.getElementById('profileName').textContent = userProfile.name;
  document.getElementById('profileEmail').textContent = userProfile.email;
  document.getElementById('profileZone').textContent = 'Zone ' + userProfile.zone;
  document.getElementById('profileRole').textContent = userProfile.role === 'prosumer' ? 'Prosumer (Solar)' : 'Consumer';
  document.getElementById('profileCapacity').textContent = userProfile.solarCapacity ? userProfile.solarCapacity + ' kWh/mo' : 'N/A';
  document.getElementById('profileTrades').textContent = userProfile.tradesCompleted || 0;
  document.getElementById('profileWallet').textContent = formatCurrency(userProfile.walletBalance || 0);
  
  // Avatar initial
  const avatar = document.getElementById('profileAvatar');
  if (avatar) avatar.textContent = (userProfile.name || 'U')[0].toUpperCase();
}

async function loadChartsFromFirestore() {
  try {
    // Fetch user's trades (both sell and buy)
    const sellTradesSnap = await getDocs(query(collection(db, 'trades'), where('sellerId', '==', currentUser.uid)));
    const buyTradesSnap = await getDocs(query(collection(db, 'trades'), where('buyerId', '==', currentUser.uid)));

    const sellTrades = [];
    sellTradesSnap.forEach(d => sellTrades.push(d.data()));
    const buyTrades = [];
    buyTradesSnap.forEach(d => buyTrades.push(d.data()));

    // Also fetch wallet transactions for earnings/savings
    const txSnap = await getDocs(query(collection(db, 'walletTransactions'), where('userId', '==', currentUser.uid)));
    const transactions = [];
    txSnap.forEach(d => transactions.push(d.data()));

    // ---- Chart 1: Production vs Consumption (7 days) ----
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const now = Date.now();
    const dayBuckets = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const dayName = days[d.getDay() === 0 ? 6 : d.getDay() - 1];
      dayBuckets[dayName] = { produced: 0, consumed: 0 };
    }

    sellTrades.forEach(t => {
      const ts = t.timestamp?.toDate ? t.timestamp.toDate() : null;
      if (ts) {
        const dayDiff = Math.floor((now - ts.getTime()) / 86400000);
        if (dayDiff < 7) {
          const dayName = days[ts.getDay() === 0 ? 6 : ts.getDay() - 1];
          if (dayBuckets[dayName]) dayBuckets[dayName].produced += t.kwhAmount || 0;
        }
      }
    });

    buyTrades.forEach(t => {
      const ts = t.timestamp?.toDate ? t.timestamp.toDate() : null;
      if (ts) {
        const dayDiff = Math.floor((now - ts.getTime()) / 86400000);
        if (dayDiff < 7) {
          const dayName = days[ts.getDay() === 0 ? 6 : ts.getDay() - 1];
          if (dayBuckets[dayName]) dayBuckets[dayName].consumed += t.kwhAmount || 0;
        }
      }
    });

    const dayLabels = Object.keys(dayBuckets);
    const prodData = dayLabels.map(d => dayBuckets[d].produced);
    const consData = dayLabels.map(d => dayBuckets[d].consumed);

    new Chart(document.getElementById('prodConsChart'), {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [
          { label: 'Sold (kWh)', data: prodData, backgroundColor: 'rgba(0,255,135,0.6)', borderRadius: 4 },
          { label: 'Bought (kWh)', data: consData, backgroundColor: 'rgba(255,176,32,0.6)', borderRadius: 4 }
        ]
      },
      options: chartOptions('kWh')
    });

    // ---- Chart 2: Earnings/Savings (7 days) ----
    const earningsBuckets = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const dayName = days[d.getDay() === 0 ? 6 : d.getDay() - 1];
      earningsBuckets[dayName] = 0;
    }

    transactions.forEach(tx => {
      if (tx.type === 'trade_credit' || tx.type === 'trade_debit') {
        const ts = tx.timestamp?.toDate ? tx.timestamp.toDate() : null;
        if (ts) {
          const dayDiff = Math.floor((now - ts.getTime()) / 86400000);
          if (dayDiff < 7) {
            const dayName = days[ts.getDay() === 0 ? 6 : ts.getDay() - 1];
            if (earningsBuckets[dayName] !== undefined) {
              earningsBuckets[dayName] += Math.abs(tx.amount || 0);
            }
          }
        }
      }
    });

    const earningsData = dayLabels.map(d => earningsBuckets[d] || 0);

    new Chart(document.getElementById('earningsChart'), {
      type: 'line',
      data: {
        labels: dayLabels,
        datasets: [{
          label: userProfile.role === 'prosumer' ? 'Earnings (₹)' : 'Spending (₹)',
          data: earningsData,
          borderColor: '#00FF87',
          backgroundColor: 'rgba(0,255,135,0.1)',
          fill: true, tension: 0.4, pointRadius: 4,
          pointBackgroundColor: '#00FF87', borderWidth: 2
        }]
      },
      options: chartOptions('₹')
    });

    // ---- Chart 3: Trade Activity by Hour ----
    const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const hourData = new Array(24).fill(0);

    [...sellTrades, ...buyTrades].forEach(t => {
      const ts = t.timestamp?.toDate ? t.timestamp.toDate() : null;
      if (ts) {
        hourData[ts.getHours()]++;
      }
    });

    new Chart(document.getElementById('activityChart'), {
      type: 'bar',
      data: {
        labels: hours,
        datasets: [{
          label: 'Trades',
          data: hourData,
          backgroundColor: hourData.map(v => v > 3 ? 'rgba(255,176,32,0.7)' : 'rgba(0,229,255,0.5)'),
          borderRadius: 2
        }]
      },
      options: {
        ...chartOptions(''),
        plugins: { ...chartOptions('').plugins, legend: { display: false } }
      }
    });

  } catch (err) {
    console.error('Chart loading error:', err);
    // Fallback to empty charts if Firestore queries fail
  }
}

function chartOptions(unit) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { family: 'Inter', size: 11 } } }
    },
    scales: {
      x: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
      y: { ticks: { color: 'rgba(255,255,255,0.3)', callback: v => unit + v }, grid: { color: 'rgba(255,255,255,0.03)' } }
    }
  };
}

async function loadGreenImpact() {
  const tradesQ = query(collection(db, 'trades'), where('sellerId', '==', currentUser.uid));
  const snap = await getDocs(tradesQ);
  let totalKwh = 0;
  snap.forEach(d => { totalKwh += d.data().kwhAmount || 0; });

  const buyQ = query(collection(db, 'trades'), where('buyerId', '==', currentUser.uid));
  const buySnap = await getDocs(buyQ);
  buySnap.forEach(d => { totalKwh += d.data().kwhAmount || 0; });

  const co2Saved = totalKwh * 0.82;
  const monthlyTarget = 100;
  const progress = Math.min((co2Saved / monthlyTarget) * 100, 100);

  document.getElementById('co2Value').textContent = co2Saved.toFixed(1) + ' kg';
  document.getElementById('co2Progress').style.width = progress + '%';
  document.getElementById('co2Target').textContent = `${co2Saved.toFixed(1)} / ${monthlyTarget} kg monthly target`;
}

async function loadTradeHistory() {
  const sellQ = query(collection(db, 'trades'), where('sellerId', '==', currentUser.uid), orderBy('timestamp', 'desc'));
  const buyQ = query(collection(db, 'trades'), where('buyerId', '==', currentUser.uid), orderBy('timestamp', 'desc'));

  try {
    const [sellSnap, buySnap] = await Promise.all([getDocs(sellQ), getDocs(buyQ)]);
    allTrades = [];
    sellSnap.forEach(d => allTrades.push({ id: d.id, role: 'seller', ...d.data() }));
    buySnap.forEach(d => allTrades.push({ id: d.id, role: 'buyer', ...d.data() }));
    allTrades.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    renderTradeHistoryPage();
  } catch (err) {
    console.error('Trade history error:', err);
  }
}

function renderTradeHistoryPage() {
  const tbody = document.getElementById('tradeHistoryBody');
  const start = (tradeHistoryPage - 1) * PAGE_SIZE;
  const items = allTrades.slice(start, start + PAGE_SIZE);

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No trade history yet</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  items.forEach(t => {
    const fee = t.platformFee ? ` (fee: ₹${t.platformFee.toFixed(2)})` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size:0.8rem;color:var(--text-muted);">${formatDateTime(t.timestamp)}</td>
      <td><span class="badge ${t.role === 'seller' ? 'badge-green' : 'badge-amber'}">${t.role === 'seller' ? 'Sold' : 'Bought'}</span></td>
      <td>${t.kwhAmount} kWh</td>
      <td style="color:var(--accent-green);">₹${t.clearingPrice?.toFixed(2)}</td>
      <td>${formatCurrency(t.kwhAmount * (t.clearingPrice || 0))}${fee}</td>
      <td><span class="badge badge-cyan">Zone ${t.role === 'seller' ? t.buyerZone : t.sellerZone || '?'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // Pagination
  const totalPages = Math.ceil(allTrades.length / PAGE_SIZE);
  const pag = document.getElementById('tradeHistPag');
  pag.innerHTML = '';
  if (totalPages > 1) {
    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.className = i === tradeHistoryPage ? 'active' : '';
      btn.onclick = () => { tradeHistoryPage = i; renderTradeHistoryPage(); };
      pag.appendChild(btn);
    }
  }
}

// ---- Dynamic Zones for Edit Modal ----
async function loadDynamicZones() {
  try {
    const zonesSnap = await getDocs(collection(db, 'zones'));
    const select = document.getElementById('editZone');
    if (!select) return;
    select.innerHTML = ''; // Clear hardcoded options
    zonesSnap.forEach(d => {
      const z = d.data();
      const opt = document.createElement('option');
      opt.value = z.code || d.id;
      opt.textContent = `Zone ${z.code || d.id} — ${z.label || ''}`;
      if ((z.code || d.id) === userProfile.zone) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('Could not load zones for edit modal:', err);
  }
}

// ---- Edit Profile ----
window.openEditProfile = function() {
  document.getElementById('editName').value = userProfile.name;
  document.getElementById('editZone').value = userProfile.zone;
  document.getElementById('editCapacity').value = userProfile.solarCapacity || '';
  document.getElementById('editModal').classList.add('active');
};

window.closeEditModal = function() {
  document.getElementById('editModal').classList.remove('active');
};

window.saveProfile = async function() {
  const name = document.getElementById('editName').value.trim();
  const zone = document.getElementById('editZone').value;
  const capacity = parseFloat(document.getElementById('editCapacity').value) || 0;

  if (!name) { showToast('Error', 'Name is required.', 'warning'); return; }

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { name, zone, solarCapacity: capacity });
    userProfile.name = name;
    userProfile.zone = zone;
    userProfile.solarCapacity = capacity;
    renderProfileCard();
    closeEditModal();
    showToast('Profile Updated', 'Your profile has been saved.', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
};

window.handleLogout = logout;
