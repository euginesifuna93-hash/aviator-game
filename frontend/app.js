// frontend/app.js
const API_BASE = '/api/auth';

// Initialize socket to connect to the current domain automatically
let socket = io({
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});

let currentUser = null;

const gameState = {
  phase: 'waiting',
  roundId: null,
  lastTickTime: 0,
  lastMultiplier: 1.00,
  crashPoint: null,
  crashTime: 0,
  bettingEndsAt: 0,
};

const bets = {
  1: { placed: false, id: null, stakeCents: 0, status: null },
  2: { placed: false, id: null, stakeCents: 0, status: null },
};

const canvas = document.getElementById('game-canvas');
const ctx = canvas?.getContext('2d');
const multEl = document.getElementById('multiplier');
const statusEl = document.getElementById('status');
const historyBar = document.getElementById('history-bar');
const liveBetsList = document.getElementById('live-bets-list');

const AVATARS = ['🎮', '🚀', '✈️', '🎲', '', '🎰', '👾', '🤖', '👽', '🦊'];

// --- TOAST HELPER ---
function showToast(icon, title, timer = 3000) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title,
      showConfirmButton: false,
      timer,
      timerProgressBar: true,
      customClass: { popup: 'aviator-toast' },
    });
  } else {
    alert(title);
  }
}

// --- AUTH ---
async function apiCall(endpoint, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(endpoint, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

// frontend/app.js
async function checkAuth() {
  try {
    console.log('Checking game auth...');
    const data = await apiCall(`${API_BASE}/me`);
    currentUser = data.user;
    
    console.log('User authenticated:', currentUser.email, 'isAdmin:', currentUser.isAdmin);
    
    // ✅ NEW: Check if admin is using "preview mode" via URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const viewAsPlayer = urlParams.get('view') === 'game';
    
    // If admin AND not in preview mode, redirect to dashboard
    if (currentUser.isAdmin && !viewAsPlayer) {
      console.log('Admin detected (no preview mode), redirecting to dashboard...');
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top',
          icon: 'success',
          title: 'Admin detected! Opening Dashboard...',
          showConfirmButton: false,
          timer: 1500
        });
        setTimeout(() => {
          window.location.href = '/admin.html';
        }, 1500);
      } else {
        window.location.href = '/admin.html';
      }
      return;
    }

    // Normal user flow OR admin in preview mode
    console.log('Loading game (user or admin preview mode)...');
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    updateBalanceDisplay();
    initSocket();
    loadHistory();
    loadLiveBets();
    
    // Show admin banner if in preview mode
    if (currentUser.isAdmin && viewAsPlayer) {
      showAdminPreviewBanner();
    } else {
      showToast('success', `Welcome back, ${currentUser.email.split('@')[0]}! 👋`);
    }
    
  } catch (e) {
    console.error('Auth check failed:', e);
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';
  }
}

// Add this new function to show an admin preview banner
function showAdminPreviewBanner() {
  // Create a banner that shows at the top of the game
  const banner = document.createElement('div');
  banner.id = 'admin-preview-banner';
  banner.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; right: 0; background: #e50051; color: white; padding: 12px 20px; z-index: 9999; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">
      <div>
        <strong> ADMIN PREVIEW MODE</strong>
        <span style="margin-left: 10px; opacity: 0.9;">You are viewing the game as a player</span>
      </div>
      <div style="display: flex; gap: 10px;">
        <a href="/admin.html" style="background: white; color: #e50051; padding: 6px 14px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px;">
          📊 Back to Admin
        </a>
      </div>
    </div>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
  
  // Add padding to body so content isn't hidden behind banner
  document.body.style.paddingTop = '50px';
}


function updateBalanceDisplay() {
  if (!currentUser) return;
  const bal = (currentUser.balanceCents / 100).toFixed(2);
  const balEl = document.getElementById('user-balance');
  const infoEl = document.getElementById('user-info');
  if (balEl) balEl.textContent = bal;
  if (infoEl) infoEl.textContent = `${currentUser.email} | $${bal}`;
}

document.getElementById('btn-login')?.addEventListener('click', async () => {
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await apiCall(`${API_BASE}/login`, 'POST', { email, password });
    currentUser = data.user;
    checkAuth();
  } catch (e) { document.getElementById('auth-msg').textContent = e.message; }
});

document.getElementById('btn-register')?.addEventListener('click', async () => {
  try {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const data = await apiCall(`${API_BASE}/register`, 'POST', { email, password });
    currentUser = data.user;
    checkAuth();
  } catch (e) { document.getElementById('auth-msg').textContent = e.message; }
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: 'Logout?',
      text: 'Are you sure?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, Logout',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#e50051',
      customClass: { popup: 'aviator-swal' },
    });
    if (!result.isConfirmed) return;
  }
  await apiCall(`${API_BASE}/logout`, 'POST');
  currentUser = null;
  if (socket) socket.disconnect();
  checkAuth();
});

// --- SOCKET ---
function initSocket() {
  if (socket) socket.disconnect();

  const socketUrl = window.location.origin;
  console.log('=== INITIALIZING SOCKET ===');
  console.log('Socket URL:', socketUrl);

  socket = io(socketUrl, {
    withCredentials: true,
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
    forceNew: true,
  });

  socket.on('connect', () => {
    console.log('✅ SOCKET CONNECTED! ID:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('❌ SOCKET CONNECTION ERROR:', err.message);
  });

  socket.on('snapshot', (s) => {
    console.log('📸 SNAPSHOT RECEIVED:', s);
    console.log('  Phase:', s.phase);
    console.log('  Round:', s.roundId);
    console.log('  Betting ends:', s.bettingEndsAt);

    if (gameState.roundId !== s.roundId) {
      bets[1] = { placed: false, id: null, stakeCents: 0, status: null };
      bets[2] = { placed: false, id: null, stakeCents: 0, status: null };
    }

    gameState.phase = s.phase;
    gameState.roundId = s.roundId;
    gameState.bettingEndsAt = s.bettingEndsAt || 0;
    gameState.takeoffAt = s.takeoffAt || 0;
    updateUI();
  });

  socket.on('tick', (t) => {
    console.log('📈 TICK:', t.multiplier);
    gameState.lastTickTime = performance.now();
    gameState.lastMultiplier = t.multiplier;
    multEl?.classList.remove('crashed');
    updateUI();
  });

  socket.on('crashed', (c) => {
    console.log('💥 CRASHED:', c.crashPoint);
    gameState.phase = 'crashed';
    gameState.crashPoint = c.crashPoint;
    gameState.crashTime = Date.now();
    gameState.lastMultiplier = c.crashPoint;
    if (multEl) {
      multEl.textContent = `${c.crashPoint.toFixed(2)}x`;
      multEl.classList.add('crashed');
    }
    if (statusEl) statusEl.textContent = 'FLEW AWAY!';
    addHistoryPill(c.crashPoint);
    updateUI();
  });

  socket.on('wallet', (w) => {
    console.log('💰 WALLET UPDATE:', w.balanceCents);
    currentUser.balanceCents = w.balanceCents;
    updateBalanceDisplay();
  });

  socket.on('live_bet_update', loadLiveBets);
}


// --- BETTING ---
function handleBetAction(panelNum) {
  const bet = bets[panelNum];
  const stakeInput = document.getElementById(`stake-${panelNum}`);
  const stake = parseFloat(stakeInput?.value) || 10;

  console.log('=== BET BUTTON CLICKED ===');
  console.log('Panel:', panelNum);
  console.log('Current phase:', gameState.phase);
  console.log('Bet already placed:', bet.placed);
  console.log('Bet status:', bet.status);
  console.log('Stake:', stake, 'KES');
  console.log('Socket connected:', socket?.connected);
  console.log('User balance:', currentUser?.balanceCents);

  // 1. CANCEL during betting phase
  if (gameState.phase === 'betting' && bet.placed && bet.status === 'pending') {
    console.log('→ Action: CANCEL bet');
    
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Cancel Bet?',
        html: `Refund <strong>${stake.toFixed(2)} KES</strong>?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Cancel',
        cancelButtonText: 'Keep Bet',
        confirmButtonColor: '#ef4444',
        customClass: { popup: 'aviator-swal' },
      }).then((result) => {
        if (result.isConfirmed) doCancel(panelNum, stake);
      });
    } else {
      if (confirm(`Cancel bet of ${stake.toFixed(2)} KES?`)) doCancel(panelNum, stake);
    }
    return;
  }

  // 2. PLACE BET during betting phase
  if (gameState.phase === 'betting' && !bet.placed) {
    console.log('→ Action: PLACE bet');
    
    if (stake < 1) { 
      showToast('warning', 'Minimum bet is 1.00 KES'); 
      return; 
    }
    
    if (!currentUser || currentUser.balanceCents < stake * 100) {
      showToast('error', `Insufficient balance! Need ${stake.toFixed(2)} KES`);
      return;
    }

    if (!socket || !socket.connected) {
      showToast('error', 'Not connected to server. Please refresh.');
      return;
    }

    const stakeCents = Math.round(stake * 100);
    console.log('Emitting bet:place with stakeCents:', stakeCents, 'Panel:', panelNum);
    
    // ✅ ADD panel: panelNum HERE
    socket.emit('bet:place', { stakeCents, panel: panelNum }, (res) => {
      console.log('Bet response received:', res);
      if (res && res.ok) {
        bet.placed = true;
        bet.id = res.bet.id;
        bet.stakeCents = res.bet.stakeCents;
        bet.status = 'pending';
        updateUI();
        showToast('success', `🎯 Bet placed! ${stake.toFixed(2)} KES on Panel ${panelNum}`);
      } else {
        const errorMsg = res?.error || 'Bet failed';
        showToast('error', errorMsg);
      }
    });
    return;
  }

  // 3. CASH OUT during flying phase
  if (gameState.phase === 'flying' && bet.placed && bet.status === 'pending') {
    console.log('→ Action: CASH OUT');
    const currentMult = getCurrentMultiplier();
    const potentialWin = (bet.stakeCents * currentMult / 100).toFixed(2);

    socket.emit('bet:cashout', { roundId: gameState.roundId, betId: bet.id }, (res) => {
      console.log('Cashout response:', res);
      if (res && res.ok) {
        bet.status = 'cashed_out';
        bet.cashoutMult = res.multiplier;
        bet.payoutCents = res.payoutCents;
        updateUI();
        showToast('success', `💸 Cashed out at ${res.multiplier.toFixed(2)}x • Won ${potentialWin} KES`);
      } else {
        showToast('error', res?.error || 'Cashout failed');
      }
    });
    return;
  }

  // 4. Nothing matched - show why
  console.log('⚠️ No action taken. Conditions not met:');
  if (gameState.phase !== 'betting' && gameState.phase !== 'flying') {
    showToast('warning', `Game is ${gameState.phase}. Wait for next round.`);
  } else if (bet.placed && bet.status !== 'pending') {
    showToast('info', `Bet already ${bet.status}.`);
  } else {
    showToast('warning', 'Cannot place bet right now.');
  }
}


function doCancel(panelNum, stake) {
  console.log('Canceling bet for panel', panelNum);
  // Send the specific betId so the backend knows which panel to cancel
  socket.emit('bet:cancel', { roundId: gameState.roundId, betId: bets[panelNum].id }, (res) => {
    console.log('Cancel response:', res);
    if (res && res.ok) {
      bets[panelNum].placed = false;
      bets[panelNum].id = null;
      bets[panelNum].status = null;
      bets[panelNum].stakeCents = 0;
      updateUI();
      showToast('success', `Bet cancelled • ${stake.toFixed(2)} KES refunded`);
    } else {
      showToast('error', res?.error || 'Cancel failed');
    }
  });
}

// Wire up the buttons
const btn1 = document.getElementById('btn-action-1');
const btn2 = document.getElementById('btn-action-2');

if (btn1) {
  btn1.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Button 1 clicked');
    handleBetAction(1);
  });
} else {
  console.error('❌ btn-action-1 not found in DOM!');
}

if (btn2) {
  btn2.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Button 2 clicked');
    handleBetAction(2);
  });
} else {
  console.error('❌ btn-action-2 not found in DOM!');
}

// Stake +/- buttons
document.querySelectorAll('.stake-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    const input = document.getElementById(`stake-${panel}`);
    if (!input) return;
    const val = parseFloat(input.value) || 10;
    input.value = (btn.classList.contains('plus') ? val + 1 : Math.max(1, val - 1)).toFixed(2);
  });
});

// Preset buttons
document.querySelectorAll('.preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    const input = document.getElementById(`stake-${panel}`);
    if (input) input.value = parseFloat(btn.dataset.value).toFixed(2);
  });
});


function getCurrentMultiplier() {
  if (gameState.phase !== 'flying') return gameState.lastMultiplier;
  const dt = (performance.now() - gameState.lastTickTime) / 1000;
  return gameState.lastMultiplier * Math.exp(dt / 15);
}

function updateUI() {
  const now = Date.now();
  for (let i = 1; i <= 2; i++) {
    const bet = bets[i];
    const btn = document.getElementById(`btn-action-${i}`);
    if (!btn) continue;
    const label = btn.querySelector('.cashout-label');
    const amountEl = document.getElementById(`cashout-amount-${i}`);
    const stake = parseFloat(document.getElementById(`stake-${i}`)?.value) || 10;

    if (gameState.phase === 'betting') {
      const timeLeft = Math.max(0, Math.ceil((gameState.bettingEndsAt - now) / 1000));
      if (bet.placed && bet.status === 'pending') {
        label.textContent = `Cancel (${timeLeft}s)`;
        btn.disabled = false;
        btn.className = 'cashout-btn cancel-mode';
        amountEl.textContent = `${stake.toFixed(2)} KES`;
      } else {
        label.textContent = `Bet (${timeLeft}s)`;
        btn.disabled = timeLeft <= 0;
        btn.className = timeLeft <= 0 ? 'cashout-btn' : 'cashout-btn bet-mode';
        amountEl.textContent = `${stake.toFixed(2)} KES`;
      }
    } else if (gameState.phase === 'flying') {
      if (bet.placed && bet.status === 'pending') {
        const currentMult = getCurrentMultiplier();
        const payout = (bet.stakeCents * currentMult / 100).toFixed(2);
        label.textContent = 'Cash Out';
        btn.disabled = false;
        btn.className = 'cashout-btn cashout-mode';
        amountEl.textContent = `${payout} KES`;
      } else if (bet.placed && bet.status === 'cashed_out') {
        label.textContent = 'Cashed Out ✓';
        btn.disabled = true;
        btn.className = 'cashout-btn';
        amountEl.textContent = `${(bet.payoutCents / 100).toFixed(2)} KES`;
      } else {
        label.textContent = 'Wait';
        btn.disabled = true;
        btn.className = 'cashout-btn';
        amountEl.textContent = `${stake.toFixed(2)} KES`;
      }
    } else {
      if (bet.placed && bet.status === 'pending') {
        label.textContent = 'Lost';
        btn.disabled = true;
        btn.className = 'cashout-btn';
        amountEl.textContent = `-${stake.toFixed(2)} KES`;
      } else if (bet.placed && bet.status === 'cashed_out') {
        label.textContent = 'Cashed Out ✓';
        btn.disabled = true;
        btn.className = 'cashout-btn';
        amountEl.textContent = `+${(bet.payoutCents / 100).toFixed(2)} KES`;
      } else {
        label.textContent = 'Wait';
        btn.disabled = true;
        btn.className = 'cashout-btn';
        amountEl.textContent = `${stake.toFixed(2)} KES`;
      }
    }
  }
}

// --- HISTORY ---
async function loadHistory() {
  try {
    const res = await fetch('/api/rounds/history');
    const data = await res.json();
    if (data.ok && historyBar) {
      historyBar.innerHTML = '';
      data.history.forEach(m => addHistoryPill(m, true));
    }
  } catch (e) { console.error(e); }
}

function addHistoryPill(mult, prepend = false) {
  const pill = document.createElement('div');
  let colorClass = 'blue';
  if (mult >= 10) colorClass = 'pink';
  else if (mult >= 2) colorClass = 'purple';
  pill.className = `history-pill ${colorClass}`;
  pill.textContent = `${mult.toFixed(2)}x`;
  if (prepend) historyBar.prepend(pill);
  else historyBar.appendChild(pill);
  if (historyBar.children.length > 30) historyBar.lastChild.remove();
}

// --- LIVE BETS ---
function maskUsername(id) {
  if (!id || id.length < 6) return id || 'Unknown';
  return id.substring(0, 2) + '***' + id.substring(id.length - 2);
}

async function loadLiveBets() {
  try {
    const res = await fetch('/api/rounds/live-bets');
    const data = await res.json();
    if (data.ok) renderLiveBets(data.bets);
  } catch (e) { console.error(e); }
}

function renderLiveBets(betsList) {
  const countEl = document.getElementById('live-count');
  const totalEl = document.getElementById('total-win');
  const playersEl = document.getElementById('players-count-num');

  if (countEl) countEl.textContent = betsList.length;
  if (playersEl) playersEl.textContent = betsList.length;

  const totalWin = betsList.reduce((sum, b) => sum + (b.payoutCents || 0), 0);
  if (totalEl) totalEl.textContent = (totalWin / 100).toFixed(2);

  if (!liveBetsList) return;
  liveBetsList.innerHTML = '';

  betsList.sort((a, b) => b.stakeCents - a.stakeCents).slice(0, 20).forEach((bet, index) => {
    const row = document.createElement('div');
    row.className = 'row';
    const profit = bet.status === 'cashed_out' ? (bet.payoutCents - bet.stakeCents) / 100 : null;
    const avatar = AVATARS[index % AVATARS.length];

    row.innerHTML = `
      <div class="user-cell">
        <div class="user-avatar">${avatar}</div>
        <span>${maskUsername(bet.userId)}</span>
      </div>
      <span>${(bet.stakeCents / 100).toFixed(2)}</span>
      <span class="${bet.status === 'cashed_out' ? 'win' : 'pending'}">
        ${bet.status === 'cashed_out' ? `${bet.cashoutMultiplier.toFixed(2)}x` : '...'}
      </span>
      <span class="${profit > 0 ? 'win' : ''}">
        ${profit !== null ? profit.toFixed(2) : '-'}
      </span>
    `;
    liveBetsList.appendChild(row);
  });
}

// --- PROFILE MODAL ---
const profileModal = document.getElementById('profile-modal');
const btnProfile = document.getElementById('btn-profile');
const modalClose = document.getElementById('modal-close');

if (btnProfile && profileModal && modalClose) {
  btnProfile.addEventListener('click', async () => {
    console.log('=== OPENING PROFILE MODAL ===');
    profileModal.style.display = 'flex';
    await loadProfileData();
    await loadTransactions();
  });

  modalClose.addEventListener('click', () => { profileModal.style.display = 'none'; });
  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.style.display = 'none';
  });

  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-content').forEach(c => {
        c.classList.add('hidden-tab');
        c.classList.remove('active-tab');
      });
      tab.classList.add('active');
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) {
        target.classList.remove('hidden-tab');
        target.classList.add('active-tab');
      }
      if (tab.dataset.tab === 'history') loadTransactions();
    });
  });
}

async function loadProfileData() {
  console.log('=== LOADING PROFILE DATA ===');
  try {
    const res = await fetch('/api/profile/me', { credentials: 'include' });
    const data = await res.json();
    
    console.log('Profile response:', data);
    
    if (!data.ok) {
      console.error('Profile fetch failed:', data.error);
      return;
    }
    
    const balEl = document.getElementById('profile-balance');
    const emailEl = document.getElementById('profile-email');
    const emailInput = document.getElementById('profile-email-input');
    
    if (balEl) {
      const balance = (data.user.balanceCents / 100).toFixed(2);
      balEl.textContent = `${balance} KES`;
      console.log('Balance set to:', balance);
    }
    
    if (emailEl) {
      emailEl.textContent = data.user.email;
      console.log('Email set to:', data.user.email);
    }
    
    if (emailInput) {
      emailInput.value = data.user.email;
      console.log('Email input set to:', data.user.email);
    }
  } catch (e) {
    console.error('Profile load error:', e);
  }
}

async function loadTransactions() {
  const list = document.getElementById('transactions-list');
  if (!list) return;
  try {
    const res = await fetch('/api/profile/transactions', { credentials: 'include' });
    const data = await res.json();
    if (!data.ok || !data.transactions || data.transactions.length === 0) {
      list.innerHTML = '<div class="empty-state">No transactions yet</div>';
      return;
    }
    list.innerHTML = '';
    data.transactions.forEach(tx => {
      const row = document.createElement('div');
      row.className = 'tx-row';
      const isPositive = tx.amount_cents > 0;
      const meta = typeof tx.meta === 'string' ? JSON.parse(tx.meta) : (tx.meta || {});
      const detail = meta?.reference || meta?.method || '';

      row.innerHTML = `
        <div class="tx-kind">
          <span class="tx-kind-label ${tx.kind}">${tx.kind} ${detail ? `• ${detail}` : ''}</span>
          <span class="tx-time">${new Date(tx.created_at).toLocaleString()}</span>
        </div>
        <div class="tx-amount ${isPositive ? 'positive' : 'negative'}">
          ${isPositive ? '+' : ''}${(tx.amount_cents / 100).toFixed(2)} KES
        </div>
      `;
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = { email: document.getElementById('profile-email-input').value };
    const currentPw = document.getElementById('profile-current-pw').value;
    const newPw = document.getElementById('profile-new-pw').value;
    if (newPw) {
      if (!currentPw) throw new Error('Enter current password to change password');
      body.currentPassword = currentPw;
      body.newPassword = newPw;
    }
    const res = await fetch('/api/profile/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed');
    currentUser = data.user;
    updateBalanceDisplay();
    document.getElementById('profile-current-pw').value = '';
    document.getElementById('profile-new-pw').value = '';
    loadProfileData();
    showToast('success', '✅ Profile updated successfully');
  } catch (err) {
    showToast('error', err.message);
  }
});

document.getElementById('deposit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  const method = document.getElementById('deposit-method').value;
  if (amount < 100) { showToast('warning', 'Minimum deposit is 100 KES'); return; }

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Confirm Deposit',
      html: `Add <strong style="color:#00a86b">${amount.toFixed(2)} KES</strong> via ${method.toUpperCase()}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '💰 Yes, Deposit',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#00a86b',
      customClass: { popup: 'aviator-swal' },
      appendTo: document.getElementById('profile-modal'),
    }).then(async (result) => {
      if (!result.isConfirmed) return;
      await processDeposit(amount, method);
    });
  } else {
    if (confirm(`Deposit ${amount.toFixed(2)} KES via ${method}?`)) {
      await processDeposit(amount, method);
    }
  }
});

async function processDeposit(amount, method) {
  // 1. Open Paystack Popup
  const handler = PaystackPop.setup({
    key: 'pk_test_6fd8058cb2b68cc3b1087ae85001b14858b3e1c6', // REPLACE WITH YOUR TEST PUBLIC KEY from .env or dashboard
    email: currentUser.email,
    amount: amount * 100, // Paystack uses cents/kobo
    currency: 'KES',
    ref: 'AVIATOR-' + Math.floor(Math.random() * 1000000000), // Unique reference
    onClose: function () {
      showToast('warning', 'Payment window closed');
    },
    callback: function (response) {
      // 2. Payment successful in popup, now verify with backend
      verifyPayment(response.reference, amount);
    }
  });
  handler.openIframe();
}

async function verifyPayment(reference, amount) {
  try {
    showToast('info', 'Verifying payment...');
    const res = await fetch(`/api/payments/verify?reference=${reference}`, { 
      credentials: 'include' 
    });
    const data = await res.json();
    
    if (data.ok) {
      showToast('success', `💰 Deposited ${amount} KES successfully!`);
      // Force reload to update balance everywhere
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast('error', data.message || 'Verification failed');
    }
  } catch (err) {
    showToast('error', 'Verification error');
  }
}

document.getElementById('withdraw-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const method = document.getElementById('withdraw-method').value;
  const account = document.getElementById('withdraw-account').value.trim();
  if (amount < 100) { showToast('warning', 'Minimum withdrawal is 100 KES'); return; }
  if (amount * 100 > currentUser.balanceCents) {
    showToast('error', `Insufficient balance! Max: ${(currentUser.balanceCents / 100).toFixed(2)} KES`);
    return;
  }

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Confirm Withdrawal',
      html: `Send <strong style="color:#f59e0b">${amount.toFixed(2)} KES</strong> to ${method.toUpperCase()} (${account})?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '💸 Yes, Withdraw',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#f59e0b',
      customClass: { popup: 'aviator-swal' },
      appendTo: document.getElementById('profile-modal'),
    }).then(async (result) => {
      if (!result.isConfirmed) return;
      await processWithdraw(amount, method, account);
    });
  } else {
    if (confirm(`Withdraw ${amount.toFixed(2)} KES to ${method} (${account})?`)) {
      await processWithdraw(amount, method, account);
    }
  }
});

async function processWithdraw(amount, method, account) {
  try {
    const res = await fetch('/api/profile/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amount, method, account }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
    currentUser.balanceCents = data.withdrawal.newBalanceCents;
    updateBalanceDisplay();
    loadProfileData();
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-account').value = '';
    showToast('success', `💸 Withdrawal of ${amount.toFixed(2)} KES initiated`);
  } catch (err) {
    showToast('error', err.message);
  }
}

document.querySelectorAll('.quick-amount').forEach(btn => {
  btn.addEventListener('click', () => {
    const amount = btn.dataset.amount;
    const activeTab = document.querySelector('.modal-tab.active')?.dataset.tab;
    const inputId = activeTab === 'deposit' ? 'deposit-amount' : 'withdraw-amount';
    const input = document.getElementById(inputId);
    if (input) input.value = amount;
  });
});

// --- CANVAS DRAWING ---
function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

function drawSunburst() {
  if (!ctx || !canvas) return;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(0, H);
  const rays = 32;
  for (let i = 0; i < rays; i++) {
    const angle = (i / rays) * Math.PI * 0.5;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(20, 20, 30, 0.8)' : 'rgba(10, 10, 16, 0.8)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const len = Math.max(W, H) * 1.5;
    ctx.lineTo(Math.cos(angle) * len, -Math.sin(angle) * len);
    ctx.lineTo(Math.cos(angle + Math.PI / rays / 2) * len, -Math.sin(angle + Math.PI / rays / 2) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBiplane(x, y, angle) {
  if (!ctx) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#e50051';
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-15, -12, 30, 6);
  ctx.fillRect(-15, 6, 30, 6);
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-35, -8);
  ctx.lineTo(-35, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.fillRect(28, -12, 4, 24);
  ctx.restore();
}

function draw() {
  resizeCanvas();
  if (!canvas || !ctx) return;
  const W = canvas.width, H = canvas.height;
  drawSunburst();

  const currentMult = getCurrentMultiplier();
  if (gameState.phase !== 'crashed') {
    if (multEl) {
      multEl.textContent = `${currentMult.toFixed(2)}x`;
      multEl.classList.remove('crashed');
    }
    if (statusEl) statusEl.textContent = gameState.phase === 'flying' ? 'In flight...' : 'Waiting for next round...';
  } else {
    if (statusEl) statusEl.textContent = 'FLEW AWAY!';
  }

  const maxMult = 50;
  const progress = Math.min(1, Math.log(Math.max(currentMult, 1)) / Math.log(maxMult));
  const startX = W * 0.02;
  const endX = W * 0.98;
  const groundY = H * 0.9;
  const topY = H * 0.1;

  ctx.beginPath();
  ctx.moveTo(startX, groundY);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const x = startX + t * (endX - startX);
    const y = groundY - Math.pow(t, 1.6) * (groundY - topY) * progress;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(endX, groundY);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, topY, 0, groundY);
  fillGrad.addColorStop(0, 'rgba(229, 0, 81, 0.8)');
  fillGrad.addColorStop(0.5, 'rgba(229, 0, 81, 0.4)');
  fillGrad.addColorStop(1, 'rgba(229, 0, 81, 0.1)');
  ctx.fillStyle = fillGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = '#e50051';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const x = startX + t * (endX - startX);
    const y = groundY - Math.pow(t, 1.6) * (groundY - topY) * progress;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (gameState.phase !== 'crashed' || progress < 1) {
    const tipT = progress;
    const tipX = startX + tipT * (endX - startX);
    const tipY = groundY - Math.pow(tipT, 1.6) * (groundY - topY);
    const nextT = Math.min(1, tipT + 0.01);
    const nextX = startX + nextT * (endX - startX);
    const nextY = groundY - Math.pow(nextT, 1.6) * (groundY - topY);
    const angle = Math.atan2(tipY - nextY, nextX - tipX);
    drawBiplane(tipX, tipY, angle);
  } else if (gameState.phase === 'crashed') {
    const flyProgress = Math.min(1, (Date.now() - gameState.crashTime) / 2000);
    const tipX = W * 0.98 + flyProgress * 150;
    const tipY = H * 0.1 - flyProgress * 150;
    drawBiplane(tipX, tipY, -0.3);
  }

  requestAnimationFrame(draw);
}

// --- ADMIN PANEL ---
let isAdmin = false;
let adminPollInterval = null;

async function initAdminPanel() {
  console.log('=== ADMIN PANEL INIT ===');
  console.log('Current user:', currentUser);

  if (!currentUser?.isAdmin) {
    console.log('❌ Not admin, hiding panel');
    const panel = document.getElementById('admin-panel');
    if (panel) panel.style.display = 'none';
    return;
  }

  console.log('✅ User is admin, showing panel');
  isAdmin = true;
  const panel = document.getElementById('admin-panel');
  if (panel) panel.style.display = 'block';

  const toggleBtn = document.getElementById('admin-toggle');
  const content = document.getElementById('admin-content');
  if (toggleBtn && content) {
    toggleBtn.onclick = () => {
      content.style.display = content.style.display === 'none' ? 'block' : 'none';
    };
  }

  await loadAdminData();
  if (adminPollInterval) clearInterval(adminPollInterval);
  adminPollInterval = setInterval(loadAdminData, 500);
}

async function loadAdminData() {
  try {
    const res = await fetch('/api/admin/game-state', { credentials: 'include' });
    const data = await res.json();
    if (data.ok && data.data) updateAdminPanel(data.data);
  } catch (e) { /* silent */ }

  if (!window.adminRoundsLoaded) {
    try {
      const res = await fetch('/api/admin/rounds', { credentials: 'include' });
      const data = await res.json();
      if (data.ok && data.rounds) {
        renderAdminRounds(data.rounds);
        window.adminRoundsLoaded = true;
      }
    } catch (e) { /* silent */ }
  }
}

function updateAdminPanel(state) {
  const crashPointEl = document.getElementById('admin-crash-point');
  const roundIdEl = document.getElementById('admin-round-id');
  const phaseEl = document.getElementById('admin-phase');
  const timeLeftEl = document.getElementById('admin-time-left');
  const progressEl = document.getElementById('admin-progress');

  if (crashPointEl) {
    crashPointEl.textContent = state.crashPoint ? `${state.crashPoint.toFixed(2)}x` : '—';
    if (state.crashPoint >= 10) crashPointEl.style.color = '#ec4899';
    else if (state.crashPoint >= 2) crashPointEl.style.color = '#a855f7';
    else crashPointEl.style.color = '#3b82f6';
  }
  if (roundIdEl) roundIdEl.textContent = state.roundId || '—';
  if (phaseEl) phaseEl.textContent = state.phase || '—';
  if (timeLeftEl) {
    timeLeftEl.textContent = state.timeRemaining !== null && state.timeRemaining !== undefined
      ? `${(state.timeRemaining / 1000).toFixed(1)}s` : '—';
  }
  if (progressEl) {
    progressEl.textContent = state.flightProgress !== null && state.flightProgress !== undefined
      ? `${state.flightProgress.toFixed(0)}%` : '—';
  }
}

function renderAdminRounds(rounds) {
  const list = document.getElementById('admin-rounds-list');
  if (!list) return;
  list.innerHTML = '';
  if (!rounds || rounds.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">No rounds yet</div>';
    return;
  }
  rounds.forEach(r => {
    const row = document.createElement('div');
    row.className = 'admin-round-row';
    let pillClass = 'low';
    const crashPoint = Number(r.crash_point);
    if (crashPoint >= 10) pillClass = 'high';
    else if (crashPoint >= 2) pillClass = 'mid';
    row.innerHTML = `
      <span>#${r.id}</span>
      <span class="pill ${pillClass}">${crashPoint.toFixed(2)}x</span>
      <span style="color:#666">${new Date(r.created_at).toLocaleTimeString()}</span>
    `;
    list.appendChild(row);
  });
}

// --- START ---
checkAuth();
draw();

// Live countdown updater
setInterval(() => {
  if (gameState.phase === 'betting' || gameState.phase === 'flying') {
    updateUI();
  }
}, 100);