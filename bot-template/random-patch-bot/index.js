const { io } = require('socket.io-client');

const BOT_SERVER = String(process.env.BOT_SERVER || 'http://127.0.0.1:23333').trim();
const BOT_ROOM = String(process.env.BOT_ROOM || '').trim();
const BOT_TOKEN = String(process.env.BOT_TOKEN || '').trim();
const BOT_TEAM = Math.max(1, Number.parseInt(String(process.env.BOT_TEAM || '1'), 10) || 1);
const BOT_AUTO_READY = String(process.env.BOT_AUTO_READY || '1') !== '0';
const ACTION_DELAY_MS = Math.max(
  0,
  Number.parseInt(String(process.env.BOT_ACTION_DELAY_MS || '120'), 10) || 120,
);

if (!BOT_ROOM) {
  throw new Error('Missing BOT_ROOM. Example: BOT_ROOM=abc123');
}

if (!BOT_TOKEN) {
  throw new Error('Missing BOT_TOKEN. Copy auth_token from browser cookie after login.');
}

const DIRECTIONS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

const state = {
  n: 0,
  m: 0,
  gridType: [],
  armyCnt: [],
  clientId: '',
  playerId: 0,
  lastTurn: -1,
  inGame: false,
  lastLobbyActionAt: 0,
};

function indexOfCell(x, y) {
  return x * state.m + y;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < state.n && y < state.m;
}

function resetMap(n, m) {
  state.n = n;
  state.m = m;
  state.gridType = new Array(n * m).fill(200);
  state.armyCnt = new Array(n * m).fill(0);
  state.lastTurn = -1;
}

function applyDiff(diffArray, targetArray) {
  if (!Array.isArray(diffArray)) {
    return;
  }
  for (let i = 0; i + 1 < diffArray.length; i += 2) {
    const idx = Number.parseInt(String(diffArray[i]), 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= targetArray.length) {
      continue;
    }
    targetArray[idx] = diffArray[i + 1];
  }
}

function applyUpdatePayload(payload) {
  if (state.n === 0 || state.m === 0) {
    return false;
  }
  if (payload && payload.is_diff) {
    applyDiff(payload.grid_type, state.gridType);
    applyDiff(payload.army_cnt, state.armyCnt);
    return true;
  }

  if (!Array.isArray(payload?.grid_type) || !Array.isArray(payload?.army_cnt)) {
    return false;
  }
  if (
    payload.grid_type.length !== state.gridType.length ||
    payload.army_cnt.length !== state.armyCnt.length
  ) {
    return false;
  }
  state.gridType = payload.grid_type.slice();
  state.armyCnt = payload.army_cnt.slice();
  return true;
}

function isOwnCell(code) {
  return typeof code === 'number' && code < 200 && code % 50 === state.playerId;
}

function collectPossibleActions() {
  const actions = [];
  for (let x = 0; x < state.n; x += 1) {
    for (let y = 0; y < state.m; y += 1) {
      const idx = indexOfCell(x, y);
      const code = state.gridType[idx];
      const army = state.armyCnt[idx];
      if (!isOwnCell(code) || army <= 1) {
        continue;
      }

      for (const direction of DIRECTIONS) {
        const dx = x + direction.x;
        const dy = y + direction.y;
        if (!inBounds(dx, dy)) {
          continue;
        }
        const targetCode = state.gridType[indexOfCell(dx, dy)];
        if (targetCode === 201) {
          continue;
        }
        actions.push({ x, y, dx, dy, half: false });
        actions.push({ x, y, dx, dy, half: true });
      }
    }
  }
  return actions;
}

function pickRandomAction(actions) {
  if (!actions.length) {
    return null;
  }
  const index = Math.floor(Math.random() * actions.length);
  return actions[index];
}

const socket = io(BOT_SERVER, {
  transports: ['websocket', 'polling'],
  auth: { token: BOT_TOKEN },
  reconnection: true,
});

socket.on('connect', () => {
  console.log(`[bot] connected: ${socket.id}`);
  socket.emit('join_game_room', { room: BOT_ROOM });
});

socket.on('connect_error', (error) => {
  console.error(`[bot] connect_error: ${error.message}`);
});

socket.on('disconnect', (reason) => {
  console.log(`[bot] disconnected: ${reason}`);
});

socket.on('set_id', (id) => {
  state.clientId = String(id || '');
  console.log(`[bot] client_id: ${state.clientId}`);
});

function toBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function autoReadyFromRoomUpdate(data) {
  if (!BOT_AUTO_READY || !state.clientId) {
    return;
  }
  if (!Array.isArray(data?.players) || toBoolean(data?.in_game)) {
    return;
  }

  const self = data.players.find((player) => String(player?.sid || '') === state.clientId);
  if (!self) {
    return;
  }

  const allowTeam = toBoolean(data.allow_team);
  const team = Number.parseInt(String(self.team ?? '0'), 10) || 0;
  const ready = toBoolean(self.ready);
  const targetTeam = allowTeam ? BOT_TEAM : 1;
  const need = Number.parseInt(String(data?.need ?? '0'), 10) || 0;
  const now = Date.now();

  if (now - state.lastLobbyActionAt < 1000) {
    return;
  }

  if (team === 0) {
    socket.emit('change_team', { team: targetTeam });
    state.lastLobbyActionAt = now;
    console.log(`[bot] request change_team=${targetTeam}`);
    return;
  }

  if (need <= 1) {
    return;
  }

  if (!ready) {
    socket.emit('change_ready', { ready: true });
    state.lastLobbyActionAt = now;
    console.log('[bot] request change_ready=true');
  }
}

socket.on('init_map', (data) => {
  const n = Number.parseInt(String(data?.n ?? '0'), 10);
  const m = Number.parseInt(String(data?.m ?? '0'), 10);
  if (!Number.isFinite(n) || !Number.isFinite(m) || n <= 0 || m <= 0) {
    return;
  }

  resetMap(n, m);
  state.inGame = true;

  const playerIds = Array.isArray(data?.player_ids) ? data.player_ids.map((item) => String(item)) : [];
  const foundIndex = playerIds.indexOf(state.clientId);
  state.playerId = foundIndex >= 0 ? foundIndex + 1 : 0;
  console.log(`[bot] init_map ${n}x${m}, playerId=${state.playerId || 'spectator'}`);
});

socket.on('update', (payload) => {
  if (!state.inGame) {
    return;
  }

  const ok = applyUpdatePayload(payload);
  if (!ok) {
    return;
  }

  const turn = Number.parseInt(String(payload?.turn ?? '-1'), 10);
  if (!Number.isFinite(turn) || turn < 0 || turn === state.lastTurn) {
    return;
  }
  state.lastTurn = turn;

  if (payload?.game_end) {
    console.log(`[bot] game ended at turn ${turn}`);
    return;
  }

  if (state.playerId <= 0) {
    return;
  }

  const actions = collectPossibleActions();
  const picked = pickRandomAction(actions);
  if (!picked) {
    console.log(`[bot] turn ${turn}: no action`);
    return;
  }

  setTimeout(() => {
    socket.emit('attack', picked);
    console.log(`[bot] turn ${turn}: attack ${JSON.stringify(picked)} (choices=${actions.length})`);
  }, ACTION_DELAY_MS);
});

socket.on('left', () => {
  state.inGame = false;
  console.log('[bot] left current game');
});

socket.on('room_update', (data) => {
  autoReadyFromRoomUpdate(data);
});

process.on('SIGINT', () => {
  console.log('[bot] shutting down');
  socket.disconnect();
  process.exit(0);
});
