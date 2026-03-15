// ============================================
// VORTEX — Wallet Logic
// Balance, transactions, add credits, withdraw, export CSV/PDF
// ============================================

import {
  auth, db,
  requireAuth, getUserProfile, logout,
  collection, query, where, orderBy, limit, onSnapshot, addDoc, getDocs,
  doc, getDoc, updateDoc, serverTimestamp, increment
} from './config.js';
import { renderCompactLogo, injectFavicon } from './logo.js';
import {
  showToast, animateCount, formatCurrency, formatDateTime,
  setPageTitle, setActiveSidebarLink, initSidebar
} from './utils.js';
import { initNotifications } from './notifications.js';

let currentUser = null;
let userProfile = null;
let currentPage = 1;
const PAGE_SIZE = 10;
let allTransactions = [];

requireAuth(async (user) => {
  currentUser = user;
  userProfile = await getUserProfile(user.uid);
  if (!userProfile) { userProfile = { name: currentUser.displayName || 'User', email: currentUser.email, zone: 'A', role: 'consumer', walletBalance: 500, energyBalance: 0, tradesCompleted: 0 }; }

  renderCompactLogo(document.getElementById('sidebarLogo'));
  injectFavicon();
  setPageTitle('Wallet');
  setActiveSidebarLink();
  initSidebar(userProfile.role);

  document.getElementById('userZone').textContent = 'Zone ' + userProfile.zone;
  document.getElementById('userRole').textContent = userProfile.role === 'prosumer' ? '☀ Prosumer' : '🏠 Consumer';
  document.getElementById('userRole').className = 'sidebar-user-role ' + (userProfile.role === 'prosumer' ? 'role-prosumer' : 'role-consumer');
  document.getElementById('userName').textContent = userProfile.name;

  initNotifications(currentUser.uid);
  loadWallet();
  loadTransactionHistory();
  checkLowBalance();
});

function loadWallet() {
  animateCount(document.getElementById('walletBalance'), userProfile.walletBalance || 0, 1500, '₹', '', 2);

  onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      document.getElementById('walletBalance').textContent = '₹' + (data.walletBalance || 0).toFixed(2);
      userProfile.walletBalance = data.walletBalance;
      checkLowBalance();
    }
  });
}

function loadTransactionHistory() {
  const txQ = query(collection(db, 'walletTransactions'), where('userId', '==', currentUser.uid), orderBy('timestamp', 'desc'));

  onSnapshot(txQ, (snap) => {
    allTransactions = [];
    let totalEarned = 0;
    let totalSpent = 0;

    snap.forEach(d => {
      const tx = { id: d.id, ...d.data() };
      allTransactions.push(tx);

      if (tx.type === 'trade_credit' || tx.type === 'signup_bonus' || tx.type === 'manual_topup') {
        totalEarned += tx.amount || 0;
      }
      if (tx.type === 'trade_debit' || tx.type === 'withdrawal') {
        totalSpent += Math.abs(tx.amount || 0);
      }
    });

    document.getElementById('totalEarned').textContent = formatCurrency(totalEarned);
    document.getElementById('totalSpent').textContent = formatCurrency(totalSpent);
    document.getElementById('netBalance').textContent = formatCurrency(totalEarned - totalSpent);

    renderTransactionPage();
  });
}

function renderTransactionPage() {
  const tbody = document.getElementById('txTableBody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = allTransactions.slice(start, start + PAGE_SIZE);

  if (pageItems.length === 0 && allTransactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem;">No transactions yet</td></tr>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = '';
  pageItems.forEach(tx => {
    const isCredit = tx.amount > 0;
    const typeLabels = {
      'trade_credit': 'Trade Credit',
      'trade_debit': 'Trade Debit',
      'signup_bonus': 'Signup Bonus',
      'manual_topup': 'Manual Top-up',
      'withdrawal': 'Withdrawal',
      'platform_fee': 'Platform Fee'
    };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--text-muted);font-size:0.8rem;">${formatDateTime(tx.timestamp)}</td>
      <td><span class="badge ${isCredit ? 'badge-green' : 'badge-amber'}">${typeLabels[tx.type] || tx.type}</span></td>
      <td style="color:${isCredit ? 'var(--accent-green)' : 'var(--accent-amber)'};font-weight:600;">
        ${isCredit ? '+' : '-'}${formatCurrency(Math.abs(tx.amount))}
      </td>
      <td style="color:var(--text-muted);font-size:0.8rem;">${tx.label || '—'}</td>
      <td style="color:var(--text-muted);font-size:0.8rem;">${tx.counterpartyZone ? 'Zone ' + tx.counterpartyZone : '—'}</td>
    `;
    tbody.appendChild(tr);
  });

  // Pagination
  const totalPages = Math.ceil(allTransactions.length / PAGE_SIZE);
  const pag = document.getElementById('pagination');
  pag.innerHTML = '';
  if (totalPages > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => { currentPage--; renderTransactionPage(); };
    pag.appendChild(prevBtn);

    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.className = i === currentPage ? 'active' : '';
      btn.onclick = () => { currentPage = i; renderTransactionPage(); };
      pag.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => { currentPage++; renderTransactionPage(); };
    pag.appendChild(nextBtn);
  }
}

function checkLowBalance() {
  const banner = document.getElementById('lowBalanceBanner');
  if ((userProfile.walletBalance || 0) < 50) {
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// ---- Add Credits Modal ----
window.openAddCredits = function() {
  document.getElementById('creditsModal').classList.add('active');
  document.querySelectorAll('.credit-option').forEach(o => o.classList.remove('selected'));
  document.getElementById('customAmount').value = '';
};

window.closeCreditsModal = function() {
  document.getElementById('creditsModal').classList.remove('active');
};

window.selectCreditAmount = function(amount) {
  document.querySelectorAll('.credit-option').forEach(o => o.classList.remove('selected'));
  event.target.classList.add('selected');
  document.getElementById('customAmount').value = amount;
};

window.confirmAddCredits = async function() {
  const amount = parseFloat(document.getElementById('customAmount').value);
  if (!amount || amount <= 0) {
    showToast('Invalid Amount', 'Please enter a valid amount.', 'warning');
    return;
  }

  const btn = document.getElementById('confirmCreditsBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      walletBalance: increment(amount)
    });

    await addDoc(collection(db, 'walletTransactions'), {
      userId: currentUser.uid,
      type: 'manual_topup',
      amount: amount,
      label: 'Manual Top-up',
      timestamp: serverTimestamp()
    });

    showToast('Credits Added!', `${formatCurrency(amount)} has been added to your wallet.`, 'success');
    closeCreditsModal();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Confirm Top-up';
};

// ---- Withdraw Modal ----
window.openWithdraw = function() {
  document.getElementById('withdrawModal').classList.add('active');
  document.getElementById('withdrawAmount').value = '';
  document.getElementById('withdrawMax').textContent = formatCurrency(userProfile.walletBalance || 0);
};

window.closeWithdrawModal = function() {
  document.getElementById('withdrawModal').classList.remove('active');
};

window.confirmWithdraw = async function() {
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  if (!amount || amount <= 0) {
    showToast('Invalid Amount', 'Please enter a valid amount.', 'warning');
    return;
  }
  if (amount > (userProfile.walletBalance || 0)) {
    showToast('Insufficient Balance', 'You cannot withdraw more than your current balance.', 'error');
    return;
  }

  const btn = document.getElementById('confirmWithdrawBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      walletBalance: increment(-amount)
    });

    await addDoc(collection(db, 'walletTransactions'), {
      userId: currentUser.uid,
      type: 'withdrawal',
      amount: -amount,
      label: 'Withdrawal to bank (pending)',
      timestamp: serverTimestamp()
    });

    showToast('Withdrawal Initiated!', `${formatCurrency(amount)} withdrawal has been processed.`, 'success');
    closeWithdrawModal();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Confirm Withdrawal';
};

// ---- Export CSV ----
window.exportCSV = function() {
  if (allTransactions.length === 0) {
    showToast('No Data', 'No transactions to export.', 'warning');
    return;
  }

  const headers = ['Date', 'Type', 'Amount', 'Label', 'Counterparty Zone'];
  const rows = allTransactions.map(tx => [
    formatDateTime(tx.timestamp),
    tx.type || '',
    tx.amount || 0,
    (tx.label || '').replace(/,/g, ';'),
    tx.counterpartyZone ? 'Zone ' + tx.counterpartyZone : ''
  ]);

  let csv = headers.join(',') + '\n';
  rows.forEach(r => { csv += r.join(',') + '\n'; });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vortex_transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported!', 'CSV file downloaded successfully.', 'success');
};

// ---- Export PDF ----
window.exportPDF = async function() {
  if (allTransactions.length === 0) {
    showToast('No Data', 'No transactions to export.', 'warning');
    return;
  }

  // Dynamically load jsPDF
  if (!window.jspdf) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    document.head.appendChild(script);
    await new Promise(r => script.onload = r);
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  
  // Header
  // Use sans-serif (helvetica) for cleaner look
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(0, 150, 80);
  pdf.text('VORTEX — Transaction Report', 14, 20);
  
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(80, 80, 80);
  pdf.text(`User: ${userProfile.name} | Zone: ${userProfile.zone} | Date: ${new Date().toLocaleDateString()}`, 14, 28);
  
  // Explicitly reset font for wallet balance to avoid it inheriting title properties
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(50, 50, 50);
  pdf.text(`Wallet Balance: ${formatCurrency(userProfile.walletBalance || 0)}`, 14, 34);

  // Table header
  let y = 46;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(100, 100, 100);
  
  // Adjusted column spacing to prevent overlap
  const colDate = 14;
  const colType = 55;
  const colAmount = 95;
  const colLabel = 125;

  pdf.text('Date', colDate, y);
  pdf.text('Type', colType, y);
  pdf.text('Amount', colAmount, y);
  pdf.text('Label', colLabel, y);
  
  y += 4;
  pdf.setLineWidth(0.2);
  pdf.setDrawColor(200, 200, 200);
  pdf.line(14, y, 196, y);
  y += 8;

  // Rows
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(40, 40, 40);
  
  allTransactions.slice(0, 50).forEach(tx => {
    if (y > 275) {
      pdf.addPage();
      y = 20;
    }
    
    // Format date properly
    const dateStr = formatDateTime(tx.timestamp).substring(0, 16).replace(',', '');
    
    // Add + sign for positive amounts and color code
    const isPos = tx.amount >= 0;
    const amtText = (isPos ? '+' : '') + (tx.amount || 0).toFixed(2);
    
    pdf.setTextColor(60, 60, 60);
    pdf.text(dateStr, colDate, y);
    pdf.text(tx.type || '', colType, y);
    
    // Color amounts
    if (isPos) {
      pdf.setTextColor(0, 150, 80); // Green
    } else {
      pdf.setTextColor(200, 50, 50); // Red
    }
    pdf.text(amtText, colAmount, y);
    
    // Reset to grey for label
    pdf.setTextColor(60, 60, 60);
    
    // Truncate label to fit page
    let label = tx.label || '';
    if (label.length > 45) label = label.substring(0, 42) + '...';
    pdf.text(label, colLabel, y);
    
    y += 8; // Increased line height to prevent vertical overlap
  });

  // Footer
  pdf.setFontSize(7);
  pdf.setTextColor(150);
  pdf.text('Generated by Vortex P2P Energy Trading Platform', 14, 290);

  pdf.save(`vortex_transactions_${new Date().toISOString().slice(0, 10)}.pdf`);
  showToast('Exported!', 'PDF file downloaded successfully.', 'success');
};

window.handleLogout = logout;
