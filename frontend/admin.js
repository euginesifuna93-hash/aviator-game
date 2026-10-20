// frontend/admin.js
const API_BASE = '/api/auth';
let currentUser = null;
let gameInterval = null;
let finInterval = null;
let revenueChart = null;
let profitChart = null;
let currentTab = 'financials'; // Track current tab


// Debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}


// --- AUTH & INIT ---
async function apiCall(endpoint, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(endpoint, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

async function checkAdminAuth() {
  try {
    console.log('Checking admin auth...');
    const data = await apiCall(`${API_BASE}/me`);
    
    if (!data.user.isAdmin) {
      console.log('User is not admin');
      Swal.fire({ 
        title: 'Access Denied', 
        text: 'You must be an admin to access this page',
        icon: 'error', 
        confirmButtonColor: '#e50051' 
      }).then(() => window.location.href = '/');
      return;
    }
    
    currentUser = data.user;
    document.getElementById('admin-email').textContent = currentUser.email;
    console.log('Admin authenticated:', currentUser.email);
    
    // Load data immediately
    await loadFinancials();
    await loadLiveGame();
    
    // Set up auto-refresh
    // Set up auto-refresh (Bulletproof version)
    if (gameInterval) clearInterval(gameInterval);
    if (finInterval) clearInterval(finInterval);
    
    // We remove the "if" checks so it always polls in the background
    gameInterval = setInterval(() => {
      loadLiveGame(); 
    }, 2000); // Updates every 2 seconds
    
    finInterval = setInterval(() => {
      loadFinancials(); 
    }, 5000); // Updates every 5 seconds
  } catch (e) {
    console.error('Auth error:', e);
    Swal.fire({ 
      title: 'Session Expired', 
      text: 'Please log in again',
      icon: 'warning', 
      confirmButtonText: 'Go to Login',
      confirmButtonColor: '#e50051' 
    }).then(() => {
      window.location.href = '/';
    });
  }
}

// --- TABS ---
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    
    // Make sure your HTML buttons have data-tab="live-game", data-tab="financials", etc.
    currentTab = btn.dataset.tab; 
    
    document.getElementById(`tab-${currentTab}`).classList.add('active');
    
    // ... rest of your code ...
    // Load data based on tab
    if (currentTab === 'financials') loadFinancials();
    if (currentTab === 'live-game') loadLiveGame();
    if (currentTab === 'withdrawals') loadWithdrawals();
    if (currentTab === 'users') loadUsers();
    if (currentTab === 'transactions') loadTransactions();
    if (currentTab === 'recommendations') loadRecommendations();
    if (currentTab === 'game-settings') loadGameSettings(); // ✅ Add this line
  };
});

// ==========================================
// 1. LIVE GAME MONITOR LOGIC
// ==========================================
async function loadLiveGame() {
  try {
    const [gameRes, roundsRes] = await Promise.all([
      fetch('/api/admin/game-state', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/admin/rounds', { credentials: 'include' }).then(r => r.json())
    ]);

    if (gameRes.ok && gameRes.data) {
      const s = gameRes.data;
      document.getElementById('lg-round').textContent = s.roundId || '—';
      document.getElementById('lg-phase').textContent = s.phase ? s.phase.toUpperCase() : '—';
      document.getElementById('lg-crash').textContent = s.crashPoint ? `${s.crashPoint.toFixed(2)}x` : '—';
      
      let timeText = '—';
      if (s.phase === 'betting' && s.timeRemaining !== null) timeText = `${(s.timeRemaining / 1000).toFixed(1)}s left`;
      else if (s.phase === 'flying' && s.flightProgress !== null) timeText = `${s.flightProgress.toFixed(0)}% flown`;
      document.getElementById('lg-time').textContent = timeText;
    }

    if (roundsRes.ok && roundsRes.rounds) {
      const grid = document.getElementById('rounds-grid');
      grid.innerHTML = roundsRes.rounds.slice(0, 20).map(r => {
        const cp = Number(r.crash_point);
        let color = '#3b82f6';
        if (cp >= 10) color = '#ec4899';
        else if (cp >= 2) color = '#a855f7';
        return `<div class="round-pill" style="background: ${color}20; color: ${color}; border: 1px solid ${color}">${cp.toFixed(2)}x</div>`;
      }).join('');
    }
  } catch (e) { console.error('Game monitor error:', e); }
}

document.getElementById('btn-refresh-game').onclick = () => {
  loadLiveGame();
  Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Game data refreshed', showConfirmButton: false, timer: 1500 });
};

// ==========================================
// 2. FINANCIAL DASHBOARD LOGIC
// ==========================================
async function loadFinancials() {
  try {
    const res = await fetch('/api/admin/dashboard', { credentials: 'include' });
    const data = await res.json();
    if (!data.ok) {
      console.error('Dashboard data not ok:', data);
      return;
    }
    
    const s = data.data.stats;
    document.getElementById('fin-money-in').textContent = (s.moneyIn / 100).toFixed(2);
    document.getElementById('fin-money-out').textContent = (s.moneyOut / 100).toFixed(2);
    
    const profitEl = document.getElementById('fin-profit');
    profitEl.textContent = (s.houseProfit / 100).toFixed(2);
    profitEl.style.color = s.houseProfit >= 0 ? '#00a86b' : '#e50051';
    
    document.getElementById('fin-pending').textContent = (s.pendingWithdrawals / 100).toFixed(2);
    document.getElementById('fin-bets').textContent = s.totalBets.toLocaleString();
    document.getElementById('fin-users').textContent = s.totalUsers.toLocaleString();
    document.getElementById('fin-active').textContent = s.activeUsers.toLocaleString();
    document.getElementById('fin-liability').textContent = (s.userLiability / 100).toFixed(2);
    
    // Update badge
    const pendingCount = data.data.pendingWithdrawals.length;
    const badge = document.getElementById('pending-badge');
    badge.textContent = pendingCount;
    badge.style.display = pendingCount > 0 ? 'inline' : 'none';
    
    renderActivity(data.data.recentActivity);
    renderRevenueChart(data.data.revenueData);
    renderProfitChart(s);
  } catch (e) { console.error('Financials error:', e); }
}

function renderActivity(activities) {
  const list = document.getElementById('activity-list');
  if (!activities || activities.length === 0) { 
    list.innerHTML = '<div class="loading">No activity yet</div>'; 
    return; 
  }
  list.innerHTML = activities.slice(0, 15).map(a => {
    const isPos = a.amount_cents > 0;
    const amount = (Math.abs(a.amount_cents) / 100).toFixed(2);
    let kindLabel = a.kind;
    if (a.kind === 'deposit') kindLabel = '💰 Deposit';
    else if (a.kind === 'withdrawal') kindLabel = '🏦 Withdrawal';
    else if (a.kind === 'stake') kindLabel = '🎲 Bet';
    else if (a.kind === 'cashout') kindLabel = '🏆 Cashout';
    
    return `<div class="activity-item ${a.kind}">
      <div class="activity-info">
        <div class="activity-user">${a.email?.split('@')[0] || 'Unknown'}</div>
        <div class="activity-detail">${kindLabel} • ${new Date(a.created_at).toLocaleTimeString()}</div>
      </div>
      <div class="activity-amount ${isPos ? 'positive' : 'negative'}">${isPos ? '+' : '-'}${amount} KES</div>
    </div>`;
  }).join('');
}

function renderRevenueChart(data) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;
  if (revenueChart) revenueChart.destroy();
  
  if (!data || data.length === 0) {
    ctx.parentElement.innerHTML = '<div class="loading">No revenue data yet</div>';
    return;
  }
  
  const labels = data.map(d => new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }));
  revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Deposits', data: data.map(d => (d.deposits / 100).toFixed(2)), borderColor: '#00a86b', backgroundColor: 'rgba(0,168,107,0.1)', tension: 0.4, fill: true },
        { label: 'Withdrawals', data: data.map(d => (d.withdrawals / 100).toFixed(2)), borderColor: '#e50051', backgroundColor: 'rgba(229,0,81,0.1)', tension: 0.4, fill: true }
      ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#aaa' } } }, scales: { x: { ticks: { color: '#666' }, grid: { color: '#2a2a3e' } }, y: { ticks: { color: '#666' }, grid: { color: '#2a2a3e' } } } }
  });
}

function renderProfitChart(stats) {
  const ctx = document.getElementById('profitChart');
  if (!ctx) return;
  if (profitChart) profitChart.destroy();
  
  const profit = Math.max(0, stats.houseProfit / 100);
  const cashedOut = stats.totalCashedOut / 100;
  
  if (profit === 0 && cashedOut === 0) {
    ctx.parentElement.innerHTML = '<div class="loading">No profit data yet</div>';
    return;
  }
  
  profitChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['House Profit', 'Player Winnings'], datasets: [{ data: [profit, cashedOut], backgroundColor: ['#00a86b', '#a855f7'], borderWidth: 0 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#aaa' } } } }
  });
}

document.getElementById('btn-refresh-fin').onclick = () => {
  loadFinancials();
  Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Financial data refreshed', showConfirmButton: false, timer: 1500 });
};

// ==========================================
// 3. WITHDRAWALS, USERS, TRANSACTIONS, RECS
// ==========================================
async function loadWithdrawals() {
  try {
    const res = await fetch('/api/admin/dashboard', { credentials: 'include' });
    const data = await res.json();
    if (!data.ok) return;
    const tbody = document.getElementById('withdrawals-body');
    const withdrawals = data.data.pendingWithdrawals;
    if (!withdrawals || withdrawals.length === 0) { 
      tbody.innerHTML = '<tr><td colspan="7" class="loading">✅ No pending withdrawals</td></tr>'; 
      return; 
    }
    tbody.innerHTML = withdrawals.map(w => {
      const amount = (Math.abs(w.amount_cents) / 100).toFixed(2);
      const meta = typeof w.meta === 'string' ? JSON.parse(w.meta) : (w.meta || {});
      return `<tr><td>#${w.id}</td><td>${w.email}</td><td style="color:#f59e0b;font-weight:700">${amount} KES</td><td><code>${meta.account || 'N/A'}</code></td><td>${w.provider_tx_id || 'N/A'}</td><td>${new Date(w.created_at).toLocaleString()}</td><td><button class="btn-action btn-approve" onclick="approveWd(${w.id})">✓ Approve</button><button class="btn-action btn-reject" onclick="rejectWd(${w.id})">✗ Reject</button></td></tr>`;
    }).join('');
  } catch (e) { console.error('Withdrawals error:', e); }
}

window.approveWd = async (id) => {
  const res = await Swal.fire({ title: 'Approve?', text: 'Ensure M-Pesa is sent!', icon: 'warning', showCancelButton: true, confirmButtonColor: '#00a86b' });
  if (!res.isConfirmed) return;
  await fetch(`/api/admin/withdrawals/${id}/approve`, { method: 'POST', credentials: 'include' });
  Swal.fire('Approved!', '', 'success'); 
  loadWithdrawals(); 
  loadFinancials();
};

window.rejectWd = async (id) => {
  const res = await Swal.fire({ title: 'Reject & Refund?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#e50051' });
  if (!res.isConfirmed) return;
  await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST', credentials: 'include' });
  Swal.fire('Rejected & Refunded', '', 'success'); 
  loadWithdrawals(); 
  loadFinancials();
};




// ==========================================
// USER MANAGEMENT - FIXED VERSION
// ==========================================

async function loadUsers() {
  try {
    console.log('Loading users...');
    const res = await fetch('/api/admin/users', { credentials: 'include' });
    const data = await res.json();
    
    if (!data.ok) {
      console.error('Failed to load users:', data);
      return;
    }
    
    const search = document.getElementById('user-search')?.value.toLowerCase() || '';
    let users = data.users;
    
    if (search) {
      users = users.filter(u => u.email.toLowerCase().includes(search));
    }
    
    const tbody = document.getElementById('users-body');
    if (!tbody) {
      console.error('users-body element not found');
      return;
    }
    
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">No users found</td></tr>';
      return;
    }
    
    tbody.innerHTML = users.map(u => {
      const bal = (u.balance_cents / 100).toFixed(2);
      let status = '<span class="status completed">Active</span>';
      if (u.is_banned) status = '<span class="status failed">Banned</span>';
      else if (u.is_admin) status = '<span class="status pending">Admin</span>';
      
      const isBannedBool = Boolean(u.is_banned);
      const actions = !u.is_admin 
        ? `<button class="btn-action ${isBannedBool ? 'btn-unban' : 'btn-ban'}" data-userid="${u.id}" data-isbanned="${isBannedBool}">${isBannedBool ? 'Unban' : 'Ban'}</button>
           <button class="btn-action btn-adjust" data-userid="${u.id}" data-email="${u.email}">Adjust</button>`
        : '<em style="color:#666;">Protected</em>';
      return `<tr>
        <td>#${u.id}</td>
        <td>${u.email}</td>
        <td>${bal} KES</td>
        <td>${status}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
    
    // Attach event listeners to the new buttons
    attachUserButtonListeners();
    
  } catch (e) {
    console.error('Users error:', e);
  }
}
function attachUserButtonListeners() {
  // Ban/Unban buttons
  document.querySelectorAll('[data-userid][data-isbanned]').forEach(btn => {
    btn.onclick = async function() {
      const userId = this.getAttribute('data-userid');
      const isBannedAttr = this.getAttribute('data-isbanned');
      
      // ✅ FIX: Handle both 'true'/'false' and '1'/'0'
      const isBanned = isBannedAttr === 'true' || isBannedAttr === '1';
      
      console.log(`Button clicked: userId=${userId}, isBannedAttr=${isBannedAttr}, isBanned=${isBanned}`);
      
      await handleBanToggle(userId, isBanned);
    };
  });
  
  // Adjust buttons
  document.querySelectorAll('.btn-adjust[data-userid]').forEach(btn => {
    btn.onclick = async function() {
      const userId = this.getAttribute('data-userid');
      const email = this.getAttribute('data-email');
      await handleAdjustBalance(userId, email);
    };
  });
}
async function handleBanToggle(userId, isBanned) {
  const action = isBanned ? 'unban' : 'ban';
  const actionText = isBanned ? 'Unban' : 'Ban';
  
  console.log(`Attempting to ${action} user ${userId}`);
  
  try {
    const res = await Swal.fire({ 
      title: `${actionText} User?`, 
      text: `Are you sure you want to ${action} this user?`,
      icon: 'warning', 
      showCancelButton: true, 
      confirmButtonText: `Yes, ${actionText}`,
      cancelButtonText: 'Cancel',
      confirmButtonColor: isBanned ? '#3b82f6' : '#f59e0b' 
    });
    
    if (!res.isConfirmed) {
      console.log('Ban/unban cancelled');
      return;
    }
    
    console.log(`Calling /api/admin/users/${userId}/${action}...`);
    
    const response = await fetch(`/api/admin/users/${userId}/${action}`, { 
      method: 'POST', 
      credentials: 'include' 
    });
    
    const data = await response.json();
    console.log('Ban/unban response:', data);
    
    if (data.ok) {
      Swal.fire({
        icon: 'success',
        title: 'Success!',
        text: `User ${action}ned successfully`,
        timer: 1500,
        showConfirmButton: false
      });
      
      // Reload users to update the UI
      await loadUsers();
    } else {
      Swal.fire('Error', data.error || 'Failed to update user', 'error');
    }
  } catch (e) {
    console.error('Ban/unban error:', e);
    Swal.fire('Error', e.message, 'error');
  }
}


async function handleAdjustBalance(userId, email) {
  console.log('=== ADJUST BALANCE STARTED ===');
  console.log('User ID:', userId);
  console.log('Email:', email);
  
  try {
    const { value: form } = await Swal.fire({ 
      title: `Adjust Balance: ${email}`, 
      html: `
        <input id="swal-amt" class="swal2-input" placeholder="Amount (e.g., 500 or -200)" type="number" step="0.01">
        <input id="swal-reason" class="swal2-input" placeholder="Reason (e.g., Bonus, Refund)">
      `, 
      confirmButtonText: 'Apply Adjustment', 
      cancelButtonText: 'Cancel',
      showCancelButton: true,
      confirmButtonColor: '#a855f7',
      preConfirm: () => {
        const amountStr = document.getElementById('swal-amt').value;
        const reason = document.getElementById('swal-reason').value;
        const amount = parseFloat(amountStr);
        
        if (isNaN(amount) || amount === 0) {
          Swal.showValidationMessage('Please enter a valid non-zero amount');
          return false;
        }
        if (!reason || reason.trim() === '') {
          Swal.showValidationMessage('Please enter a reason for the adjustment');
          return false;
        }
        
        return { amount, reason };
      }
    });
    
    if (!form) {
      console.log('Adjustment cancelled by user');
      return;
    }
    
    console.log('Form data to send:', form);
    
    const response = await fetch(`/api/admin/users/${userId}/adjust-balance`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      credentials: 'include', 
      body: JSON.stringify(form) 
    });
    
    console.log('Response status:', response.status);
    const data = await response.json();
    console.log('Response data:', data);
    
    if (data.ok) {
      Swal.fire({
        icon: 'success',
        title: 'Balance Adjusted!',
        text: `${form.amount > 0 ? '+' : ''}${form.amount} KES ${form.amount > 0 ? 'added' : 'deducted'}`,
        timer: 2000,
        showConfirmButton: false
      });
      // Reload data to show new balance
      loadUsers();
      loadFinancials();
    } else {
      Swal.fire('Error', data.error || 'Failed to adjust balance', 'error');
    }
  } catch (e) {
    console.error('CRITICAL Adjustment error:', e);
    Swal.fire('Error', e.message || 'An unexpected error occurred', 'error');
  }
}

// Make sure search input listener is attached
document.getElementById('user-search')?.addEventListener('input', debounce(loadUsers, 300));


async function loadTransactions() {
  try {
    const kind = document.getElementById('filter-kind').value;
    const status = document.getElementById('filter-status').value;
    const email = document.getElementById('filter-email').value;
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (email) params.set('email', email);
    
    const res = await fetch(`/api/admin/transactions?${params}`, { credentials: 'include' });
    const data = await res.json();
    if (!data.ok) return;
    const tbody = document.getElementById('transactions-body');
    if (!data.transactions || data.transactions.length === 0) { 
      tbody.innerHTML = '<tr><td colspan="7" class="loading">No transactions</td></tr>'; 
      return; 
    }
    tbody.innerHTML = data.transactions.map(t => {
      const isPos = t.amount_cents > 0;
      const amt = (Math.abs(t.amount_cents) / 100).toFixed(2);
      let kindLabel = t.kind;
      if (t.kind === 'deposit') kindLabel = '💰 Deposit';
      else if (t.kind === 'withdrawal') kindLabel = '🏦 Withdrawal';
      else if (t.kind === 'stake') kindLabel = '🎲 Bet';
      else if (t.kind === 'cashout') kindLabel = '🏆 Cashout';
      return `<tr><td>#${t.id}</td><td>${t.email?.split('@')[0]}</td><td>${kindLabel}</td><td style="color:${isPos ? '#00a86b' : '#e50051'}">${isPos ? '+' : '-'}${amt}</td><td>${(t.balance_after_cents/100).toFixed(2)}</td><td><span class="status ${t.status}">${t.status}</span></td><td>${new Date(t.created_at).toLocaleString()}</td></tr>`;
    }).join('');
  } catch (e) { console.error('Transactions error:', e); }
}

['filter-kind', 'filter-status', 'filter-email'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', loadTransactions);
    if (id === 'filter-email') el.addEventListener('input', loadTransactions);
  }
});

async function loadRecommendations() {
  try {
    const res = await fetch('/api/admin/recommendations', { credentials: 'include' });
    const data = await res.json();
    if (!data.ok) return;
    const list = document.getElementById('recommendations-list');
    const icons = { success: '✅', warning: '⚠️', danger: '🚨', info: 'ℹ️' };
    list.innerHTML = data.recommendations.map(r => `<div class="recommendation-card ${r.type}"><div class="recommendation-title">${icons[r.type] || '💡'} ${r.title} <span class="priority-${r.priority}" style="margin-left:auto">${r.priority}</span></div><div class="recommendation-message">${r.message}</div></div>`).join('');
  } catch (e) { console.error('Recommendations error:', e); }
}

// Load game settings
// Load game settings (CRASH-PROOF VERSION)
async function loadGameSettings() {
  try {
    console.log('Loading game settings...');
    const res = await fetch('/api/admin/game-settings', { credentials: 'include' });
    const data = await res.json();
    console.log('Game settings response:', data);
    
    if (!data.ok) {
      console.error('Failed to load settings:', data);
      return;
    }
    
    const s = data.settings;
    if (!s) {
      console.error('No settings data returned from backend');
      return;
    }
    
    console.log('Settings loaded:', s);
    
    // Safely set values ONLY if the HTML elements exist
    const houseEdgeEl = document.getElementById('setting-house-edge');
    if (houseEdgeEl) houseEdgeEl.value = (s.house_edge * 100).toFixed(2);
    
    const maxCrashEl = document.getElementById('setting-max-crash');
    if (maxCrashEl) maxCrashEl.value = s.max_crash;
    
    const minBetEl = document.getElementById('setting-min-bet');
    if (minBetEl) minBetEl.value = s.min_bet / 100;
    
    const maxBetEl = document.getElementById('setting-max-bet');
    if (maxBetEl) maxBetEl.value = s.max_bet / 100;
    
    const bettingTimeEl = document.getElementById('setting-betting-time');
    if (bettingTimeEl) bettingTimeEl.value = s.betting_time / 1000;
    
  } catch (e) { 
    console.error('Game settings error:', e); 
  }
}

// Refresh button
document.getElementById('btn-refresh-settings')?.addEventListener('click', () => {
  loadGameSettings();
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: 'Settings refreshed',
    showConfirmButton: false,
    timer: 1500
  });
});

// Start
checkAdminAuth();