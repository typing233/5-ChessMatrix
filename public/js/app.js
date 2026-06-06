// --- State ---
let currentUser = null;
let token = null;
let socket = null;
let board = null;
let timer = null;
let currentGame = null;
let matchmakingStartTime = null;
let matchmakingInterval = null;
let profilePage = 0;

// --- DOM ---
const screens = {
  auth: document.getElementById('auth-screen'),
  lobby: document.getElementById('lobby-screen'),
  profile: document.getElementById('profile-screen'),
  game: document.getElementById('game-screen'),
};

// --- Screen Management ---
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// --- Toast ---
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// --- Auth ---
document.querySelectorAll('.auth-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
    document.getElementById('auth-error').textContent = '';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    handleAuthSuccess(data);
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    handleAuthSuccess(data);
  } catch (err) {
    document.getElementById('auth-error').textContent = err.message;
  }
});

function handleAuthSuccess(data) {
  currentUser = data.user;
  currentUser.userId = currentUser._id;
  token = data.token;
  localStorage.setItem('chess_token', token);
  localStorage.setItem('chess_user', JSON.stringify(currentUser));
  connectSocket();
  showLobby();
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('chess_token');
  localStorage.removeItem('chess_user');
  if (socket) socket.disconnect();
  currentUser = null;
  token = null;
  showScreen('auth');
});

// Auto-login
(function autoLogin() {
  const savedToken = localStorage.getItem('chess_token');
  const savedUser = localStorage.getItem('chess_user');
  if (savedToken && savedUser) {
    token = savedToken;
    currentUser = JSON.parse(savedUser);
    currentUser.userId = currentUser.userId || currentUser._id;
    connectSocket();
    showLobby();
  }
})();

// --- Socket ---
function connectSocket() {
  socket = io({ auth: { token }, reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });

  socket.on('connect_error', (err) => {
    showToast('Connection failed: ' + err.message);
    localStorage.removeItem('chess_token');
    localStorage.removeItem('chess_user');
    showScreen('auth');
  });

  socket.on('disconnect', () => {
    if (currentGame) {
      document.getElementById('reconnect-overlay').classList.remove('hidden');
    }
  });

  socket.on('reconnect', () => {
    document.getElementById('reconnect-overlay').classList.add('hidden');
  });

  socket.on('connected', (data) => {
    currentUser = { ...currentUser, ...data };
    updateNavDisplay();
    document.getElementById('reconnect-overlay').classList.add('hidden');
  });

  socket.on('reconnected', () => {
    document.getElementById('reconnect-overlay').classList.add('hidden');
    showToast('已重新连接到对局');
  });

  socket.on('error_msg', ({ message }) => showToast(message));

  socket.on('room_created', ({ roomId }) => {
    document.getElementById('room-id-display').textContent = roomId;
    document.getElementById('room-created').classList.remove('hidden');
    document.getElementById('create-room-btn').classList.add('hidden');
  });

  socket.on('matchmaking_joined', () => {
    showMatchmakingSearching();
  });

  socket.on('matchmaking_left', () => {
    showMatchmakingIdle();
  });

  socket.on('matchmaking_status', (status) => {
    document.getElementById('search-range').textContent = `±${status.range}`;
  });

  socket.on('matchmaking_timeout', () => {
    showMatchmakingTimeout();
  });

  socket.on('match_found', (data) => {
    showMatchFoundModal(data);
  });

  socket.on('game_start', (state) => {
    hideMatchFoundModal();
    startGame(state);
  });

  socket.on('move_made', ({ state }) => {
    updateGameState(state);
  });

  socket.on('time_update', (timeState) => {
    if (timer && currentGame) {
      const myUserId = currentUser.userId || currentUser._id;
      const isWhite = currentGame.white.userId === myUserId;
      if (isWhite) {
        timer.sync(timeState.whiteTime, timeState.blackTime, timeState.activeSide);
      } else {
        timer.sync(timeState.blackTime, timeState.whiteTime, timeState.activeSide === 'w' ? 'b' : 'w');
      }
    }
  });

  socket.on('game_over', (result) => {
    handleGameOver(result);
  });

  socket.on('draw_offered', ({ by }) => {
    showToast(`${by} 提议和棋`);
    document.getElementById('draw-btn').textContent = '接受和棋';
    document.getElementById('draw-btn').onclick = () => socket.emit('accept_draw');
  });

  socket.on('draw_declined', () => {
    showToast('对手拒绝了和棋');
    document.getElementById('draw-btn').textContent = '提和';
    document.getElementById('draw-btn').onclick = () => socket.emit('offer_draw');
  });

  socket.on('rematch_requested', ({ by }) => {
    showToast(`${by} 请求再来一局`);
    document.getElementById('rematch-btn').textContent = '接受再战';
  });

  socket.on('opponent_disconnected', ({ remaining }) => {
    document.getElementById('disconnect-overlay').classList.remove('hidden');
    updateDisconnectCountdown(remaining);
  });

  socket.on('opponent_reconnected', () => {
    document.getElementById('disconnect-overlay').classList.add('hidden');
    showToast('对手已重新连接');
  });
}

function updateDisconnectCountdown(remaining) {
  const el = document.getElementById('disconnect-countdown');
  const update = () => {
    remaining -= 1000;
    if (remaining <= 0) {
      el.textContent = '等待超时';
      return;
    }
    el.textContent = `剩余 ${Math.ceil(remaining / 1000)}s`;
    setTimeout(update, 1000);
  };
  el.textContent = `剩余 ${Math.ceil(remaining / 1000)}s`;
  setTimeout(update, 1000);
}

// --- Nav ---
function updateNavDisplay() {
  document.getElementById('nav-username').textContent = currentUser.username;
  document.getElementById('nav-elo').textContent = currentUser.elo_rating || currentUser.elo || 1200;
}

// --- Lobby ---
function showLobby() {
  showScreen('lobby');
  updateNavDisplay();
  loadLeaderboard();
  loadGameHistory();
  resetLobbyState();
}

function resetLobbyState() {
  showMatchmakingIdle();
  document.getElementById('create-room-btn').classList.remove('hidden');
  document.getElementById('room-created').classList.add('hidden');
}

function showMatchmakingIdle() {
  document.getElementById('matchmaking-idle').classList.remove('hidden');
  document.getElementById('matchmaking-searching').classList.add('hidden');
  document.getElementById('matchmaking-timeout').classList.add('hidden');
  if (matchmakingInterval) { clearInterval(matchmakingInterval); matchmakingInterval = null; }
}

function showMatchmakingSearching() {
  document.getElementById('matchmaking-idle').classList.add('hidden');
  document.getElementById('matchmaking-searching').classList.remove('hidden');
  document.getElementById('matchmaking-timeout').classList.add('hidden');
  matchmakingStartTime = Date.now();
  matchmakingInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - matchmakingStartTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    document.getElementById('search-time').textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  }, 1000);
}

function showMatchmakingTimeout() {
  document.getElementById('matchmaking-idle').classList.add('hidden');
  document.getElementById('matchmaking-searching').classList.add('hidden');
  document.getElementById('matchmaking-timeout').classList.remove('hidden');
  if (matchmakingInterval) { clearInterval(matchmakingInterval); matchmakingInterval = null; }
}

function showMatchFoundModal(data) {
  const modal = document.getElementById('match-found-modal');
  document.getElementById('match-p1-name').textContent = data.white.username;
  document.getElementById('match-p1-elo').textContent = data.white.elo;
  document.getElementById('match-p1-avatar').textContent = data.white.username[0].toUpperCase();
  document.getElementById('match-p2-name').textContent = data.black.username;
  document.getElementById('match-p2-elo').textContent = data.black.elo;
  document.getElementById('match-p2-avatar').textContent = data.black.username[0].toUpperCase();
  modal.classList.remove('hidden');

  let count = 3;
  const countEl = document.getElementById('match-countdown');
  countEl.textContent = count;
  const countInterval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(countInterval);
      return;
    }
    countEl.textContent = count;
  }, 1000);
}

function hideMatchFoundModal() {
  document.getElementById('match-found-modal').classList.add('hidden');
}

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    const el = document.getElementById('leaderboard');
    if (data.length === 0) {
      el.innerHTML = '<p class="hint">暂无数据</p>';
      return;
    }
    el.innerHTML = data.map((u, i) => `
      <div class="leaderboard-entry">
        <span><span class="rank">#${i + 1}</span> ${u.username}</span>
        <span class="lb-elo">${u.elo_rating}</span>
      </div>
    `).join('');
  } catch (e) { /* ignore */ }
}

async function loadGameHistory() {
  if (!currentUser) return;
  try {
    const res = await fetch(`/api/games/${currentUser.userId || currentUser._id}?limit=10`);
    const games = await res.json();
    const el = document.getElementById('game-history');
    if (games.length === 0) {
      el.innerHTML = '<p class="hint">暂无对局</p>';
      return;
    }
    el.innerHTML = games.map(g => {
      const isWhite = g.white_id === (currentUser.userId || currentUser._id);
      const opponent = isWhite ? g.black_username : g.white_username;
      let resultClass, resultText;
      if (g.result === 'draw') { resultClass = 'result-draw'; resultText = '和'; }
      else if ((g.result === 'white' && isWhite) || (g.result === 'black' && !isWhite)) {
        resultClass = 'result-win'; resultText = '胜';
      } else {
        resultClass = 'result-loss'; resultText = '负';
      }
      return `<div class="history-entry"><span><span class="${resultClass}">[${resultText}]</span> vs ${opponent}</span><button class="replay-btn" onclick="viewReplay('${g._id}')">回放</button></div>`;
    }).join('');
  } catch (e) { /* ignore */ }
}

// --- Lobby Actions ---
document.getElementById('matchmaking-btn').addEventListener('click', () => {
  socket.emit('join_matchmaking');
});

document.getElementById('cancel-matchmaking-btn').addEventListener('click', () => {
  socket.emit('leave_matchmaking');
});

document.getElementById('retry-matchmaking-btn').addEventListener('click', () => {
  socket.emit('join_matchmaking');
});

document.getElementById('dismiss-timeout-btn').addEventListener('click', () => {
  showMatchmakingIdle();
});

document.getElementById('create-room-btn').addEventListener('click', () => {
  socket.emit('create_room');
});

document.getElementById('copy-room-id').addEventListener('click', () => {
  const id = document.getElementById('room-id-display').textContent;
  navigator.clipboard.writeText(id).then(() => showToast('已复制房间ID'));
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const roomId = document.getElementById('join-room-input').value.trim();
  if (!roomId) return showToast('请输入房间ID');
  socket.emit('join_room', { roomId });
});

// --- Profile ---
document.getElementById('profile-btn').addEventListener('click', () => {
  showProfile();
});

document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
  showLobby();
});

async function showProfile() {
  showScreen('profile');
  profilePage = 0;

  const userId = currentUser.userId || currentUser._id;
  try {
    const res = await fetch(`/api/profile/${userId}`);
    const user = await res.json();

    document.getElementById('profile-avatar').textContent = user.username[0].toUpperCase();
    document.getElementById('profile-username').textContent = user.username;
    document.getElementById('profile-elo-value').textContent = user.elo_rating;
    document.getElementById('stat-games').textContent = user.games_played;
    document.getElementById('stat-wins').textContent = user.wins;
    document.getElementById('stat-losses').textContent = user.losses;
    document.getElementById('stat-draws').textContent = user.draws;

    const winrate = user.games_played > 0 ? Math.round((user.wins / user.games_played) * 100) : 0;
    document.getElementById('stat-winrate').textContent = winrate + '%';
  } catch (e) { showToast('Failed to load profile'); }

  loadProfileHistory(true);
}

async function loadProfileHistory(reset) {
  if (reset) profilePage = 0;
  const userId = currentUser.userId || currentUser._id;
  try {
    const res = await fetch(`/api/games/${userId}?page=${profilePage}&limit=20`);
    const games = await res.json();
    const el = document.getElementById('profile-game-history');

    if (reset) el.innerHTML = '';

    if (games.length === 0 && profilePage === 0) {
      el.innerHTML = '<p class="hint">暂无对局记录</p>';
      document.getElementById('load-more-btn').classList.add('hidden');
      return;
    }

    const html = games.map(g => {
      const isWhite = g.white_id === userId;
      const opponent = isWhite ? g.black_username : g.white_username;
      let resultClass, resultText;
      if (g.result === 'draw') { resultClass = 'result-draw'; resultText = '和'; }
      else if ((g.result === 'white' && isWhite) || (g.result === 'black' && !isWhite)) {
        resultClass = 'result-win'; resultText = '胜';
      } else { resultClass = 'result-loss'; resultText = '负'; }

      const eloDelta = isWhite
        ? (g.white_elo_after ? g.white_elo_after - g.white_elo_before : 0)
        : (g.black_elo_after ? g.black_elo_after - g.black_elo_before : 0);
      const eloClass = eloDelta > 0 ? 'positive' : eloDelta < 0 ? 'negative' : '';
      const eloText = eloDelta > 0 ? `+${eloDelta}` : `${eloDelta}`;
      const date = g.ended_at ? new Date(g.ended_at).toLocaleDateString('zh-CN') : '';

      return `<div class="history-row">
        <span class="h-date">${date}</span>
        <span class="h-opponent"><span class="${resultClass}">[${resultText}]</span> vs ${opponent}</span>
        <span class="h-elo ${eloClass}">${eloText}</span>
        <span>${g.is_ranked ? '排位' : '友谊'}</span>
        <button class="replay-btn" onclick="viewReplay('${g._id}')">回放</button>
      </div>`;
    }).join('');

    el.innerHTML += html;

    if (games.length >= 20) {
      document.getElementById('load-more-btn').classList.remove('hidden');
    } else {
      document.getElementById('load-more-btn').classList.add('hidden');
    }
  } catch (e) { /* ignore */ }
}

document.getElementById('load-more-btn').addEventListener('click', () => {
  profilePage++;
  loadProfileHistory(false);
});

// --- Game ---
function startGame(state) {
  currentGame = state;
  showScreen('game');
  showMatchmakingIdle();

  const myUserId = currentUser.userId || currentUser._id;
  const isWhite = state.white.userId === myUserId;
  const myColor = isWhite ? 'w' : 'b';

  if (!board) {
    board = new ChessBoard3D('chess-board');
  }

  board.myColor = myColor;
  board.setFlipped(!isWhite);
  board.setPosition(state.fen);
  board.setLegalMoves(state.legalMoves);
  board.currentTurn = state.turn;
  board.enable();

  board.onMove = (from, to, promotion) => {
    socket.emit('move', { from, to, promotion });
  };

  // Player info
  const opponent = isWhite ? state.black : state.white;
  const self = isWhite ? state.white : state.black;
  document.getElementById('opponent-name').textContent = opponent.username;
  document.getElementById('opponent-elo').textContent = `${opponent.elo}`;
  document.getElementById('opponent-avatar').textContent = opponent.username[0].toUpperCase();
  document.getElementById('self-name').textContent = self.username;
  document.getElementById('self-elo').textContent = `${self.elo}`;
  document.getElementById('self-avatar').textContent = self.username[0].toUpperCase();

  // Timer
  const selfTimerEl = document.getElementById('self-timer');
  const opponentTimerEl = document.getElementById('opponent-timer');

  if (timer) timer.destroy();
  timer = new ChessTimer(selfTimerEl, opponentTimerEl);

  const selfTime = isWhite ? state.whiteTime : state.blackTime;
  const oppTime = isWhite ? state.blackTime : state.whiteTime;
  const activeSide = isWhite
    ? state.activeSide
    : (state.activeSide === 'w' ? 'b' : 'w');
  timer.start(selfTime, oppTime, activeSide === myColor ? 'w' : 'b');

  updateTurnIndicator(state.turn, myColor);
  updateMoveList(state.moves);

  // Buttons
  document.getElementById('resign-btn').classList.remove('hidden');
  document.getElementById('draw-btn').classList.remove('hidden');
  document.getElementById('rematch-btn').classList.add('hidden');
  document.getElementById('back-lobby-btn').classList.add('hidden');
  document.getElementById('game-over-modal').classList.add('hidden');
  document.getElementById('disconnect-overlay').classList.add('hidden');
  document.getElementById('reconnect-overlay').classList.add('hidden');

  document.getElementById('draw-btn').textContent = '提和';
  document.getElementById('draw-btn').onclick = () => socket.emit('offer_draw');

  document.getElementById('game-status').textContent = state.isRanked ? '排位赛 10+5' : '友谊赛 10+5';
}

function updateGameState(state) {
  currentGame = state;
  const myUserId = currentUser.userId || currentUser._id;
  const myColor = state.white.userId === myUserId ? 'w' : 'b';
  const isWhite = myColor === 'w';

  board.setPosition(state.fen);
  board.setLegalMoves(state.legalMoves);
  board.currentTurn = state.turn;

  if (state.moves.length > 0) {
    const last = state.moves[state.moves.length - 1];
    board.setLastMove(last.from, last.to);
  }

  if (state.isCheck) {
    const kingSquare = findKing(state.fen, state.turn);
    board.setCheck(kingSquare);
  } else {
    board.checkSquare = null;
  }

  board.render();

  // Timer sync
  if (timer) {
    const selfTime = isWhite ? state.whiteTime : state.blackTime;
    const oppTime = isWhite ? state.blackTime : state.whiteTime;
    const activeSideForSelf = state.activeSide === myColor ? 'w' : 'b';
    timer.sync(selfTime, oppTime, activeSideForSelf);
  }

  updateTurnIndicator(state.turn, myColor);
  updateMoveList(state.moves);
}

function updateTurnIndicator(turn, myColor) {
  const selfCard = document.querySelector('.self-card');
  const oppCard = document.querySelector('.opponent-card');
  if (selfCard) selfCard.classList.toggle('active-turn', turn === myColor);
  if (oppCard) oppCard.classList.toggle('active-turn', turn !== myColor);
}

function updateMoveList(moves) {
  const el = document.getElementById('move-list');
  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = moves[i];
    const blackMove = moves[i + 1];
    html += `<div class="move-pair">
      <span class="move-number">${moveNum}.</span>
      <span class="move ${i === moves.length - 1 ? 'latest' : ''}">${whiteMove.san}</span>
      ${blackMove ? `<span class="move ${i + 1 === moves.length - 1 ? 'latest' : ''}">${blackMove.san}</span>` : ''}
    </div>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function handleGameOver(result) {
  if (board) {
    board.disable();
    board.selectedSquare = null;
    board.render();
  }
  if (timer) timer.stop();

  const myUserId = currentUser.userId || currentUser._id;
  const isWhite = currentGame && currentGame.white.userId === myUserId;

  let title, icon;
  if (result.result === 'draw') {
    title = '和棋!';
    icon = '&#9822;';
  } else if ((result.result === 'white' && isWhite) || (result.result === 'black' && !isWhite)) {
    title = '你赢了!';
    icon = '&#127942;';
  } else {
    title = '你输了';
    icon = '&#128546;';
  }

  const reasons = {
    checkmate: '将杀', resignation: '认输', disconnect: '对手断线',
    stalemate: '逼和', threefold: '三次重复', fifty_move: '50步规则',
    insufficient: '子力不足', draw_agreement: '协议和棋', timeout: '超时',
  };
  const reason = reasons[result.reason] || result.reason;

  document.getElementById('gameover-icon').innerHTML = icon;
  document.getElementById('game-over-title').textContent = title;
  document.getElementById('game-over-reason').textContent = reason;

  const eloDelta = isWhite ? result.whiteEloDelta : result.blackEloDelta;
  const eloEl = document.getElementById('game-over-elo');
  if (eloDelta !== undefined && eloDelta !== 0) {
    const cls = eloDelta > 0 ? 'positive' : 'negative';
    const sign = eloDelta > 0 ? '+' : '';
    eloEl.innerHTML = `等级分变化: <span class="${cls}">${sign}${eloDelta}</span>`;
    const newElo = isWhite ? result.whiteElo : result.blackElo;
    currentUser.elo_rating = newElo;
    currentUser.elo = newElo;
  } else {
    eloEl.innerHTML = '';
  }

  document.getElementById('game-over-modal').classList.remove('hidden');
  document.getElementById('disconnect-overlay').classList.add('hidden');

  document.getElementById('resign-btn').classList.add('hidden');
  document.getElementById('draw-btn').classList.add('hidden');
  document.getElementById('rematch-btn').classList.remove('hidden');
  document.getElementById('back-lobby-btn').classList.remove('hidden');

  document.getElementById('rematch-btn').textContent = '再来一局';
  document.getElementById('modal-rematch-btn').textContent = '再来一局';
}

document.getElementById('resign-btn').addEventListener('click', () => {
  if (confirm('确定要认输吗?')) socket.emit('resign');
});

document.getElementById('rematch-btn').addEventListener('click', () => {
  socket.emit('request_rematch');
  document.getElementById('rematch-btn').textContent = '等待对手...';
});

document.getElementById('modal-rematch-btn').addEventListener('click', () => {
  socket.emit('request_rematch');
  document.getElementById('modal-rematch-btn').textContent = '等待对手...';
});

document.getElementById('back-lobby-btn').addEventListener('click', () => {
  socket.emit('leave_game');
  currentGame = null;
  if (timer) { timer.destroy(); timer = null; }
  showLobby();
});

document.getElementById('modal-lobby-btn').addEventListener('click', () => {
  socket.emit('leave_game');
  currentGame = null;
  if (timer) { timer.destroy(); timer = null; }
  document.getElementById('game-over-modal').classList.add('hidden');
  showLobby();
});

// --- Replay ---
async function viewReplay(gameId) {
  try {
    const res = await fetch(`/api/game/${gameId}`);
    const game = await res.json();
    if (!game.moves) return showToast('无法加载对局');

    const moves = Array.isArray(game.moves) ? game.moves : JSON.parse(game.moves);
    if (moves.length === 0) return showToast('对局无走子记录');

    showScreen('game');
    if (!board) board = new ChessBoard3D('chess-board');

    board.myColor = null;
    board.setFlipped(false);
    board.interactive = false;
    board.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    document.getElementById('opponent-name').textContent = game.black_username || 'Black';
    document.getElementById('self-name').textContent = game.white_username || 'White';
    document.getElementById('game-status').textContent = '对局回放';
    document.getElementById('resign-btn').classList.add('hidden');
    document.getElementById('draw-btn').classList.add('hidden');
    document.getElementById('rematch-btn').classList.add('hidden');
    document.getElementById('back-lobby-btn').classList.remove('hidden');

    if (timer) { timer.destroy(); timer = null; }
    document.getElementById('self-timer').textContent = '--:--';
    document.getElementById('opponent-timer').textContent = '--:--';

    let idx = 0;
    const replayInterval = setInterval(() => {
      if (idx >= moves.length) { clearInterval(replayInterval); return; }
      const move = moves[idx];
      board.setPosition(move.fen);
      board.setLastMove(move.from, move.to);
      board.render();
      updateMoveList(moves.slice(0, idx + 1));
      idx++;
    }, 1000);

    document.getElementById('back-lobby-btn').onclick = () => {
      clearInterval(replayInterval);
      currentGame = null;
      showLobby();
    };
  } catch (e) {
    showToast('加载失败');
  }
}

// --- Utility ---
function findKing(fen, color) {
  const board = fen.split(' ')[0].split('/');
  const kingChar = color === 'w' ? 'K' : 'k';
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of board[r]) {
      if (/\d/.test(ch)) { f += parseInt(ch); }
      else {
        if (ch === kingChar) return FILES[f] + RANKS[r];
        f++;
      }
    }
  }
  return null;
}
