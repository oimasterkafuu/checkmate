import { createHash, randomBytes } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { GameEngine } from '../game-engine';
import { ReplayStore } from '../replay-store';
import {
  ChatScope,
  GameConfig,
  LobbyConfig,
  LobbyPlayer,
  MAX_TEAMS,
  RoomListItem,
  RoomUpdatePayload,
} from '../types';

type EditableLobbyKey = 'speed' | 'allow_team' | 'map_mode' | 'map_token';

const FIXED_WIDTH_RATIO = 0.5;
const FIXED_HEIGHT_RATIO = 0.5;
const FIXED_CITY_RATIO = 0.5;
const FIXED_MOUNTAIN_RATIO = 0.5;
const FIXED_SWAMP_RATIO = 0;
const MAP_TOKEN_MAX_LENGTH = 32;

const confStr: Record<EditableLobbyKey, string> = {
  speed: '游戏速度',
  allow_team: '允许组队',
  map_mode: '地图类型',
  map_token: '地图随机种子',
};

class LobbyService {
  readonly gameUid = new Map<string, string>();
  readonly gameInstances = new Map<string, GameEngine>();
  readonly gameLobbyId = new Map<string, string>();
  readonly gamePlayers = new Map<string, Set<string>>();

  readonly lobbyRoomValue = new Map<string, string>();
  readonly lobbyOfSid = new Map<string, string>();
  readonly lobbyConfig = new Map<string, LobbyConfig>();
  readonly lobbyPlayers = new Map<string, LobbyPlayer[]>();

  constructor(private readonly replayStore: ReplayStore) {}

  md5(input: string): string {
    return createHash('md5').update(input, 'utf-8').digest('hex');
  }

  randomHexToken(): string {
    return randomBytes(16).toString('hex');
  }

  normalizeMapToken(value: unknown, fallback?: string): string {
    const token = String(value ?? '')
      .trim()
      .slice(0, MAP_TOKEN_MAX_LENGTH);
    if (token.length > 0) {
      return token;
    }
    return String(fallback ?? this.randomHexToken())
      .trim()
      .slice(0, MAP_TOKEN_MAX_LENGTH);
  }

  randomRoomId(): string {
    return Array.from({ length: 4 }, () =>
      String.fromCharCode('a'.charCodeAt(0) + Math.floor(Math.random() * 26)),
    ).join('');
  }

  isLobbyGameRunning(gid: string): boolean {
    return this.gameInstances.has(this.getLobbyVal(gid));
  }

  getLobbyVal(gid: string): string {
    let value = this.lobbyRoomValue.get(gid);
    if (!value) {
      value = this.md5(`${gid}:${Date.now()}:${Math.random()}`);
      this.lobbyRoomValue.set(gid, value);
    }
    return value;
  }

  joinLobby(sid: string, uid: string, gid: string): void {
    this.lobbyOfSid.set(sid, gid);
    const existingPlayers = this.lobbyPlayers.get(gid);
    const isNewRoom = !existingPlayers || existingPlayers.length === 0;

    if (isNewRoom) {
      this.lobbyConfig.set(gid, this.defaultLobbyConfig());
    }
    if (!this.lobbyPlayers.has(gid)) {
      this.lobbyPlayers.set(gid, []);
    }

    const players = this.lobbyPlayers.get(gid);
    const conf = this.lobbyConfig.get(gid);
    if (!players || !conf) {
      return;
    }

    const playingCount = players.filter((player) => player.team !== 0).length;
    let targetTeam = 0;

    if (playingCount < MAX_TEAMS) {
      if (!conf.allow_team) {
        targetTeam = 1;
      } else {
        const teamCount = Array.from({ length: MAX_TEAMS + 1 }, () => 0);
        for (const player of players) {
          teamCount[player.team] += 1;
        }

        let minCount = Number.POSITIVE_INFINITY;
        targetTeam = 1;
        for (let i = 1; i <= MAX_TEAMS; i += 1) {
          if (teamCount[i] < minCount) {
            minCount = teamCount[i];
            targetTeam = i;
          }
        }
      }
    }

    players.push({ sid, uid, team: targetTeam, ready: false });
  }

  leaveLobby(sid: string, gid: string): string {
    const players = this.lobbyPlayers.get(gid);
    if (!players) {
      return '';
    }
    const index = players.findIndex((player) => player.sid === sid);
    if (index === -1) {
      return '';
    }
    const [removed] = players.splice(index, 1);
    return removed.uid;
  }

  generateRoomConfig(gid: string): RoomUpdatePayload {
    this.enforceLobbyConstraints(gid);

    const conf = this.lobbyConfig.get(gid);
    const players = this.lobbyPlayers.get(gid) ?? [];
    if (!conf) {
      throw new Error(`Missing lobby config for room: ${gid}`);
    }
    const normalizedMapToken = this.normalizeMapToken(conf.map_token);
    if (normalizedMapToken !== conf.map_token) {
      conf.map_token = normalizedMapToken;
      this.lobbyConfig.set(gid, conf);
    }

    const need = this.getReq(players);
    if (need <= 1) {
      for (const player of players) {
        player.ready = false;
      }
    }

    const roomPlayers = players.map((player) => ({
      sid: this.md5(player.sid),
      uid: player.uid,
      team: player.team,
      ready: Boolean(player.ready && player.team !== 0),
    }));

    const ready = players.filter((player) => player.ready && player.team !== 0).length;

    return {
      speed: conf.speed,
      allow_team: conf.allow_team,
      map_token: conf.map_token,
      map_mode: conf.map_mode,
      in_game: this.isLobbyGameRunning(gid),
      players: roomPlayers,
      ready,
      need,
    };
  }

  listLobbyRooms(): RoomListItem[] {
    const rooms: RoomListItem[] = [];

    for (const [room, players] of this.lobbyPlayers.entries()) {
      if (players.length === 0) {
        continue;
      }

      const playing = players.filter((player) => player.team !== 0).length;
      const ready = players.filter((player) => player.ready && player.team !== 0).length;

      rooms.push({
        room,
        host: players[0]?.uid ?? '',
        total: players.length,
        playing,
        spectators: players.length - playing,
        ready,
        need: this.getReq(players),
      });
    }

    rooms.sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.room.localeCompare(b.room);
    });
    return rooms;
  }

  sendSystemMessage(
    io: SocketIOServer,
    id: string,
    scope: ChatScope,
    sender: string,
    color: number,
    text: string,
    team = false,
  ): void {
    const target = scope === 'room' ? `game_${id}` : `sid_${id}`;
    io.to(target).emit('chat_message', { sender, color, text, team });
  }

  sendLobbySystemMessage(io: SocketIOServer, gid: string, text: string): void {
    this.sendSystemMessage(io, gid, 'room', '', 0, text);
  }

  parseFloatRange(value: unknown, min: number, max: number): number {
    const parsed = Number.parseFloat(String(value));
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      throw new Error('Invalid number range.');
    }
    return parsed;
  }

  formatConfValue(key: EditableLobbyKey, value: LobbyConfig[EditableLobbyKey]): string {
    if (key === 'allow_team') {
      return value ? '允许' : '不允许';
    }
    if (key === 'map_mode') {
      return value === 'maze' ? '峡谷回廊' : '标准地图';
    }
    return String(value);
  }

  formatConfLabel(key: EditableLobbyKey): string {
    return confStr[key];
  }

  emitRoomUpdate(io: SocketIOServer, gid: string): void {
    io.to(`game_${this.getLobbyVal(gid)}`).emit('room_update', this.generateRoomConfig(gid));
  }

  async startGame(io: SocketIOServer, lobbyId: string): Promise<void> {
    const conf = this.lobbyConfig.get(lobbyId);
    const players = this.lobbyPlayers.get(lobbyId);
    if (!conf || !players || players.length === 0) {
      return;
    }
    const gameId = this.getLobbyVal(lobbyId);
    if (this.gameInstances.has(gameId)) {
      return;
    }

    const playerSids = players.map((player) => player.sid);
    const playerIds = players.map((player) => this.md5(player.sid));
    const playerNames = players.map((player) => player.uid);
    const activePlayers = new Set<string>();
    for (const player of players) {
      player.ready = false;
      if (player.team !== 0) {
        this.gameUid.set(player.sid, gameId);
        activePlayers.add(player.sid);
      } else {
        this.gameUid.delete(player.sid);
      }
    }

    let autoTeamId = 1;
    const playerTeams = players.map((player) => {
      if (player.team === 0) {
        return 0;
      }
      if (conf.allow_team) {
        return player.team;
      }
      const teamId = autoTeamId;
      autoTeamId += 1;
      return teamId;
    });

    const gameConf: GameConfig = {
      ...conf,
      ...this.getMapSizeConfigByPlayers(players),
      player_names: playerNames,
      player_teams: playerTeams,
    };

    io.to(`game_${gameId}`).emit('starting', {});
    this.emitRoomUpdate(io, lobbyId);

    const game = await GameEngine.create(gameConf, playerSids, playerIds, gameId, {
      update: (sid, data) => {
        io.to(`sid_${sid}`).emit('update', data);
      },
      emitInitMap: (sid, data) => {
        io.to(`sid_${sid}`).emit('init_map', data);
      },
      chatMessage: (id, scope, sender, color, text, team = false) => {
        this.sendSystemMessage(io, id, scope, sender, color, text, team);
      },
      endGame: (gid) => {
        const lobby = this.gameLobbyId.get(gid);
        const participants = this.gamePlayers.get(gid);
        if (participants) {
          for (const sid of participants) {
            this.gameUid.delete(sid);
          }
        }
        this.gamePlayers.delete(gid);
        this.gameLobbyId.delete(gid);
        this.gameInstances.delete(gid);

        if (lobby) {
          const lobbyConf = this.lobbyConfig.get(lobby);
          if (lobbyConf) {
            lobbyConf.map_token = this.normalizeMapToken(this.randomHexToken());
            this.lobbyConfig.set(lobby, lobbyConf);
          }
          const lobbyMembers = this.lobbyPlayers.get(lobby);
          if (lobbyMembers) {
            for (const member of lobbyMembers) {
              member.ready = false;
            }
          }
          this.emitRoomUpdate(io, lobby);
        }
      },
      md5: (input: string): string => this.md5(input),
      replayStore: this.replayStore,
    });

    game.startGame();
    this.gameInstances.set(gameId, game);
    this.gameLobbyId.set(gameId, lobbyId);
    this.gamePlayers.set(gameId, activePlayers);
  }

  checkReady(io: SocketIOServer, gid: string): void {
    const players = this.lobbyPlayers.get(gid);
    if (!players) {
      return;
    }
    if (this.isLobbyGameRunning(gid)) {
      this.emitRoomUpdate(io, gid);
      return;
    }

    const ready = players.filter((player) => player.ready && player.team !== 0).length;
    const required = this.getReq(players);
    if (required <= 1) {
      for (const player of players) {
        player.ready = false;
      }
      this.emitRoomUpdate(io, gid);
      return;
    }

    if (required > 0 && ready >= required) {
      void this.startGame(io, gid);
      return;
    }

    this.emitRoomUpdate(io, gid);
  }

  checkLeave(io: SocketIOServer, sid: string, leaveRoom: (room: string) => void): void {
    const lobbyId = this.lobbyOfSid.get(sid);
    const gameId = this.gameUid.get(sid);

    if (gameId) {
      this.gameUid.delete(sid);
      this.gamePlayers.get(gameId)?.delete(sid);
      this.gameInstances.get(gameId)?.leaveGame(sid);
    }
    if (lobbyId) {
      this.gameInstances.get(this.getLobbyVal(lobbyId))?.removeSpectator(sid);
    }

    if (!lobbyId) {
      return;
    }

    this.lobbyOfSid.delete(sid);
    const roomVal = this.getLobbyVal(lobbyId);
    leaveRoom(`game_${roomVal}`);

    const uid = this.leaveLobby(sid, lobbyId);
    this.emitRoomUpdate(io, lobbyId);
    if (uid) {
      this.sendLobbySystemMessage(io, roomVal, `${uid} 离开了自定义房间。`);
    }
    this.checkReady(io, lobbyId);
  }

  returnToRoom(io: SocketIOServer, sid: string): boolean {
    const lobbyId = this.lobbyOfSid.get(sid);
    if (lobbyId) {
      this.gameInstances.get(this.getLobbyVal(lobbyId))?.removeSpectator(sid);
    }

    const gameId = this.gameUid.get(sid);
    if (!gameId) {
      if (lobbyId) {
        this.emitRoomUpdate(io, lobbyId);
        return true;
      }
      return false;
    }
    this.gameUid.delete(sid);
    this.gamePlayers.get(gameId)?.delete(sid);
    this.gameInstances.get(gameId)?.leaveGame(sid);
    if (lobbyId) {
      this.emitRoomUpdate(io, lobbyId);
    }
    return true;
  }

  private defaultLobbyConfig(): LobbyConfig {
    return {
      width_ratio: FIXED_WIDTH_RATIO,
      height_ratio: FIXED_HEIGHT_RATIO,
      city_ratio: FIXED_CITY_RATIO,
      mountain_ratio: FIXED_MOUNTAIN_RATIO,
      swamp_ratio: FIXED_SWAMP_RATIO,
      speed: 1,
      allow_team: false,
      map_token: this.normalizeMapToken(this.randomHexToken()),
      map_mode: 'random',
    };
  }

  private enforceLobbyConstraints(gid: string): void {
    const conf = this.lobbyConfig.get(gid);
    const players = this.lobbyPlayers.get(gid);
    if (!conf || !players) {
      return;
    }

    let playingCount = 0;
    for (const player of players) {
      if (player.team === 0) {
        continue;
      }
      if (playingCount >= MAX_TEAMS) {
        player.team = 0;
        player.ready = false;
        continue;
      }
      if (!conf.allow_team) {
        player.team = 1;
      }
      playingCount += 1;
    }
  }

  private getReqReady(x: number): number {
    return x - Math.floor(x * 0.3);
  }

  private getPlayingCount(players: LobbyPlayer[]): number {
    return players.filter((player) => player.team !== 0).length;
  }

  private getMapSizeRatioByPlayers(players: LobbyPlayer[]): number {
    const playingCount = this.getPlayingCount(players);
    const ratio = 0.2 + (playingCount - 4) * 0.04;
    return Math.max(0.4, Math.min(1, ratio));
  }

  private getMapSizeConfigByPlayers(
    players: LobbyPlayer[],
  ): Pick<LobbyConfig, 'width_ratio' | 'height_ratio'> {
    const ratio = this.getMapSizeRatioByPlayers(players);
    return {
      width_ratio: ratio,
      height_ratio: ratio,
    };
  }

  private getReq(players: LobbyPlayer[]): number {
    const playingCount = this.getPlayingCount(players);
    if (playingCount < 2) {
      return 0;
    }
    return this.getReqReady(playingCount);
  }
}

export { LobbyService };
export type { EditableLobbyKey };
