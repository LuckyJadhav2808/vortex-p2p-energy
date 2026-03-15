// ============================================
// VORTEX — Marketplace Logic
// Listings, fulfillment, price chart, activity
// ============================================

import {
  auth, db, API_BASE_URL,
  requireAuth, getUserProfile, logout,
  collection, query, where, orderBy, limit, onSnapshot, addDoc, getDocs, getDoc,
  doc, updateDoc, serverTimestamp, Timestamp
} from './config.js';
import { renderCompactLogo, injectFavicon } from './logo.js';
import {
  showToast, formatCurrency, formatTime, timeAgo, startCountdown,
  setPageTitle, setActiveSidebarLink, initSidebar
} from './utils.js';
import { initNotifications } from './notifications.js';

let currentUser = null;
let userProfile = null;
let currentZoneFilter = 'all';
let currentSort = 'price-asc';

requireAuth(async (user) => {
  currentUser = user;
  userProfile = await getUserProfile(user.uid);
  if (!userProfile) {
    userProfile = {
      name: currentUser.displayName || 'User',
      email: currentUser.email,
      zone: 'A', role: 'consumer',
      walletBalance: 500, energyBalance: 0, tradesCompleted: 0
    };
  }

  renderCompactLogo(document.getElementById('sidebarLogo'));
  injectFavicon();
  setPageTitle('Marketplace');
  setActiveSidebarLink();
  initSidebar(userProfile.role);

  document.getElementById('userZone').textContent = 'Zone ' + userProfile.zone;
  document.getElementById('userRole').textContent = userProfile.role === 'prosumer' ? '☀ Prosumer' : '🏠 Consumer';
  document.getElementById('userRole').className = 'sidebar-user-role ' + (userProfile.role === 'prosumer' ? 'role-prosumer' : 'role-consumer');
  document.getElementById('userName').textContent = userProfile.name;

  // Init notifications
  initNotifications(currentUser.uid);

  loadListings();
  loadPriceChart();
  loadMarketActivity();
  loadZoneFilter();
  setupControls();

  // Show role banner so user knows what they're seeing
  const subtitle = document.getElementById('marketSubtitle');
  if (subtitle) {
    if (userProfile.role === 'prosumer') {
      subtitle.textContent = '☀ Prosumer View — Showing buyer requests for your energy';
      subtitle.style.background = 'rgba(0,255,135,0.08)';
      subtitle.style.color = 'var(--accent-green)';
    } else {
      subtitle.textContent = '🏠 Consumer View — Showing sellers with available energy';
      subtitle.style.background = 'rgba(255,176,32,0.08)';
      subtitle.style.color = 'var(--accent-amber)';
    }
  }
});

function setupControls() {
  document.getElementById('zoneFilter')?.addEventListener('change', (e) => {
    currentZoneFilter = e.target.value;
    loadListings();
  });
  document.getElementById('sortBy')?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    loadListings();
  });
}

async function loadZoneFilter() {
  try {
    const zonesSnap = await getDocs(collection(db, 'zones'));
    const select = document.getElementById('zoneFilter');
    if (!select) return;
    zonesSnap.forEach(d => {
      const zone = d.data();
      const opt = document.createElement('option');
      opt.value = zone.code || d.id;
      opt.textContent = `Zone ${zone.code || d.id} — ${zone.label || ''}`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('Zone filter load error:', err);
  }
}

function loadListings() {
  // For prosumers, show buy requests (they want to sell their energy)
  // For consumers, show sell listings (they want to buy energy)
  const showType = userProfile.role === 'prosumer' ? 'buy' : 'sell';
  const headerText = userProfile.role === 'prosumer' ? '🔍 Energy Requests (Buyers)' : '⚡ Energy Listings (Sellers)';
  
  const headerEl = document.getElementById('listingsHeader');
  if (headerEl) headerEl.textContent = headerText;

  let q;
  if (currentZoneFilter !== 'all') {
    q = query(collection(db, 'bids'), where('type', '==', showType), where('status', '==', 'open'), where('zone', '==', currentZoneFilter));
  } else {
    q = query(collection(db, 'bids'), where('type', '==', showType), where('status', '==', 'open'));
  }

  onSnapshot(q, (snap) => {
    const grid = document.getElementById('listingsGrid');
    if (!grid) return;

    let bids = [];
    snap.forEach(d => bids.push({ id: d.id, ...d.data() }));

    // Sort
    switch (currentSort) {
      case 'price-asc': bids.sort((a, b) => a.pricePerUnit - b.pricePerUnit); break;
      case 'price-desc': bids.sort((a, b) => b.pricePerUnit - a.pricePerUnit); break;
      case 'amount-desc': bids.sort((a, b) => b.kwhAmount - a.kwhAmount); break;
      case 'newest': bids.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)); break;
    }

    if (bids.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">🔍</div><div class="empty-state-title">No listings found</div><div class="empty-state-text">Try changing your filters or check back later.</div></div>';
      return;
    }

    grid.innerHTML = '';
    bids.forEach(bid => {
      const isOwn = bid.userId === currentUser.uid;
      const card = document.createElement('div');
      card.className = 'listing-card';
      card.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-lg);padding:1.5rem;transition:all 0.3s;position:relative;overflow:hidden;';
      
      const colorAccent = showType === 'sell' ? 'var(--accent-green)' : 'var(--accent-amber)';
      const feeNote = showType === 'sell' ? '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.25rem;">2% platform fee applies</div>' : '';
      
      card.innerHTML = `
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${colorAccent};opacity:0.5;"></div>
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1rem;">
          <div>
            <span class="badge ${showType === 'sell' ? 'badge-green' : 'badge-amber'}">Zone ${bid.zone}</span>
            ${isOwn ? '<span class="badge badge-cyan" style="margin-left:0.25rem;">YOUR BID</span>' : ''}
          </div>
          <span class="bid-countdown" id="listing-timer-${bid.id}" style="font-family:var(--font-mono);font-size:0.75rem;color:var(--accent-amber);"></span>
        </div>
        <div style="font-family:var(--font-display);font-size:1.75rem;font-weight:700;color:${colorAccent};margin-bottom:0.25rem;">
          ₹${bid.pricePerUnit.toFixed(2)}<span style="font-size:0.85rem;color:var(--text-muted);font-weight:400;">/kWh</span>
        </div>
        ${feeNote}
        <div style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:1rem;">
          ${bid.kwhAmount} kWh available
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:0.75rem;border-top:1px solid var(--border-primary);">
          <span style="font-size:0.75rem;color:var(--text-muted);">by ${bid.userName || 'Anonymous'} • ${timeAgo(bid.createdAt)}</span>
          ${!isOwn ? `<button class="btn ${showType === 'sell' ? 'btn-primary' : 'btn-amber'} btn-sm" onclick="fulfillOrder('${bid.id}', '${showType}', ${bid.kwhAmount}, ${bid.pricePerUnit}, '${bid.zone}')">
            ${showType === 'sell' ? '🛒 Buy' : '☀ Sell'}
          </button>` : ''}
        </div>
      `;

      card.addEventListener('mouseenter', () => { card.style.borderColor = colorAccent; card.style.boxShadow = `0 0 20px ${colorAccent}15`; });
      card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--border-primary)'; card.style.boxShadow = 'none'; });

      grid.appendChild(card);

      // Start countdown
      if (bid.expiresAt) {
        const timerEl = document.getElementById(`listing-timer-${bid.id}`);
        if (timerEl) startCountdown(timerEl, bid.expiresAt);
      }
    });
  });
}

window.fulfillOrder = async function(bidId, bidType, kwh, price, zone) {
  const actionText = bidType === 'sell' ? 'buy' : 'sell';
  if (!confirm(`Confirm: ${actionText} ${kwh} kWh at ₹${price.toFixed(2)}/kWh from Zone ${zone}?`)) return;

  // Check balances
  if (bidType === 'sell') {
    // User is buying — check wallet
    const cost = kwh * price;
    if (cost > (userProfile.walletBalance || 0)) {
      showToast('Insufficient Balance', `This order costs ₹${cost.toFixed(2)} but your wallet has ₹${(userProfile.walletBalance || 0).toFixed(2)}.`, 'error');
      return;
    }
  } else {
    // User is selling — check energy
    if (kwh > (userProfile.energyBalance || 0)) {
      showToast('Insufficient Energy', `You only have ${(userProfile.energyBalance || 0).toFixed(1)} kWh available.`, 'warning');
      return;
    }
  }

  try {
    const counterType = bidType === 'sell' ? 'buy' : 'sell';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await addDoc(collection(db, 'bids'), {
      userId: currentUser.uid,
      userName: userProfile.name,
      zone: userProfile.zone,
      type: counterType,
      kwhAmount: kwh,
      pricePerUnit: price,
      status: 'open',
      autoMatch: true,
      targetBidId: bidId,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt)
    });

    // Try to trigger matching immediately
    fetch(`${API_BASE_URL}/api/match`, { method: 'POST' }).catch(() => {});
    
    // --- VORTEX ALIGNED ANIMATION (Multi-stage dramatic) ---
    const overlay = document.createElement('div');
    overlay.id = 'vortexSuccessOverlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:radial-gradient(ellipse at center, rgba(0,30,20,0.97) 0%, rgba(5,10,25,0.99) 100%);
      z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.4s ease;
      overflow:hidden;
    `;
    
    overlay.innerHTML = `
      <style>
        @keyframes vortexSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes vortexPulse { 0%,100% { transform: scale(1); opacity:1; } 50% { transform: scale(1.08); opacity:0.9; } }
        @keyframes lightningFlash { 0% { opacity:0; transform: translateY(-20px) scaleY(0); } 8% { opacity:1; transform: translateY(0) scaleY(1.1); } 16% { opacity:0.1; } 24% { opacity:1; transform: scaleY(1); } 40% { opacity:0.8; } 100% { opacity:0.4; transform: scaleY(1); } }
        @keyframes screenFlash { 0% { opacity:0; } 10% { opacity:0.6; } 30% { opacity:0; } }
        @keyframes textReveal { from { opacity:0; transform: translateY(20px); letter-spacing: 0.5em; } to { opacity:1; transform: translateY(0); letter-spacing: 0.15em; } }
        @keyframes subtextReveal { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
        @keyframes ringExpand { 0% { transform: scale(0.5); opacity:0.8; } 100% { transform: scale(3); opacity:0; } }
        @keyframes particleBurst { 0% { transform: translate(0,0) scale(1); opacity:1; } 100% { opacity:0; } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        
        .vortex-ring {
          position: absolute; border-radius: 50%;
          border: 2px solid rgba(0,255,135,0.3);
          animation: ringExpand 1.5s ease-out forwards;
          pointer-events: none;
        }
        .vortex-particle {
          position: absolute; width: 4px; height: 4px;
          background: #00FF87; border-radius: 50%;
          animation: particleBurst 1.2s ease-out forwards;
          pointer-events: none;
        }
      </style>
      
      <!-- Flash overlay -->
      <div id="vortexFlash" style="position:absolute;inset:0;background:rgba(0,255,135,0.15);opacity:0;pointer-events:none;z-index:1;animation: screenFlash 0.6s ease-out 0.8s both;"></div>
      
      <!-- Spinning gradient ring behind logo -->
      <div style="position:relative;width:160px;height:160px;display:flex;align-items:center;justify-content:center;margin-bottom:2rem;z-index:2;">
        <!-- Spinning outer ring -->
        <div style="position:absolute;width:160px;height:160px;border-radius:50%;
          background: conic-gradient(from 0deg, #00FF87, #00E5FF, #00FF87, transparent, #00FF87);
          animation: vortexSpin 3s linear infinite; opacity:0.4;"></div>
        <!-- Inner dark circle -->
        <div style="position:absolute;width:148px;height:148px;border-radius:50%;
          background:radial-gradient(circle, rgba(0,30,20,0.95) 60%, rgba(0,255,135,0.08) 100%);
          border:1px solid rgba(0,255,135,0.2);"></div>
        
        <!-- Lightning bolt behind V -->
        <svg viewBox="0 0 80 100" style="position:absolute;width:100px;height:125px;z-index:3;filter:drop-shadow(0 0 20px rgba(0,255,135,0.8)) drop-shadow(0 0 40px rgba(0,255,135,0.4));animation: lightningFlash 1.2s ease-out 0.6s both;opacity:0;">
          <polygon points="45,0 20,45 35,45 25,100 60,40 42,40 55,0" fill="url(#lgGrad)" stroke="#00FF87" stroke-width="1"/>
          <defs><linearGradient id="lgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="40%" stop-color="#00FF87"/><stop offset="100%" stop-color="#00C9A7"/></linearGradient></defs>
        </svg>
        
        <!-- Vortex V Logo -->
        <svg viewBox="0 0 60 60" style="position:absolute;width:70px;height:70px;z-index:4;animation: vortexPulse 2s ease-in-out infinite;">
          <defs>
            <linearGradient id="vGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#FFFFFF"/>
              <stop offset="100%" stop-color="#00FF87"/>
            </linearGradient>
            <filter id="vGlow"><feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <path d="M12 12 L30 48 L48 12" stroke="url(#vGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#vGlow)"/>
          <path d="M30 48 L48 12" stroke="#00FF87" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
      
      <!-- Text: VORTEX ALIGNED -->
      <h2 style="
        font-family: 'Space Grotesk', sans-serif; font-size: 2.2rem; font-weight: 700;
        background: linear-gradient(90deg, #FFF, #00FF87, #00E5FF, #FFF);
        background-size: 200% auto;
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        animation: textReveal 0.8s ease-out 0.3s both, shimmer 3s linear 1.1s infinite;
        margin: 0 0 0.75rem 0;
      ">VORTEX ALIGNED</h2>
      
      <p style="color:rgba(255,255,255,0.6);font-size:1rem;animation: subtextReveal 0.6s ease-out 0.6s both;opacity:0;">
        ⚡ Trade initiated • Preparing energy transfer...
      </p>
      
      <!-- Progress bar -->
      <div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:1.5rem;overflow:hidden;animation: subtextReveal 0.6s ease-out 0.8s both;opacity:0;">
        <div style="width:0%;height:100%;background:linear-gradient(90deg,#00FF87,#00E5FF);border-radius:2px;transition:width 2s ease-in-out;" id="vortexProgressBar"></div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Fade in
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      // Start progress bar
      setTimeout(() => {
        const bar = document.getElementById('vortexProgressBar');
        if (bar) bar.style.width = '100%';
      }, 300);
    });
    
    // Add particle burst at 1s
    setTimeout(() => {
      const center = overlay.querySelector('div[style*="160px"]');
      if (center) {
        for (let i = 0; i < 12; i++) {
          const p = document.createElement('div');
          p.className = 'vortex-particle';
          const angle = (i / 12) * Math.PI * 2;
          const dist = 80 + Math.random() * 40;
          p.style.left = '50%'; p.style.top = '50%';
          p.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0)`;
          overlay.appendChild(p);
        }
        // Add expanding rings
        for (let r = 0; r < 3; r++) {
          const ring = document.createElement('div');
          ring.className = 'vortex-ring';
          ring.style.width = ring.style.height = '80px';
          ring.style.left = 'calc(50% - 40px)';
          ring.style.top = 'calc(50% - 80px)';
          ring.style.animationDelay = `${r * 0.3}s`;
          overlay.appendChild(ring);
        }
      }
    }, 800);
    
    // Redirect to dashboard after 3s to see the energy beam
    setTimeout(() => {
      window.location.href = `dashboard.html?trade=${bidId}`;
    }, 3000);

  } catch (err) {
    console.error('Fulfill error:', err);
    showToast('Error', 'Failed to place counter-bid: ' + err.message, 'error');
  }
};

async function loadPriceChart() {
  const canvas = document.getElementById('priceChart');
  if (!canvas) return;

  try {
    const trades = [];
    const tradesSnap = await getDocs(query(collection(db, 'trades'), limit(100)));
    tradesSnap.forEach(d => trades.push(d.data()));
    
    // Sort locally properly
    trades.sort((a, b) => {
      const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return tb - ta;
    });

    // Group by hour for last 24 hours
    const now = Date.now();
    const hourlyData = {};
    const gridPrices = {};

    for (let i = 23; i >= 0; i--) {
      const hourKey = new Date(now - i * 60 * 60 * 1000).getHours() + ':00';
      hourlyData[hourKey] = [];
      // Simulate grid price with a time-of-use pattern
      const h = new Date(now - i * 60 * 60 * 1000).getHours();
      gridPrices[hourKey] = (h >= 17 && h < 22) ? 11.0 : (h >= 22 || h < 6) ? 6.5 : 8.5;
    }

    trades.forEach(t => {
      if (t.timestamp) {
        const ts = t.timestamp.toDate ? t.timestamp.toDate() : new Date(t.timestamp);
        const hourDiff = (now - ts.getTime()) / (60 * 60 * 1000);
        if (hourDiff <= 24) {
          const hourKey = ts.getHours() + ':00';
          if (hourlyData[hourKey]) {
            hourlyData[hourKey].push(t.clearingPrice || 0);
          }
        }
      }
    });

    const labels = Object.keys(hourlyData);
    const vortexPrices = labels.map(h => {
      const prices = hourlyData[h];
      return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    });
    const gridData = labels.map(h => gridPrices[h]);

    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Vortex Avg Price (₹/kWh)',
            data: vortexPrices,
            borderColor: '#00FF87',
            backgroundColor: 'rgba(0,255,135,0.1)',
            fill: true, tension: 0.4, pointRadius: 3,
            pointBackgroundColor: '#00FF87', borderWidth: 2,
            spanGaps: true
          },
          {
            label: 'Grid Price (₹/kWh)',
            data: gridData,
            borderColor: '#FF4757',
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { family: 'Inter', size: 11 } } }
        },
        scales: {
          x: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.03)' } },
          y: { ticks: { color: 'rgba(255,255,255,0.3)', callback: v => '₹' + v }, grid: { color: 'rgba(255,255,255,0.03)' } }
        }
      }
    });
  } catch (err) {
    console.error('Price chart error:', err);
  }
}

function loadMarketActivity() {
  // Query trades without orderBy to avoid requiring a composite index, which
  // often surfaces as a permission error if it doesn't exist. Sort locally.
  const tradesQ = query(collection(db, 'trades'), limit(50));
  
  onSnapshot(tradesQ, (snap) => {
    const feed = document.getElementById('marketplaceFeed');
    if (!feed) return;
    feed.innerHTML = '';
    
    if (snap.empty) {
      feed.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No recent market activity</div>';
      return;
    }
    
    // Sort locally by timestamp descending
    const allTrades = [];
    snap.forEach(d => allTrades.push(d.data()));
    allTrades.sort((a, b) => {
      const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return tb - ta;
    });
    
    // Take top 8
    const topTrades = allTrades.slice(0, 8);
    
    topTrades.forEach(trade => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border-primary);';
      const fee = trade.platformFee ? ` (fee: ₹${trade.platformFee.toFixed(2)})` : '';
      item.innerHTML = `
        <span style="font-size:1rem;">⚡</span>
        <div style="flex:1;">
          <div style="font-size:0.8rem;font-weight:500;">${trade.kwhAmount} kWh @ ₹${trade.clearingPrice?.toFixed(2)}${fee}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Zone ${trade.sellerZone} → Zone ${trade.buyerZone} • ${timeAgo(trade.timestamp)}</div>
        </div>
      `;
      feed.appendChild(item);
    });
  }, (error) => {
    console.error('Market Activity Snapshot Error:', error);
    const feed = document.getElementById('marketplaceFeed');
    if (feed) feed.innerHTML = `<div style="text-align:center;color:var(--accent-red);padding:2rem;">Error loading activity: ${error.message}</div>`;
  });
}

window.handleLogout = logout;
