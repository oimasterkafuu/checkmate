const { io } = require('socket.io-client');
const GameStrategy = require('./strategy/GameStrategy');
const { MapState } = require('./state/MapState');

function toBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

class Bot {
  constructor(config) {
    this.server = config.server;
    this.room = config.room;
    this.token = config.token;
    this.team = config.team;
    this.autoReady = config.autoReady;

    this.socket = null;
    this.clientId = '';
    this.playerId = 0;
    this.inGame = false;
    this.lastTurn = -1;
    this.lastMazeRequestAt = 0;
    this.lastLobbyActionAt = 0;
    this.forceSpectatorForMapMode = false;

    this.mapState = new MapState();
    this.strategy = new GameStrategy();
  }

  start() {
    this.socket = io(this.server, {
      transports: ['websocket', 'polling'],
      auth: { token: this.token },
      reconnection: true,
    });

    this.registerEvents();
  }

  stop() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  registerEvents() {
    this.socket.on('connect', () => {
      this.socket.emit('join_game_room', { room: this.room });
    });

    this.socket.on('connect_error', (error) => {
      console.error(`[bot] connect_error: ${error.message}`);
    });

    this.socket.on('set_id', (id) => {
      this.clientId = String(id || '');
    });

    this.socket.on('room_update', (data) => {
      this.enforceMazePolicyFromRoomUpdate(data);
      this.autoReadyFromRoomUpdate(data);
    });

    this.socket.on('init_map', (data) => {
      this.handleInitMap(data);
    });

    this.socket.on('update', (payload) => {
      this.handleUpdate(payload);
    });

    this.socket.on('left', () => {
      this.inGame = false;
      this.playerId = 0;
      this.lastTurn = -1;
      this.forceSpectatorForMapMode = false;
      this.strategy.resetInitialization();
    });
  }

  enforceMazePolicyFromRoomUpdate(data) {
    if (!this.clientId || !Array.isArray(data?.players) || toBoolean(data?.in_game)) {
      return;
    }

    const self = data.players.find((player) => String(player?.sid || '') === this.clientId);
    if (!self) {
      return;
    }

    const hostSid = String(data.players[0]?.sid || '');
    const isHost = hostSid === this.clientId;

    const mapMode = String(data.map_mode || 'random');
    if (mapMode === 'maze') {
      if (this.forceSpectatorForMapMode) {
        this.forceSpectatorForMapMode = false;
        console.log('[bot] map guard: maze restored, release spectator lock');
      }
      return;
    }

    const now = Date.now();

    if (isHost) {
      this.forceSpectatorForMapMode = false;
      if (now - this.lastMazeRequestAt < 500) {
        return;
      }
      this.lastMazeRequestAt = now;
      this.socket.emit('change_game_conf', { map_mode: 'maze' });
      console.log('[bot] map guard: host enforce map_mode=maze');
      return;
    }

    this.forceSpectatorForMapMode = true;
    const team = Number.parseInt(String(self.team ?? '0'), 10) || 0;
    if (team !== 0 && now - this.lastLobbyActionAt >= 500) {
      this.socket.emit('change_team', { team: 0 });
      this.lastLobbyActionAt = now;
      console.log('[bot] map guard: no permission on non-maze, switch to spectator');
    }
  }

  autoReadyFromRoomUpdate(data) {
    if (!this.autoReady || !this.clientId) {
      return;
    }

    if (!Array.isArray(data?.players) || toBoolean(data?.in_game)) {
      return;
    }

    const self = data.players.find((player) => String(player?.sid || '') === this.clientId);
    if (!self) {
      return;
    }

    const allowTeam = toBoolean(data.allow_team);
    const team = Number.parseInt(String(self.team ?? '0'), 10) || 0;
    const ready = toBoolean(self.ready);
    const targetTeam = allowTeam ? this.team : 1;
    const need = Number.parseInt(String(data?.need ?? '0'), 10) || 0;
    const now = Date.now();

    if (this.forceSpectatorForMapMode) {
      return;
    }

    if (now - this.lastLobbyActionAt < 1000) {
      return;
    }

    if (team === 0) {
      this.socket.emit('change_team', { team: targetTeam });
      this.lastLobbyActionAt = now;
      return;
    }

    if (need <= 1) {
      return;
    }

    if (!ready) {
      this.socket.emit('change_ready', { ready: true });
      this.lastLobbyActionAt = now;
    }
  }

  handleInitMap(data) {
    const n = Number.parseInt(String(data?.n ?? '0'), 10);
    const m = Number.parseInt(String(data?.m ?? '0'), 10);

    if (!Number.isFinite(n) || !Number.isFinite(m) || n <= 0 || m <= 0) {
      return;
    }

    this.mapState.reset(n, m);
    this.inGame = true;
    this.lastTurn = -1;
    this.strategy.resetInitialization();

    const playerIds = Array.isArray(data?.player_ids) ? data.player_ids.map((item) => String(item)) : [];
    const foundIndex = playerIds.indexOf(this.clientId);
    this.playerId = foundIndex >= 0 ? foundIndex + 1 : 0;
  }

  handleUpdate(payload) {
    if (!this.inGame) {
      return;
    }

    const applied = this.mapState.applyUpdatePayload(payload);
    if (!applied) {
      return;
    }

    const turn = Number.parseInt(String(payload?.turn ?? '-1'), 10);
    if (!Number.isFinite(turn) || turn < 0 || turn === this.lastTurn) {
      return;
    }
    this.lastTurn = turn;

    if (payload?.game_end) {
      this.inGame = false;
      return;
    }

    if (this.playerId <= 0) {
      return;
    }

    const { size, gameMap } = this.mapState.toLegacyMap();

    let move = null;
    try {
      move = this.strategy.getBestMove(gameMap, this.playerId, size);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.error(`[bot] strategy error on turn ${turn}: ${message}`);
      return;
    }

    if (!move) {
      return;
    }

    const attack = this.convertMoveToAttack(move);
    if (!attack || !this.isAttackValid(attack)) {
      return;
    }
    this.socket.emit('attack', attack);
  }

  convertMoveToAttack(move) {
    const fromX = Number.parseInt(String(move?.fromX ?? '-1'), 10) - 1;
    const fromY = Number.parseInt(String(move?.fromY ?? '-1'), 10) - 1;
    const toX = Number.parseInt(String(move?.toX ?? '-1'), 10) - 1;
    const toY = Number.parseInt(String(move?.toY ?? '-1'), 10) - 1;

    if (
      !Number.isFinite(fromX) ||
      !Number.isFinite(fromY) ||
      !Number.isFinite(toX) ||
      !Number.isFinite(toY)
    ) {
      return null;
    }

    return {
      x: fromX,
      y: fromY,
      dx: toX,
      dy: toY,
      half: Boolean(move?.half),
    };
  }

  isAttackValid(attack) {
    const { x, y, dx, dy, half } = attack;

    if (!this.mapState.inBounds(x, y) || !this.mapState.inBounds(dx, dy)) {
      return false;
    }

    if (Math.abs(x - dx) + Math.abs(y - dy) !== 1) {
      return false;
    }

    const fromIdx = this.mapState.indexOfCell(x, y);
    const toIdx = this.mapState.indexOfCell(dx, dy);

    const fromCode = this.mapState.gridType[fromIdx];
    const toCode = this.mapState.gridType[toIdx];
    const fromArmy = this.mapState.armyCnt[fromIdx];

    if (MapState.decodeOwner(fromCode) !== this.playerId) {
      return false;
    }

    if (MapState.isMountainCode(fromCode) || MapState.isMountainCode(toCode) || toCode === 201) {
      return false;
    }

    if (fromArmy <= 1) {
      return false;
    }

    if (half && Math.floor(fromArmy / 2) <= 0) {
      return false;
    }

    return true;
  }
}

module.exports = Bot;
