// ============================================
// VORTEX — Analytics Logic
// Real-time price analytics with Chart.js + Grid API
// ============================================

import {
  auth, db, API_BASE_URL,
  requireAuth, getUserProfile, logout,
  collection, query, where, orderBy, limit, getDocs
} from './config.js';
import { renderCompactLogo, injectFavicon } from './logo.js';
import {
  showToast, animateCount, formatCurrency,
  setPageTitle, setActiveSidebarLink, initSidebar
} from './utils.js';
import { initNotifications } from './notifications.js';

let currentUser = null;
let userProfile = null;

requireAuth(async (user) => {
  currentUser = user;
  userProfile = await getUserProfile(user.uid);
  if (!userProfile) { userProfile = { name: 'User', zone: 'A', role: 'consumer' }; }

  renderCompactLogo(document.getElementById('sidebarLogo'));
  injectFavicon();
  setPageTitle('Analytics');
  setActiveSidebarLink();
  initSidebar(userProfile.role);

  document.getElementById('userZone').textContent = 'Zone ' + userProfile.zone;
  document.getElementById('userRole').textContent = userProfile.role === 'prosumer' ? '☀ Prosumer' : '🏠 Consumer';
  document.getElementById('userRole').className = 'sidebar-user-role ' + (userProfile.role === 'prosumer' ? 'role-prosumer' : 'role-consumer');
  document.getElementById('userName').textContent = userProfile.name;

  initNotifications(currentUser.uid);

  loadGridStatus();
  loadGridTariff();
  loadMarketStats();
  loadZonePriceChart();
  loadSupplyDemandChart();
  loadPriceTrendChart();
  loadVolumeChart();
});

// ---- Grid Status (from backend API) ----
async function loadGridStatus() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/grid/status`);
    if (resp.ok) {
      const data = await resp.json();
      document.getElementById('gridFrequency').textContent = data.gridFrequency + ' Hz';
      document.getElementById('gridLoad').textContent = data.loadLevel.charAt(0).toUpperCase() + data.loadLevel.slice(1);
      document.getElementById('gridLoad').style.color = data.loadLevel === 'high' ? 'var(--accent-red)' : data.loadLevel === 'low' ? 'var(--accent-green)' : 'var(--accent-amber)';
      document.getElementById('solarContrib').textContent = data.solarContribution + '%';
      document.getElementById('gridStatus').textContent = data.status === 'stable' ? '✅ Stable' : '⚠️ Stressed';
      document.getElementById('gridStatus').style.color = data.status === 'stable' ? 'var(--accent-green)' : 'var(--accent-red)';
    }
  } catch (err) {
    document.getElementById('gridFrequency').textContent = 'Offline';
    document.getElementById('gridLoad').textContent = 'N/A';
    document.getElementById('solarContrib').textContent = 'N/A';
    document.getElementById('gridStatus').textContent = '⚠️ Backend Offline';
  }
}

async function loadGridTariff() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/grid/tariff`);
    if (resp.ok) {
      const data = await resp.json();
      document.getElementById('gridTariff').textContent = `₹${data.currentRate}/kWh`;
      document.getElementById('gridTariff').style.color = data.currentType === 'peak' ? 'var(--accent-red)' : data.currentType === 'off_peak' ? 'var(--accent-green)' : 'var(--accent-amber)';
    }
  } catch (err) {
    document.getElementById('gridTariff').textContent = '₹8.50/kWh';
  }
}

// ---- Market Stats ----
async function loadMarketStats() {
  try {
    const tradesSnap = await getDocs(collection(db, 'trades'));
    let totalKwh = 0, totalValue = 0, count = 0;
    tradesSnap.forEach(d => {
      const t = d.data();
      totalKwh += t.kwhAmount || 0;
      totalValue += (t.kwhAmount || 0) * (t.clearingPrice || 0);
      count++;
    });

    animateCount(document.getElementById('totalTradesCount'), count, 800);
    animateCount(document.getElementById('totalKwhTraded'), totalKwh, 1000, '', '', 1);
    
    const avg = count > 0 ? totalValue / totalKwh : 0;
    document.getElementById('avgPrice').textContent = '₹' + avg.toFixed(2);

    const bidsSnap = await getDocs(query(collection(db, 'bids'), where('status', '==', 'open')));
    animateCount(document.getElementById('activeListings'), bidsSnap.size, 600);
  } catch (err) {
    console.error('Market stats error:', err);
  }
}

// ---- Chart Helpers ----
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

// ---- Zone-wise Average Price ----
async function loadZonePriceChart() {
  try {
    const trades = [];
    const snap = await getDocs(collection(db, 'trades'));
    snap.forEach(d => trades.push(d.data()));

    const zones = {};
    trades.forEach(t => {
      const zone = t.sellerZone || '?';
      if (!zones[zone]) zones[zone] = [];
      zones[zone].push(t.clearingPrice || 0);
    });

    const labels = Object.keys(zones).sort();
    const avgPrices = labels.map(z => {
      const p = zones[z];
      return p.reduce((a, b) => a + b, 0) / p.length;
    });

    new Chart(document.getElementById('zonePriceChart'), {
      type: 'bar',
      data: {
        labels: labels.map(z => 'Zone ' + z),
        datasets: [{
          label: 'Avg Price (₹/kWh)',
          data: avgPrices,
          backgroundColor: ['rgba(0,255,135,0.6)', 'rgba(0,229,255,0.6)', 'rgba(255,176,32,0.6)', 'rgba(255,71,87,0.6)', 'rgba(147,51,234,0.6)'],
          borderRadius: 6
        }]
      },
      options: chartOptions('₹')
    });
  } catch (err) { console.error('Zone price chart error:', err); }
}

// ---- Supply vs Demand ----
async function loadSupplyDemandChart() {
  try {
    const bids = [];
    const snap = await getDocs(query(collection(db, 'bids'), where('status', '==', 'open')));
    snap.forEach(d => bids.push(d.data()));

    const zones = {};
    bids.forEach(b => {
      const zone = b.zone || '?';
      if (!zones[zone]) zones[zone] = { supply: 0, demand: 0 };
      if (b.type === 'sell') zones[zone].supply += b.kwhAmount || 0;
      else zones[zone].demand += b.kwhAmount || 0;
    });

    const labels = Object.keys(zones).sort();
    new Chart(document.getElementById('supplyDemandChart'), {
      type: 'bar',
      data: {
        labels: labels.map(z => 'Zone ' + z),
        datasets: [
          { label: 'Supply (kWh)', data: labels.map(z => zones[z].supply), backgroundColor: 'rgba(0,255,135,0.6)', borderRadius: 4 },
          { label: 'Demand (kWh)', data: labels.map(z => zones[z].demand), backgroundColor: 'rgba(255,176,32,0.6)', borderRadius: 4 }
        ]
      },
      options: chartOptions('')
    });
  } catch (err) { console.error('Supply/demand chart error:', err); }
}

// ---- 24-Hour Price Trend ----
async function loadPriceTrendChart() {
  try {
    const trades = [];
    const snap = await getDocs(query(collection(db, 'trades'), orderBy('timestamp', 'desc'), limit(100)));
    snap.forEach(d => trades.push(d.data()));

    const now = Date.now();
    const hourlyData = {};
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now - i * 3600000).getHours();
      hourlyData[h + ':00'] = [];
    }

    trades.forEach(t => {
      const ts = t.timestamp?.toDate ? t.timestamp.toDate() : null;
      if (ts && (now - ts.getTime()) < 86400000) {
        const h = ts.getHours() + ':00';
        if (hourlyData[h]) hourlyData[h].push(t.clearingPrice || 0);
      }
    });

    const labels = Object.keys(hourlyData);
    const vortex = labels.map(h => {
      const p = hourlyData[h];
      return p.length > 0 ? p.reduce((a, b) => a + b, 0) / p.length : null;
    });

    // Grid tariff simulation
    const grid = labels.map(h => {
      const hour = parseInt(h);
      if (hour >= 17 && hour < 22) return 11.0;
      if (hour >= 22 || hour < 6) return 6.5;
      return 8.5;
    });

    new Chart(document.getElementById('priceTrendChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Vortex Avg (₹/kWh)', data: vortex, borderColor: '#00FF87', backgroundColor: 'rgba(0,255,135,0.1)', fill: true, tension: 0.4, pointRadius: 3, borderWidth: 2, spanGaps: true },
          { label: 'Grid Tariff (₹/kWh)', data: grid, borderColor: '#FF4757', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false }
        ]
      },
      options: chartOptions('₹')
    });
  } catch (err) { console.error('Price trend error:', err); }
}

// ---- Trade Volume (7 Days) ----
async function loadVolumeChart() {
  try {
    const trades = [];
    const snap = await getDocs(collection(db, 'trades'));
    snap.forEach(d => trades.push(d.data()));

    const now = Date.now();
    const dayLabels = [];
    const volumes = [];
    const values = [];

    for (let i = 6; i >= 0; i--) {
      const day = new Date(now - i * 86400000);
      const label = day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
      dayLabels.push(label);

      let dayKwh = 0, dayVal = 0;
      trades.forEach(t => {
        const ts = t.timestamp?.toDate ? t.timestamp.toDate() : null;
        if (ts && ts.toDateString() === day.toDateString()) {
          dayKwh += t.kwhAmount || 0;
          dayVal += (t.kwhAmount || 0) * (t.clearingPrice || 0);
        }
      });
      volumes.push(dayKwh);
      values.push(dayVal);
    }

    new Chart(document.getElementById('volumeChart'), {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [
          { label: 'Volume (kWh)', data: volumes, backgroundColor: 'rgba(0,229,255,0.5)', borderRadius: 4, yAxisID: 'y' },
          { label: 'Value (₹)', data: values, type: 'line', borderColor: '#00FF87', borderWidth: 2, pointRadius: 3, tension: 0.4, yAxisID: 'y1' }
        ]
      },
      options: {
        ...chartOptions(''),
        scales: {
          ...chartOptions('').scales,
          y1: {
            position: 'right',
            ticks: { color: 'rgba(255,255,255,0.3)', callback: v => '₹' + v },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  } catch (err) { console.error('Volume chart error:', err); }
}

window.handleLogout = logout;
