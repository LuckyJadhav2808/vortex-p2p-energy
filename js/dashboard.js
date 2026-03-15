// ============================================
// VORTEX — Dashboard Logic
// Energy map, bid book, bid placement, transactions,
// interactive zone map, bid expiry countdown, energy simulation
// ============================================

import {
  auth, db, rtdb, API_BASE_URL,
  requireAuth, getUserProfile, logout,
  collection, query, where, orderBy, limit, onSnapshot, addDoc, getDocs,
  doc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp,
  ref, onValue, set as rtSet
} from './config.js';
import { renderCompactLogo, injectFavicon, triggerFirstTradeEasterEgg, triggerMatchAnimation } from './logo.js';
import {
  showToast, animateCount, formatCurrency, formatTime, timeAgo, startCountdown,
  setPageTitle, setActiveSidebarLink, initSidebar, showSkeletons
} from './utils.js';
import { initNotifications } from './notifications.js';

let currentUser = null;
let userProfile = null;

// ---- Initialize ----
requireAuth(async (user) => {
  currentUser = user;

  try {
    userProfile = await getUserProfile(user.uid);
  } catch (err) {
    console.error('Error fetching profile:', err);
    userProfile = null;
  }

  if (!userProfile) {
    // Profile doesn't exist — create a fallback and try to save to Firestore
    userProfile = {
      name: user.displayName || user.email?.split('@')[0] || 'Vortex User',
      email: user.email || '',
      zone: 'A',
      role: 'consumer',
      solarCapacity: 0,
      walletBalance: 500,
      energyBalance: 0,
      tradesCompleted: 0,
      firstTradeCompleted: false,
      isAdmin: false
    };

    try {
      const { setDoc } = await import('./config.js');
      await setDoc(doc(db, 'users', user.uid), {
        ...userProfile,
        authProvider: 'auto',
        createdAt: serverTimestamp()
      });
      // Re-fetch to get server-generated fields
      const freshProfile = await getUserProfile(user.uid);
      if (freshProfile) userProfile = freshProfile;
    } catch (err) {
      console.warn('Could not save profile to Firestore:', err.message);
    }
  }

  renderCompactLogo(document.getElementById('sidebarLogo'));
  injectFavicon();
  setPageTitle('Dashboard');
  setActiveSidebarLink();
  initSidebar(userProfile.role);

  // Populate sidebar user info
  document.getElementById('userZone').textContent = 'Zone ' + (userProfile.zone || 'A');
  document.getElementById('userRole').textContent = userProfile.role === 'prosumer' ? '☀ Prosumer' : '🏠 Consumer';
  document.getElementById('userRole').className = 'sidebar-user-role ' + (userProfile.role === 'prosumer' ? 'role-prosumer' : 'role-consumer');
  document.getElementById('userName').textContent = userProfile.name || 'User';
  document.getElementById('userEnergy').textContent = (userProfile.energyBalance || 0).toFixed(1) + ' kWh';

  // Init notifications
  initNotifications(currentUser.uid);

  try { loadStats(); } catch(e) { console.warn('Stats error:', e); }
  try { loadBidBook(); } catch(e) { console.warn('Bid book error:', e); }
  try { loadRecentTransactions(); } catch(e) { console.warn('Transactions error:', e); }
  try { listenForTradeNotifications(); } catch(e) { console.warn('Notifications error:', e); }
  try { fetchPriceSuggestion(); } catch(e) { console.warn('Price suggestion error:', e); }
  try { initEnergyMap(); } catch(e) { console.warn('Energy map error:', e); }
  try { syncActiveBidsToRTDB(); } catch(e) { console.warn('RTDB sync error:', e); }
  try { showSolarGeneration(); } catch(e) { console.warn('Solar gen error:', e); }
});

// ---- Top Stats ----
async function loadStats() {
  // Wallet
  animateCount(document.getElementById('statWallet'), userProfile.walletBalance || 0, 1200, '₹', '', 2);
  // Energy
  animateCount(document.getElementById('statEnergy'), userProfile.energyBalance || 0, 1200, '', ' kWh', 1);
  // Trades completed
  animateCount(document.getElementById('statTrades'), userProfile.tradesCompleted || 0, 800, '', '', 0);

  // Active bids count
  const bidsQ = query(collection(db, 'bids'), where('userId', '==', currentUser.uid), where('status', '==', 'open'));
  const bidsSnap = await getDocs(bidsQ);
  animateCount(document.getElementById('statActiveBids'), bidsSnap.size, 800, '', '', 0);
}

// ---- Live Bid Order Book (with expiry countdown) ----
function loadBidBook() {
  // Sell orders
  const sellQ = query(collection(db, 'bids'), where('type', '==', 'sell'), where('status', '==', 'open'));
  onSnapshot(sellQ, (snap) => {
    const tbody = document.getElementById('sellOrdersBody');
    tbody.innerHTML = '';
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No sell orders</td></tr>';
      return;
    }
    
    let bids = [];
    snap.forEach(d => bids.push({ id: d.id, ...d.data() }));
    bids.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    bids = bids.slice(0, 10);
    
    bids.forEach(bid => {
      const isYours = bid.userId === currentUser?.uid;
      const tr = document.createElement('tr');
      tr.style.animation = 'toastSlideIn 0.3s ease';
      if (isYours) tr.style.background = 'rgba(0,255,135,0.05)';
      tr.innerHTML = `
        <td>
          <span class="badge badge-green">Zone ${bid.zone}</span>
          ${isYours ? '<span class="badge badge-green" style="font-size:0.6rem;margin-left:4px;">YOU</span>' : ''}
        </td>
        <td>${bid.kwhAmount} kWh</td>
        <td style="color:var(--accent-green)">₹${bid.pricePerUnit.toFixed(2)}</td>
        <td><span class="bid-timer" id="sell-timer-${bid.id}" style="font-family:var(--font-mono);font-size:0.75rem;color:var(--accent-amber);"></span></td>
        <td style="color:var(--text-muted)">
          ${isYours ? `<button class="btn btn-ghost btn-sm" style="color:var(--accent-red);padding:0.25rem 0.5rem;" onclick="cancelBid('${bid.id}')">Cancel</button>` : timeAgo(bid.createdAt)}
        </td>
      `;
      tbody.appendChild(tr);

      // Start countdown timer for this bid
      if (bid.expiresAt) {
        const timerEl = document.getElementById(`sell-timer-${bid.id}`);
        if (timerEl) startCountdown(timerEl, bid.expiresAt);
      }
    });
  }, (error) => {
    console.error("Sell Orders Error:", error.message);
    document.getElementById('sellOrdersBody').innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--accent-red);padding:1.5rem;">Database query failed. See console.</td></tr>`;
  });

  // Buy orders
  const buyQ = query(collection(db, 'bids'), where('type', '==', 'buy'), where('status', '==', 'open'));
  onSnapshot(buyQ, (snap) => {
    const tbody = document.getElementById('buyOrdersBody');
    tbody.innerHTML = '';
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No buy orders</td></tr>';
      return;
    }
    
    let bids = [];
    snap.forEach(d => bids.push({ id: d.id, ...d.data() }));
    bids.sort((a, b) => b.pricePerUnit - a.pricePerUnit);
    bids = bids.slice(0, 10);
    
    bids.forEach(bid => {
      const isYours = bid.userId === currentUser?.uid;
      const tr = document.createElement('tr');
      tr.style.animation = 'toastSlideIn 0.3s ease';
      if (isYours) tr.style.background = 'rgba(255,176,32,0.05)';
      tr.innerHTML = `
        <td>
          <span class="badge badge-amber">Zone ${bid.zone}</span>
          ${isYours ? '<span class="badge badge-amber" style="font-size:0.6rem;margin-left:4px;">YOU</span>' : ''}
        </td>
        <td>${bid.kwhAmount} kWh</td>
        <td style="color:var(--accent-amber)">₹${bid.pricePerUnit.toFixed(2)}</td>
        <td><span class="bid-timer" id="buy-timer-${bid.id}" style="font-family:var(--font-mono);font-size:0.75rem;color:var(--accent-amber);"></span></td>
        <td style="color:var(--text-muted)">
          ${isYours ? `<button class="btn btn-ghost btn-sm" style="color:var(--accent-red);padding:0.25rem 0.5rem;" onclick="cancelBid('${bid.id}')">Cancel</button>` : timeAgo(bid.createdAt)}
        </td>
      `;
      tbody.appendChild(tr);

      // Start countdown timer
      if (bid.expiresAt) {
        const timerEl = document.getElementById(`buy-timer-${bid.id}`);
        if (timerEl) startCountdown(timerEl, bid.expiresAt);
      }
    });
  }, (error) => {
    console.error("Buy Orders Error:", error.message);
    document.getElementById('buyOrdersBody').innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--accent-red);padding:1.5rem;">Database query failed. See console.</td></tr>`;
  });
}

// ---- Recent Transactions ----
function loadRecentTransactions() {
  const tradesQ = query(collection(db, 'trades'), orderBy('timestamp', 'desc'), limit(10));
  onSnapshot(tradesQ, (snap) => {
    const feed = document.getElementById('transactionsFeed');
    feed.innerHTML = '';
    if (snap.empty) {
      feed.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No trades yet</div><div class="empty-state-text">Trades will appear here once the matching engine processes bids.</div></div>';
      return;
    }
    snap.forEach(d => {
      const trade = d.data();
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:flex-start;gap:0.75rem;padding:0.875rem 0;border-bottom:1px solid var(--border-primary);';
      const isBuyer = trade.buyerId === currentUser.uid;
      const isSeller = trade.sellerId === currentUser.uid;
      let highlight = '';
      if (isBuyer) highlight = 'border-left:3px solid var(--accent-amber);padding-left:0.75rem;';
      if (isSeller) highlight = 'border-left:3px solid var(--accent-green);padding-left:0.75rem;';
      item.style.cssText += highlight;

      const feeText = trade.platformFee ? ` (fee: ₹${trade.platformFee.toFixed(2)})` : '';
      item.innerHTML = `
        <div style="width:36px;height:36px;border-radius:8px;background:var(--accent-green-dim);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">⚡</div>
        <div style="flex:1;">
          <div style="font-size:0.85rem;font-weight:500;">
            Zone ${trade.sellerZone || '?'} → Zone ${trade.buyerZone || '?'}
            ${isBuyer ? '<span class="badge badge-amber" style="margin-left:0.5rem;">You Bought</span>' : ''}
            ${isSeller ? '<span class="badge badge-green" style="margin-left:0.5rem;">You Sold</span>' : ''}
          </div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.2rem;">
            ${trade.kwhAmount} kWh @ ₹${trade.clearingPrice?.toFixed(2)} / kWh${feeText} — ${timeAgo(trade.timestamp)}
          </div>
        </div>
      `;
      feed.appendChild(item);
    });
  });
}

// ---- Place a Bid ----
window.submitBid = async function() {
  const bidType = document.querySelector('input[name="bidType"]:checked')?.value;
  const kwh = parseFloat(document.getElementById('bidKwh').value);
  const price = parseFloat(document.getElementById('bidPrice').value);
  const autoMatch = document.getElementById('bidAutoMatch').checked;
  const btn = document.getElementById('submitBidBtn');

  if (!bidType || !kwh || !price || kwh <= 0 || price <= 0) {
    showToast('Invalid Bid', 'Please fill in all fields with valid values.', 'warning');
    return;
  }

  // Check wallet for buy bids
  if (bidType === 'buy') {
    const cost = kwh * price;
    if (cost > (userProfile.walletBalance || 0)) {
      showToast('Insufficient Balance', `This bid requires ₹${cost.toFixed(2)} but your wallet has ₹${(userProfile.walletBalance || 0).toFixed(2)}.`, 'error');
      return;
    }
  }

  // Check energy for sell bids
  if (bidType === 'sell') {
    if (kwh > (userProfile.energyBalance || 0)) {
      showToast('Insufficient Energy', `You only have ${(userProfile.energyBalance || 0).toFixed(1)} kWh available.`, 'warning');
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Placing...';

  try {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await addDoc(collection(db, 'bids'), {
      userId: currentUser.uid,
      userName: userProfile.name,
      zone: userProfile.zone,
      type: bidType,
      kwhAmount: kwh,
      pricePerUnit: price,
      status: 'open',
      autoMatch: autoMatch,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt)
    });

    showToast('Bid Placed!', `Your ${bidType} bid for ${kwh} kWh at ₹${price}/kWh is live on the order book.`, 'success');
    document.getElementById('bidKwh').value = '';
    document.getElementById('bidPrice').value = '';

    // Reload stats
    const bidsQ = query(collection(db, 'bids'), where('userId', '==', currentUser.uid), where('status', '==', 'open'));
    const bidsSnap = await getDocs(bidsQ);
    document.getElementById('statActiveBids').textContent = bidsSnap.size;

    // Sync active bids to RTDB for energy map
    syncActiveBidsToRTDB();
  } catch (error) {
    console.error("Error placing bid:", error);
    showToast('Error', 'Could not place bid. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place Bid';
  }
};

// ---- Cancel a Bid ----
window.cancelBid = async function(bidId) {
  if (!confirm('Are you sure you want to cancel this bid?')) return;
  try {
    await deleteDoc(doc(db, 'bids', bidId));
    showToast('Bid Cancelled', 'Your bid has been removed from the order book.', 'info');
    syncActiveBidsToRTDB();
  } catch (err) {
    console.error('Error cancelling bid:', err);
    showToast('Error', 'Failed to cancel the bid.', 'error');
  }
};

// ---- Smart Price Suggestion ----
async function fetchPriceSuggestion() {
  const widget = document.getElementById('priceSuggestion');
  try {
    const resp = await fetch(`${API_BASE_URL}/api/price-suggestion/${userProfile.zone}`);
    if (resp.ok) {
      const data = await resp.json();
      widget.innerHTML = `<span style="color:var(--accent-cyan)">⚡ Suggested: ₹${data.suggestedPrice?.toFixed(2) || '5.50'}/kWh</span> <span style="color:var(--text-muted);font-size:0.7rem;">(based on ${data.basedOnTrades || 0} trades)</span>`;
    } else {
      widget.innerHTML = `<span style="color:var(--accent-cyan)">⚡ Suggested: ₹5.50/kWh</span>`;
    }
  } catch {
    widget.innerHTML = `<span style="color:var(--accent-cyan)">⚡ Suggested: ₹5.50/kWh</span>`;
  }
}

// ---- Trade Settlement Notifications ----
function listenForTradeNotifications() {
  const tradesQ = query(collection(db, 'trades'), orderBy('timestamp', 'desc'), limit(1));
  let isFirst = true;
  onSnapshot(tradesQ, (snap) => {
    if (isFirst) { isFirst = false; return; }
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const trade = change.doc.data();
        if (trade.buyerId === currentUser.uid) {
          triggerMatchAnimation(trade.kwhAmount);
          drawTradeConnection(trade.sellerZone, trade.buyerZone);
          showToast('Trade Settled!', `You bought ${trade.kwhAmount} kWh at ₹${trade.clearingPrice?.toFixed(2)}/kWh. Wallet debited ₹${(trade.kwhAmount * trade.clearingPrice).toFixed(2)}.`, 'success');
          checkFirstTrade();
          refreshProfile();
        } else if (trade.sellerId === currentUser.uid) {
          triggerMatchAnimation(trade.kwhAmount);
          drawTradeConnection(trade.sellerZone, trade.buyerZone);
          const fee = trade.platformFee || 0;
          const credit = (trade.kwhAmount * trade.clearingPrice) - fee;
          showToast('Trade Settled!', `You sold ${trade.kwhAmount} kWh at ₹${trade.clearingPrice?.toFixed(2)}/kWh. Credited ₹${credit.toFixed(2)} (fee: ₹${fee.toFixed(2)}).`, 'success');
          checkFirstTrade();
          refreshProfile();
        }
      }
    });
  });
}

async function checkFirstTrade() {
  const profile = await getUserProfile(currentUser.uid);
  if (profile && !profile.firstTradeCompleted && profile.tradesCompleted >= 1) {
    triggerFirstTradeEasterEgg();
    showToast('🎉 First Trade!', 'Congratulations! Your first trade was powered by Vortex!', 'success', 6000);
    await updateDoc(doc(db, 'users', currentUser.uid), { firstTradeCompleted: true });
  }
}

async function refreshProfile() {
  userProfile = await getUserProfile(currentUser.uid);
  if (userProfile) {
    document.getElementById('statWallet').textContent = '₹' + (userProfile.walletBalance || 0).toFixed(2);
    document.getElementById('statEnergy').textContent = (userProfile.energyBalance || 0).toFixed(1) + ' kWh';
    document.getElementById('statTrades').textContent = userProfile.tradesCompleted || 0;
    document.getElementById('userEnergy').textContent = (userProfile.energyBalance || 0).toFixed(1) + ' kWh';
    highlightUserHouse(userProfile);
  }
}

// ---- Sync Active Bids to Realtime DB (for Energy Map Heat) ----
async function syncActiveBidsToRTDB() {
  try {
    const allBids = await getDocs(query(collection(db, 'bids'), where('status', '==', 'open')));
    const zoneCounts = {};

    allBids.forEach(d => {
      const bid = d.data();
      const zone = bid.zone || '?';
      if (!zoneCounts[zone]) zoneCounts[zone] = { sellers: 0, buyers: 0, totalSellKwh: 0, totalBuyKwh: 0, avgSellPrice: 0, avgBuyPrice: 0, sellPrices: [], buyPrices: [] };

      if (bid.type === 'sell') {
        zoneCounts[zone].sellers++;
        zoneCounts[zone].totalSellKwh += bid.kwhAmount || 0;
        zoneCounts[zone].sellPrices.push(bid.pricePerUnit || 0);
      } else {
        zoneCounts[zone].buyers++;
        zoneCounts[zone].totalBuyKwh += bid.kwhAmount || 0;
        zoneCounts[zone].buyPrices.push(bid.pricePerUnit || 0);
      }
    });

    // Calculate averages
    for (const zone of Object.keys(zoneCounts)) {
      const z = zoneCounts[zone];
      z.avgSellPrice = z.sellPrices.length > 0 ? z.sellPrices.reduce((a, b) => a + b, 0) / z.sellPrices.length : 0;
      z.avgBuyPrice = z.buyPrices.length > 0 ? z.buyPrices.reduce((a, b) => a + b, 0) / z.buyPrices.length : 0;
      delete z.sellPrices;
      delete z.buyPrices;
    }

    await rtSet(ref(rtdb, 'activeBids'), zoneCounts);
  } catch (err) {
    console.warn('RTDB sync error:', err);
  }
}

// ---- Energy Flow Map (Interactive with Real Data) ----
function initEnergyMap() {
  // Listen to active bids per zone from RTDB
  const bidsRef = ref(rtdb, 'activeBids');
  onValue(bidsRef, (snap) => {
    const data = snap.val() || {};
    // Dynamically add SVG houses for any zone NOT already in the map
    addDynamicZoneHouses(data);
    updateMapHeat(data);
    createZoneTooltips(data);
  });
  
  // Also load zones from Firestore to ensure all admin-added zones appear
  loadDynamicMapZones();

  if (userProfile) {
    highlightUserHouse(userProfile);
  }

  // --- Real-time Energy Flow Animation & Past Connections ---
  // Listen for trades to draw continuous lines and animate new flows.
  const recentTradesQ = query(collection(db, 'trades'), limit(100));
  
  // Track initial load to avoid animating all 100 historical trades on refresh
  let isMapInitialLoad = true;
  
  onSnapshot(recentTradesQ, (snap) => {
    const trades = [];
    snap.forEach(d => trades.push(d.data()));
    
    // Safely sort locally (in case timestamp is a string or serverTimestamp hasn't resolved toMillis)
    trades.sort((a, b) => {
      const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return tb - ta;
    });
    
    // Draw static dashed lines for historical connections
    drawPastConnections(trades);
    
    // Animate new beams
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        if (!isMapInitialLoad) {
          const trade = change.doc.data();
          if (trade.sellerZone && trade.buyerZone && trade.sellerZone !== trade.buyerZone) {
            setTimeout(() => {
              drawTradeConnection(trade.sellerZone, trade.buyerZone);
            }, Math.random() * 1000);
          }
        }
      }
    });
    
    isMapInitialLoad = false;
  });
  
  // Check if we just redirected from marketplace with a specific trade
  const urlParams = new URLSearchParams(window.location.search);
  const tradeId = urlParams.get('trade');
  if (tradeId) {
    // We just completed a trade, animate it immediately
    setTimeout(async () => {
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      
      try {
        // We know the target bid ID, let's look up the trade
        // We might not have the trade ID itself yet (since engine makes it), 
        // so we just animate a generic flow from user's zone for now if role is buyer, etc.
        showToast('Energy Transfer Initiated', 'Routing power through the nearest micro-grid...', 'info', 4000);
        
        // Find the most recent trade for this user
        const q = query(collection(db, 'trades'), limit(5));
        const snap = await getDocs(q);
        let found = false;
        
        // Sort locally
        const trades = [];
        snap.forEach(d => trades.push(d.data()));
        trades.sort((a,b) => b.timestamp?.toMillis() - a.timestamp?.toMillis());
        
        for (const t of trades) {
          if (t.sellerId === currentUser.uid || t.buyerId === currentUser.uid) {
             drawTradeConnection(t.sellerZone, t.buyerZone);
             found = true;
             break;
          }
        }
        
        // Fallback generic animation if trade hasn't settled yet
        if (!found) {
           const zones = ['A','B','C','D','E'];
           const randomZone = zones[Math.floor(Math.random() * zones.length)];
           if (userProfile.role === 'prosumer') {
              drawTradeConnection(userProfile.zone, randomZone !== userProfile.zone ? randomZone : 'A');
           } else {
              drawTradeConnection(randomZone !== userProfile.zone ? randomZone : 'C', userProfile.zone);
           }
        }
      } catch(e) {}
    }, 1000);
  }

  // Add click handlers for zone houses
  document.querySelectorAll('.map-house').forEach(house => {
    house.addEventListener('click', () => {
      const id = house.id;
      const zone = id.split('-')[1];
      if (zone) {
        showToast('Zone ' + zone, `Filtered bid book to Zone ${zone}`, 'info', 2000);
      }
    });
  });
}

async function loadDynamicMapZones() {
  try {
    const zonesSnap = await getDocs(collection(db, 'zones'));
    const existingZones = new Set();
    document.querySelectorAll('.map-house').forEach(h => {
      const parts = h.id.split('-');
      if (parts[1]) existingZones.add(parts[1]);
    });

    zonesSnap.forEach(d => {
      const zone = d.data();
      const code = zone.code || d.id;
      if (!existingZones.has(code)) {
        addZoneToSVG(code);
        existingZones.add(code);
      }
    });
  } catch (err) {
    console.warn('Could not load zones for map:', err);
  }
}

function addDynamicZoneHouses(data) {
  const existingZones = new Set();
  document.querySelectorAll('.map-house').forEach(h => {
    const parts = h.id.split('-');
    if (parts[1]) existingZones.add(parts[1]);
  });

  Object.keys(data).forEach(zone => {
    if (!existingZones.has(zone)) {
      addZoneToSVG(zone);
      existingZones.add(zone);
    }
  });
}

let dynamicZoneIndex = 0;
function addZoneToSVG(zoneCode) {
  const svg = document.querySelector('#energyMap svg');
  if (!svg) return;

  // Place new zones after existing ones, wrapping as needed
  const basePositions = [
    { labelX: 140, sellX: 80, sellY: 40, buyX: 150, buyY: 190 },
    { labelX: 300, sellX: 250, sellY: 90, buyX: 310, buyY: 190 },
    { labelX: 460, sellX: 420, sellY: 40, buyX: 420, buyY: 200 },
    { labelX: 620, sellX: 600, sellY: 100, buyX: 600, buyY: 200 },
    { labelX: 780, sellX: 760, sellY: 40, buyX: 690, buyY: 190 },
  ];
  
  // For zones beyond E, extend the SVG and add positions
  const posIdx = dynamicZoneIndex % 5;
  const row = Math.floor(dynamicZoneIndex / 5);
  const pos = basePositions[posIdx];
  const offsetY = row > 0 ? 320 * row : 0;
  dynamicZoneIndex++;

  // Expand SVG viewBox if needed
  if (offsetY > 0) {
    const currentVB = svg.getAttribute('viewBox').split(' ').map(Number);
    const newHeight = Math.max(currentVB[3], 300 + offsetY);
    svg.setAttribute('viewBox', `0 0 900 ${newHeight}`);
  }

  const ns = 'http://www.w3.org/2000/svg';

  // Zone label
  const label = document.createElementNS(ns, 'text');
  label.setAttribute('x', pos.labelX); label.setAttribute('y', 28 + offsetY);
  label.setAttribute('fill', 'rgba(255,255,255,0.5)');
  label.setAttribute('font-size', '11'); label.setAttribute('font-family', 'Inter');
  label.setAttribute('font-weight', '600'); label.setAttribute('text-anchor', 'middle');
  label.textContent = 'Zone ' + zoneCode;
  svg.appendChild(label);

  // Sell house
  const sellG = document.createElementNS(ns, 'g');
  sellG.classList.add('map-house');
  sellG.id = `mapHouse-${zoneCode}-sell`;
  sellG.setAttribute('transform', `translate(${pos.sellX},${pos.sellY + offsetY})`);
  sellG.style.cursor = 'pointer';
  sellG.innerHTML = `<polygon points="25,0 50,20 0,20" fill="#00FF87" opacity="0.35"/><rect x="5" y="20" width="40" height="30" rx="2" fill="#00FF87" opacity="0.2"/><text x="25" y="40" fill="#00FF87" font-size="8" font-family="Inter" font-weight="700" text-anchor="middle">SELL</text>`;
  svg.appendChild(sellG);

  // Buy house
  const buyG = document.createElementNS(ns, 'g');
  buyG.classList.add('map-house');
  buyG.id = `mapHouse-${zoneCode}-buy`;
  buyG.setAttribute('transform', `translate(${pos.buyX},${pos.buyY + offsetY})`);
  buyG.style.cursor = 'pointer';
  buyG.innerHTML = `<polygon points="25,0 50,20 0,20" fill="#FFB020" opacity="0.35"/><rect x="5" y="20" width="40" height="30" rx="2" fill="#FFB020" opacity="0.2"/><text x="25" y="40" fill="#FFB020" font-size="8" font-family="Inter" font-weight="700" text-anchor="middle">BUY</text>`;
  svg.appendChild(buyG);

  // Click handler
  [sellG, buyG].forEach(g => {
    g.addEventListener('click', () => {
      showToast('Zone ' + zoneCode, `Filtered bid book to Zone ${zoneCode}`, 'info', 2000);
    });
  });
}

function createZoneTooltips(data) {
  // Inject tooltip div if not already present
  let tooltip = document.getElementById('mapTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'mapTooltip';
    tooltip.style.cssText = `
      position:fixed;z-index:9998;
      background:rgba(13,19,35,0.95);border:1px solid rgba(0,255,135,0.3);
      border-radius:8px;padding:0.6rem 0.875rem;
      font-size:0.75rem;color:rgba(255,255,255,0.85);
      pointer-events:none;display:none;
      backdrop-filter:blur(8px);
      white-space:pre-line;line-height:1.6;
      box-shadow:0 8px 24px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(tooltip);
  }

  document.querySelectorAll('.map-house').forEach(house => {
    const id = house.id;
    const parts = id.split('-');
    const zone = parts[1];
    const zoneData = data[zone] || { sellers: 0, buyers: 0, totalSellKwh: 0, totalBuyKwh: 0, avgSellPrice: 0, avgBuyPrice: 0 };
    
    const tooltipText = [
      `⚡ Zone ${zone}`,
      `Sellers: ${zoneData.sellers}  |  Buyers: ${zoneData.buyers}`,
      `Supply: ${(zoneData.totalSellKwh || 0).toFixed(1)} kWh  |  Demand: ${(zoneData.totalBuyKwh || 0).toFixed(1)} kWh`,
      `Avg Sell: ₹${(zoneData.avgSellPrice || 0).toFixed(2)}  |  Avg Buy: ₹${(zoneData.avgBuyPrice || 0).toFixed(2)}`
    ].join('\n');
    
    house.addEventListener('mouseenter', (e) => {
      tooltip.textContent = tooltipText;
      tooltip.style.display = 'block';
    });
    house.addEventListener('mousemove', (e) => {
      tooltip.style.left = (e.clientX + 16) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
    });
    house.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}


function highlightUserHouse(profile) {
  // Reset any previous highlights
  document.querySelectorAll('.map-house-you').forEach(el => el.remove());
  document.querySelectorAll('.map-house').forEach(g => {
    const rect = g.querySelector('rect');
    const poly = g.querySelector('polygon');
    if (rect) rect.style.stroke = '';
    if (poly) poly.style.stroke = '';
    g.style.filter = '';
  });

  const roleKey = profile.role === 'prosumer' ? 'sell' : 'buy';
  const houseId = `mapHouse-${profile.zone}-${roleKey}`;
  const userHouse = document.getElementById(houseId);
  
  if (userHouse) {
    const rect = userHouse.querySelector('rect');
    const poly = userHouse.querySelector('polygon');
    if (rect) { rect.style.stroke = '#FFFFFF'; rect.style.strokeWidth = '2'; }
    if (poly) { poly.style.stroke = '#FFFFFF'; poly.style.strokeWidth = '2'; }
    userHouse.style.filter = 'url(#glow)';
    
    const badgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    badgeGroup.classList.add('map-house-you');
    
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '13'); bgRect.setAttribute('y', '-10');
    bgRect.setAttribute('width', '24'); bgRect.setAttribute('height', '12');
    bgRect.setAttribute('rx', '2'); bgRect.setAttribute('fill', '#FFFFFF');
    
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '25'); text.setAttribute('y', '-1');
    text.setAttribute('fill', '#0A0F1E'); text.setAttribute('font-size', '7');
    text.setAttribute('font-family', 'Inter'); text.setAttribute('font-weight', '700');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = 'YOU';

    const pointer = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    pointer.setAttribute('points', '21,2 25,6 29,2');
    pointer.setAttribute('fill', '#FFFFFF');

    badgeGroup.style.animation = 'pulseGlow 2s infinite ease-in-out';
    if (!document.getElementById('mapHouseYouPulse')) {
      const style = document.createElement('style');
      style.id = 'mapHouseYouPulse';
      style.textContent = `@keyframes pulseGlow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }`;
      document.head.appendChild(style);
    }
    
    badgeGroup.appendChild(bgRect);
    badgeGroup.appendChild(pointer);
    badgeGroup.appendChild(text);
    userHouse.appendChild(badgeGroup);
  }
}

function updateMapHeat(bidsData) {
  // Color-code zones based on supply/demand ratio
  Object.keys(bidsData).forEach(zone => {
    const zoneData = bidsData[zone] || {};
    const sellers = zoneData.sellers || 0;
    const buyers = zoneData.buyers || 0;
    
    // Update sell house opacity based on supply
    const sellHouse = document.getElementById(`mapHouse-${zone}-sell`);
    if (sellHouse) {
      const rect = sellHouse.querySelector('rect');
      if (rect && sellers > 0) {
        rect.style.fillOpacity = Math.min(0.3 + sellers * 0.1, 0.8);
      }
    }
    
    // Update buy house opacity based on demand
    const buyHouse = document.getElementById(`mapHouse-${zone}-buy`);
    if (buyHouse) {
      const rect = buyHouse.querySelector('rect');
      if (rect && buyers > 0) {
        rect.style.fillOpacity = Math.min(0.3 + buyers * 0.1, 0.8);
      }
    }
  });
}

// ---- Map Continuous Connections (Canvas Overlay) ----
let pastConnectionPairs = [];
let connectionAnimFrame = null;

function drawPastConnections(trades) {
  // Extract unique zone pairs from trades
  const connectedPairs = new Set();
  trades.forEach(t => {
    if (t.sellerZone && t.buyerZone && t.sellerZone !== t.buyerZone) {
      const pair = [t.sellerZone, t.buyerZone].sort().join('-');
      connectedPairs.add(pair);
    }
  });
  
  if (connectedPairs.size === 0) return;
  
  // Store pairs for animation use
  pastConnectionPairs = Array.from(connectedPairs);
  
  // Set up canvas overlay on top of the energyMap SVG
  const mapContainer = document.getElementById('energyMap');
  if (!mapContainer) return;
  
  let canvas = document.getElementById('energyMapCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'energyMapCanvas';
    canvas.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 10;
    `;
    // Make the container relative so canvas positions correctly
    mapContainer.style.position = 'relative';
    mapContainer.appendChild(canvas);
  }
  
  // Resize canvas to match container
  const rect = mapContainer.getBoundingClientRect();
  canvas.width = rect.width || 900;
  canvas.height = rect.height || 300;
  
  // Helper to get position of a house as a fraction of the SVG viewBox
  // then map to canvas pixel coordinates
  function getHousePos(zone, type) {
    const svg = mapContainer.querySelector('svg');
    const house = document.getElementById(`mapHouse-${zone}-${type}`);
    if (!svg || !house) return null;
    
    const transform = house.getAttribute('transform') || '';
    const match = transform.match(/translate\(([\d.]+),\s*([\d.]+)\)/);
    if (!match) return null;
    
    const svgX = parseFloat(match[1]) + 25; // center of 50px wide house
    const svgY = parseFloat(match[2]) + 25;
    
    // SVG viewBox is 900x300, map to canvas pixels
    const vb = svg.viewBox.baseVal;
    const canvasX = (svgX / (vb.width || 900)) * canvas.width;
    const canvasY = (svgY / (vb.height || 300)) * canvas.height;
    
    return { x: canvasX, y: canvasY };
  }
  
  // Cancel previous animation loop
  if (connectionAnimFrame) cancelAnimationFrame(connectionAnimFrame);
  
  let dotOffset = 0;
  
  function renderConnections() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    dotOffset = (dotOffset + 0.3) % 20;
    
    pastConnectionPairs.forEach(pair => {
      const [zone1, zone2] = pair.split('-');
      const p1 = getHousePos(zone1, 'sell');
      const p2 = getHousePos(zone2, 'buy');
      if (!p1 || !p2) return;
      
      // Draw the base dashed line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -dotOffset;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      
      // Draw glowing dots along the line
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const t = ((dotOffset / 20) + i / steps) % 1;
        const px = p1.x + (p2.x - p1.x) * t;
        const py = p1.y + (p2.y - p1.y) * t;
        
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#00E5FF';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#00E5FF';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      
      // Draw small filled circles at the endpoints
      [p1, p2].forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.5)';
        ctx.fill();
      });
    });
    
    ctx.setLineDash([]);
    connectionAnimFrame = requestAnimationFrame(renderConnections);
  }
  
  renderConnections();
}

// ---- Map Trade Animation (Dramatic energy beam) ----
function drawTradeConnection(sellerZone, buyerZone) {
  setTimeout(() => {
    const mapSvg = document.querySelector('#energyMap svg');
    if (!mapSvg) return;

    // Compute coords dynamically from SVG elements
    function getHouseCenter(zone, type) {
      const house = document.getElementById(`mapHouse-${zone}-${type}`);
      if (!house) return { x: 450, y: 150 };
      const transform = house.getAttribute('transform') || '';
      const match = transform.match(/translate\(([\d.]+),\s*([\d.]+)\)/);
      if (match) return { x: parseFloat(match[1]) + 25, y: parseFloat(match[2]) + 25 };
      return { x: 450, y: 150 };
    }

    const seller = getHouseCenter(sellerZone, 'sell');
    const buyer = getHouseCenter(buyerZone, 'buy');

    // --- Inject keyframes if not yet present ---
    if (!document.getElementById('energyBeamKeyframes')) {
      const style = document.createElement('style');
      style.id = 'energyBeamKeyframes';
      style.textContent = `
        @keyframes beamPulse { 0%,100% { stroke-opacity: 0.7; stroke-width: 3; } 50% { stroke-opacity: 1; stroke-width: 5; } }
        @keyframes beamGlow { 0%,100% { filter: url(#glow) drop-shadow(0 0 6px #00FF87); } 50% { filter: url(#glow) drop-shadow(0 0 16px #00FF87); } }
        @keyframes particleTravel { 0% { offset-distance: 0%; opacity: 1; } 85% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
        @keyframes beamFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes beamFadeOut { from { opacity: 1; } to { opacity: 0; } }
      `;
      document.head.appendChild(style);
    }

    // Create beam group
    const beamGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    beamGroup.classList.add('energy-beam');
    beamGroup.style.animation = 'beamFadeIn 0.3s ease forwards';

    // --- Glow beam (wide, blurred) ---
    const glowLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    glowLine.setAttribute('x1', seller.x); glowLine.setAttribute('y1', seller.y);
    glowLine.setAttribute('x2', buyer.x); glowLine.setAttribute('y2', buyer.y);
    glowLine.setAttribute('stroke', '#00FF87');
    glowLine.setAttribute('stroke-width', '8');
    glowLine.setAttribute('stroke-linecap', 'round');
    glowLine.style.opacity = '0.15';
    glowLine.style.filter = 'blur(4px)';
    beamGroup.appendChild(glowLine);

    // --- Main beam line ---
    const mainLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    mainLine.setAttribute('x1', seller.x); mainLine.setAttribute('y1', seller.y);
    mainLine.setAttribute('x2', buyer.x); mainLine.setAttribute('y2', buyer.y);
    mainLine.setAttribute('stroke', '#00FF87');
    mainLine.setAttribute('stroke-width', '3');
    mainLine.setAttribute('stroke-linecap', 'round');
    mainLine.setAttribute('filter', 'url(#glow)');
    mainLine.style.strokeDasharray = '8 4';
    mainLine.style.animation = 'beamPulse 1s ease-in-out infinite';
    beamGroup.appendChild(mainLine);

    // --- Animate dash offset ---
    const dashAnim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    dashAnim.setAttribute('attributeName', 'stroke-dashoffset');
    dashAnim.setAttribute('from', '24');
    dashAnim.setAttribute('to', '0');
    dashAnim.setAttribute('dur', '0.6s');
    dashAnim.setAttribute('repeatCount', 'indefinite');
    mainLine.appendChild(dashAnim);

    // --- Traveling particle (a glowing circle that moves from seller to buyer) ---
    const particle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    particle.setAttribute('r', '5');
    particle.setAttribute('fill', '#00FF87');
    particle.setAttribute('filter', 'url(#glow)');
    particle.style.opacity = '0';
    beamGroup.appendChild(particle);

    // Animate particle manually via JS
    let particleT = 0;
    function animateParticle() {
      particleT += 0.012;
      if (particleT > 1) particleT = 0;
      const px = seller.x + (buyer.x - seller.x) * particleT;
      const py = seller.y + (buyer.y - seller.y) * particleT;
      particle.setAttribute('cx', px);
      particle.setAttribute('cy', py);
      particle.style.opacity = particleT < 0.9 ? '1' : String(1 - (particleT - 0.9) * 10);
      particle.setAttribute('r', String(3 + Math.sin(particleT * Math.PI) * 3));
      if (beamGroup.parentNode) requestAnimationFrame(animateParticle);
    }

    // --- Endpoint flashes ---
    [seller, buyer].forEach(pt => {
      const flash = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      flash.setAttribute('cx', pt.x); flash.setAttribute('cy', pt.y);
      flash.setAttribute('r', '8'); flash.setAttribute('fill', '#00FF87');
      flash.setAttribute('filter', 'url(#glow)');
      flash.style.opacity = '0.6';
      beamGroup.appendChild(flash);
      // Pulsing
      const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      anim.setAttribute('attributeName', 'r');
      anim.setAttribute('values', '4;10;4');
      anim.setAttribute('dur', '1.5s');
      anim.setAttribute('repeatCount', 'indefinite');
      flash.appendChild(anim);
      const animOp = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      animOp.setAttribute('attributeName', 'opacity');
      animOp.setAttribute('values', '0.6;0.2;0.6');
      animOp.setAttribute('dur', '1.5s');
      animOp.setAttribute('repeatCount', 'indefinite');
      flash.appendChild(animOp);
    });

    // Insert beam into SVG
    mapSvg.appendChild(beamGroup);
    requestAnimationFrame(animateParticle);

    // Auto-remove after 5 seconds with fade out
    setTimeout(() => {
      beamGroup.style.animation = 'beamFadeOut 0.5s ease forwards';
      setTimeout(() => beamGroup.remove(), 500);
    }, 5000);
  }, 800); // Slight delay after page load for visual impact
}

// ---- Solar Energy Generation Display ----
function showSolarGeneration() {
  if (userProfile.role !== 'prosumer') return;

  const solarWidget = document.getElementById('solarGenWidget');
  if (!solarWidget) return;

  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  
  let solarFactor = 0;
  if (hour >= 6 && hour <= 18) {
    solarFactor = Math.sin(Math.PI * (hour - 6) / 12);
    solarFactor = Math.max(0, solarFactor);
  }

  const capacity = userProfile.solarCapacity || 0;
  const currentRate = (capacity / (30 * 12)) * solarFactor; // kWh per 5 min
  const hourlyRate = currentRate * 12; // kWh per hour

  solarWidget.style.display = 'block';
  solarWidget.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;">
      <div style="font-size:2rem;">☀️</div>
      <div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Solar Generation</div>
        <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:700;color:var(--accent-green);">
          ${hourlyRate.toFixed(2)} <span style="font-size:0.85rem;color:var(--text-muted);">kWh/hr</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">
          Efficiency: ${(solarFactor * 100).toFixed(0)}% • Capacity: ${capacity} kWh/mo
        </div>
      </div>
      <div style="margin-left:auto;">
        <div style="width:60px;height:60px;border-radius:50%;background:conic-gradient(var(--accent-green) ${solarFactor * 360}deg, var(--bg-input) 0deg);display:flex;align-items:center;justify-content:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:var(--accent-green);">${(solarFactor * 100).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  `;
}

// ---- Logout ----
window.handleLogout = logout;

// ---- Bid Type Toggle ----
window.toggleBidType = function(type) {
  document.querySelectorAll('.bid-type-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`bidType${type}`).classList.add('active');
};
