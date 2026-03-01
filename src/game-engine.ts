import { randomInt } from 'node:crypto';
import {
  GeneralPos,
  Grid,
  MapMode,
  SeededRandom,
  Tile,
  normalizeMapToken,
  resolveMapSeed,
  resolveSeededTerrainRatio,
} from './map/map-core';
import { generateArchipelagoMap } from './map/archipelago-map-generator';
import { generateMazeMap } from './map/maze-map-generator';
import { generateRandomMap } from './map/random-map-generator';
import { ReplayStore } from './replay-store';
import { AFK_MIN_MS, AFK_MIN_TURNS, LEFT_GAME, SURRENDER_FADE_TICKS } from './game-engine/constants';
import {
  clearAdjacentCityTiles,
  selectMazeGenerals,
  selectRandomGenerals,
} from './game-engine/general-selection';
import { buildFinalRank, buildLeaderboard } from './game-engine/leaderboard';
import { buildFullVisionArrays, buildPlayerVisionArrays } from './game-engine/map-encoding';
import { buildReplayPatch, getDiff } from './game-engine/replay-helpers';
import { buildScheduledReplayActions } from './game-engine/replay-scheduling';
import { buildReplayPlayerOps, buildTurnMoves } from './game-engine/replay-turns';
import { applySurrenderFinalize, buildSurrenderProgress } from './game-engine/surrender';
import { applyTickGrowth } from './game-engine/tick-growth';
import {
  ChatScope,
  GameConfig,
  ReplayActionData,
  ReplayData,
  ReplayPatch,
  ReplayMeta,
  UpdatePayload,
} from './types';

type Move = [number, number, number, number, boolean];
interface GameCallbacks {
  update: (sid: string, data: UpdatePayload) => void;
  emitInitMap: (
    sid: string,
    data: { n: number; m: number; player_ids: string[]; general: GeneralPos },
  ) => void;
  chatMessage: (
    id: string,
    scope: ChatScope,
    sender: string,
    color: number,
    text: string,
    team?: boolean,
  ) => void;
  endGame: (gid: string) => void;
  md5: (input: string) => string;
  replayStore: ReplayStore;
}

const clampMapSizeRatio = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0.2, Math.min(1.35, value));
};

const resolveRuntimeMapSizeRatio = (ratio: number, mapSizeVersion: 1 | 2): number => {
  if (mapSizeVersion === 1) {
    return ratio / 2 + 0.5;
  }
  return ratio;
};

export class GameEngine {
  private readonly update: (sid: string, data: UpdatePayload) => void;

  private readonly emitInitMap: GameCallbacks['emitInitMap'];

  private readonly chatMessage: GameCallbacks['chatMessage'];

  private readonly endGame: GameCallbacks['endGame'];

  private readonly md5: GameCallbacks['md5'];

  private readonly replayStore: ReplayStore;

  readonly names: string[];

  private readonly playerSids: string[];

  private readonly playerIds: string[];

  private readonly playerSidToIndex: Map<string, number>;

  private readonly team: number[];

  private readonly widthRatio: number;

  private readonly heightRatio: number;

  private readonly cityRatio: number;

  private readonly mountainRatio: number;

  private readonly swampRatio: number;

  private readonly speed: number;

  private readonly mapToken: string;

  private readonly mapSeed: string;

  private readonly mapMode: MapMode;

  private readonly rng: SeededRandom;

  private readonly replayMeta: ReplayMeta;

  private readonly gid: string;

  private readonly pstat: number[];

  private readonly pmove: Move[][];

  private readonly lstMove: Move[];

  private readonly watching: boolean[];

  private readonly spec: boolean[];

  private readonly gridTypeLast: number[][];

  private readonly armyCntLast: number[][];

  private readonly deadOrder: number[];

  private readonly replayTurnMoves: Array<Array<Move | null>>;

  private readonly replayTurnSurrenders: Array<Set<number>>;

  private readonly externalSpectatorSids: Set<string>;

  private readonly surrenderStartTurn: number[];

  private readonly surrenderFinalized: boolean[];

  private readonly afkLastMoveTurn: number[];

  private readonly afkLastMoveAt: number[];

  private readonly enableAfkSurrender: boolean;

  private readonly startAt: number;

  private owner: Grid<number> = [];

  private armyCnt: Grid<number> = [];

  private gridType: Grid<Tile> = [];

  private st: Grid<boolean> = [];

  private generals: GeneralPos[] = [];

  private n = 0;

  private m = 0;

  private turn = 0;

  private deadCount = 0;

  private recentKills: Record<string, string> = {};

  private tickTimer: NodeJS.Timeout | null = null;

  private lastTickAt = 0;

  private constructor(
    gameConf: GameConfig,
    playerSids: string[],
    playerIds: string[],
    gid: string,
    callbacks: GameCallbacks,
  ) {
    this.startAt = Date.now();
    this.update = callbacks.update;
    this.emitInitMap = callbacks.emitInitMap;
    this.chatMessage = callbacks.chatMessage;
    this.endGame = callbacks.endGame;
    this.md5 = callbacks.md5;
    this.replayStore = callbacks.replayStore;

    this.playerSids = [...playerSids];
    this.playerIds = [...playerIds];
    this.playerSidToIndex = new Map(playerSids.map((sid, idx) => [sid, idx]));

    this.speed = gameConf.speed;
    this.names = [...gameConf.player_names];
    this.team = [...gameConf.player_teams];

    this.mapToken = normalizeMapToken(gameConf.map_token) || 'default';
    this.mapMode = gameConf.map_mode;
    this.mapSeed = resolveMapSeed(this.mapMode, this.mapToken);
    this.rng = new SeededRandom(this.mapSeed);
    const seededCityRatio = resolveSeededTerrainRatio(this.mapSeed, 'city_ratio');
    const seededMountainRatio = resolveSeededTerrainRatio(this.mapSeed, 'mountain_ratio');
    const mapSizeVersion: 1 | 2 = gameConf.map_size_version ?? (gid === '__replay_build__' ? 1 : 2);

    this.widthRatio = clampMapSizeRatio(resolveRuntimeMapSizeRatio(gameConf.width_ratio, mapSizeVersion));
    this.heightRatio = clampMapSizeRatio(resolveRuntimeMapSizeRatio(gameConf.height_ratio, mapSizeVersion));
    this.cityRatio = seededCityRatio;
    this.mountainRatio = seededMountainRatio;
    this.swampRatio = gameConf.swamp_ratio;
    this.replayMeta = {
      width_ratio: gameConf.width_ratio,
      height_ratio: gameConf.height_ratio,
      city_ratio: seededCityRatio,
      mountain_ratio: seededMountainRatio,
      swamp_ratio: gameConf.swamp_ratio,
      speed: gameConf.speed,
      allow_team: gameConf.allow_team,
      map_token: this.mapToken,
      map_mode: gameConf.map_mode,
      player_names: [...gameConf.player_names],
      player_teams: [...gameConf.player_teams],
      map_size_version: mapSizeVersion,
    };

    const pcnt = playerSids.length;
    this.pstat = Array.from({ length: pcnt }, () => 0);
    this.pmove = Array.from({ length: pcnt }, () => []);
    this.lstMove = Array.from({ length: pcnt }, () => [-1, -1, -1, -1, false]);
    this.watching = Array.from({ length: pcnt }, () => true);
    this.spec = Array.from({ length: pcnt }, () => false);
    this.gridTypeLast = Array.from({ length: pcnt }, () => []);
    this.armyCntLast = Array.from({ length: pcnt }, () => []);
    this.deadOrder = Array.from({ length: pcnt }, () => 0);
    this.replayTurnMoves = [];
    this.replayTurnSurrenders = Array.from({ length: pcnt }, () => new Set<number>());
    this.externalSpectatorSids = new Set<string>();
    this.surrenderStartTurn = Array.from({ length: pcnt }, () => -1);
    this.surrenderFinalized = Array.from({ length: pcnt }, () => false);
    this.afkLastMoveTurn = Array.from({ length: pcnt }, () => 0);
    this.afkLastMoveAt = Array.from({ length: pcnt }, () => this.startAt);
    this.enableAfkSurrender = gid !== '__replay_build__';

    this.gid = gid;
  }

  static async create(
    gameConf: GameConfig,
    playerSids: string[],
    playerIds: string[],
    gid: string,
    callbacks: GameCallbacks,
  ): Promise<GameEngine> {
    const engine = new GameEngine(gameConf, playerSids, playerIds, gid, callbacks);
    await engine.initializeMap();
    engine.selectGenerals();

    for (let i = 0; i < playerSids.length; i += 1) {
      callbacks.emitInitMap(playerSids[i], {
        n: engine.n,
        m: engine.m,
        player_ids: [...playerIds],
        general: engine.generals[i],
      });
    }

    return engine;
  }

  static async buildReplayBaseMap(meta: ReplayMeta): Promise<{
    n: number;
    m: number;
    grid_type: number[];
    army_cnt: number[];
  }> {
    const dummyPlayerSids = meta.player_names.map((_, index) => `replay_sid_${index}`);
    const dummyPlayerIds = meta.player_names.map((_, index) => `replay_id_${index}`);

    const engine = new GameEngine(
      {
        ...meta,
        allow_team: meta.allow_team ?? false,
        map_size_version: meta.map_size_version ?? 1,
      },
      dummyPlayerSids,
      dummyPlayerIds,
      '__replay_build__',
      {
        update: () => undefined,
        emitInitMap: () => undefined,
        chatMessage: () => undefined,
        endGame: () => undefined,
        md5: (input) => input,
        replayStore: {
          saveReplay: async () => '',
        } as unknown as ReplayStore,
      },
    );

    await engine.initializeMap();
    engine.selectGenerals();
    const snapshot = engine.buildInitialReplayMapArrays();
    return {
      n: engine.n,
      m: engine.m,
      ...snapshot,
    };
  }

  static async buildReplayFromActions(replay: ReplayActionData): Promise<ReplayData> {
    const dummyPlayerSids = replay.meta.player_names.map((_, index) => `replay_sid_${index}`);
    const dummyPlayerIds = replay.meta.player_names.map((_, index) => `replay_id_${index}`);

    const engine = new GameEngine(
      {
        ...replay.meta,
        allow_team: replay.meta.allow_team ?? false,
        map_size_version: replay.meta.map_size_version ?? 1,
      },
      dummyPlayerSids,
      dummyPlayerIds,
      '__replay_build__',
      {
        update: () => undefined,
        emitInitMap: () => undefined,
        chatMessage: () => undefined,
        endGame: () => undefined,
        md5: (input) => input,
        replayStore: {
          saveReplay: async () => '',
        } as unknown as ReplayStore,
      },
    );

    await engine.initializeMap();
    engine.selectGenerals();

    const { scheduledMoves, scheduledSurrenders } = buildScheduledReplayActions(replay);

    const initial = engine.buildReplayFrame(false);
    let prevFrame = initial;
    const patches: ReplayPatch[] = [];
    while (engine.turn < replay.total_turns) {
      const nextTurn = engine.turn + 1;
      for (let p = 0; p < scheduledSurrenders.length; p += 1) {
        if (!scheduledSurrenders[p].has(nextTurn)) {
          continue;
        }
        engine.surrender(engine.playerSids[p]);
      }
      for (let p = 0; p < scheduledMoves.length; p += 1) {
        const move = scheduledMoves[p].get(nextTurn);
        if (!move) {
          continue;
        }
        engine.addMove(engine.playerSids[p], move[0], move[1], move[2], move[3], move[4]);
      }

      const gameEnd = await engine.gameTick();
      const isFinalFrame = gameEnd || engine.turn >= replay.total_turns;
      const nextFrame = engine.buildReplayFrame(isFinalFrame);
      patches.push(buildReplayPatch(prevFrame, nextFrame));
      prevFrame = nextFrame;
      if (gameEnd) {
        break;
      }
    }

    if (patches.length === 0) {
      initial.game_end = true;
    }

    return {
      n: engine.n,
      m: engine.m,
      meta: replay.meta,
      initial,
      patches,
    };
  }

  startGame(): void {
    const delay = Math.max(10, this.startAt + 2000 - Date.now());
    this.tickTimer = setTimeout(() => {
      void this.beginLoop();
    }, delay);
  }

  private async beginLoop(): Promise<void> {
    this.lastTickAt = Date.now();
    this.initAfkTracking(this.lastTickAt);
    await this.sendMap(false);
    this.scheduleNextTick();
  }

  private initAfkTracking(nowMs: number): void {
    for (let p = 0; p < this.playerSids.length; p += 1) {
      if (this.team[p] === 0 || this.pstat[p] === LEFT_GAME) {
        continue;
      }
      this.afkLastMoveTurn[p] = this.turn;
      this.afkLastMoveAt[p] = nowMs;
    }
  }

  private scheduleNextTick(): void {
    const elapsed = Date.now() - this.lastTickAt;
    const delay = Math.max(10, 500 / this.speed - elapsed);
    this.tickTimer = setTimeout(() => {
      void this.tickOnce();
    }, delay);
  }

  private async tickOnce(): Promise<void> {
    this.lastTickAt = Date.now();
    const ended = await this.gameTick();
    if (ended) {
      this.finishGame();
      return;
    }
    this.scheduleNextTick();
  }

  private async initializeMap(): Promise<void> {
    const requiredPlayers = this.team.filter((team) => team !== 0).length;
    let generated;
    if (this.mapMode === 'maze') {
      generated = generateMazeMap(this.rng, {
        widthRatio: this.widthRatio,
        heightRatio: this.heightRatio,
        cityRatio: this.cityRatio,
        mountainRatio: this.mountainRatio,
        swampRatio: this.swampRatio,
      });
    } else if (this.mapMode === 'archipelago') {
      generated = generateArchipelagoMap(this.rng, {
        widthRatio: this.widthRatio,
        heightRatio: this.heightRatio,
        cityRatio: this.cityRatio,
        mountainRatio: this.mountainRatio,
        swampRatio: this.swampRatio,
        requiredPlayers,
      });
    } else {
      generated = generateRandomMap(this.rng, {
        widthRatio: this.widthRatio,
        heightRatio: this.heightRatio,
        cityRatio: this.cityRatio,
        mountainRatio: this.mountainRatio,
        swampRatio: this.swampRatio,
      });
    }

    this.n = generated.n;
    this.m = generated.m;
    this.owner = generated.owner;
    this.armyCnt = generated.armyCnt;
    this.gridType = generated.gridType;
    this.st = generated.st;
  }

  private selectGenerals(): void {
    const requiredPlayers = this.team.filter((team) => team !== 0).length;
    const selected =
      this.mapMode === 'maze'
        ? selectMazeGenerals(
            {
              n: this.n,
              m: this.m,
              st: this.st,
              gridType: this.gridType,
              rng: this.rng,
            },
            requiredPlayers,
          )
        : selectRandomGenerals(
            {
              n: this.n,
              m: this.m,
              st: this.st,
              gridType: this.gridType,
              rng: this.rng,
            },
            requiredPlayers,
          );

    for (let i = 0; i < this.n; i += 1) {
      for (let j = 0; j < this.m; j += 1) {
        if (this.st[i][j] && this.gridType[i][j] === -2) {
          this.gridType[i][j] = 0;
          this.owner[i][j] = 0;
          this.armyCnt[i][j] = 0;
        }
      }
    }

    this.generals = Array.from({ length: this.playerSids.length }, () => [-1, -1]);
    let cursor = 0;
    for (let i = 0; i < this.playerSids.length; i += 1) {
      if (this.team[i] === 0) {
        this.pstat[i] = LEFT_GAME;
        continue;
      }
      const picked = selected[cursor];
      if (!picked || (picked[0] === -1 && picked[1] === -1)) {
        this.pstat[i] = LEFT_GAME;
      } else {
        this.generals[i] = [picked[0], picked[1]];
        this.gridType[picked[0]][picked[1]] = -2;
        this.owner[picked[0]][picked[1]] = i + 1;
        this.armyCnt[picked[0]][picked[1]] = 1;
        if (this.mapMode === 'maze') {
          clearAdjacentCityTiles(
            picked[0],
            picked[1],
            this.n,
            this.m,
            this.gridType,
            this.owner,
            this.armyCnt,
          );
        }
      }
      cursor += 1;
    }
  }

  private chkxy(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.n && y < this.m;
  }

  private buildLeaderboard() {
    return buildLeaderboard({
      n: this.n,
      m: this.m,
      owner: this.owner,
      armyCnt: this.armyCnt,
      playerSidsLength: this.playerSids.length,
      names: this.names,
      team: this.team,
      pstat: this.pstat,
      deadOrder: this.deadOrder,
      leftGameValue: LEFT_GAME,
    });
  }

  private buildInitialReplayMapArrays(): { grid_type: number[]; army_cnt: number[] } {
    return buildFullVisionArrays({
      n: this.n,
      m: this.m,
      gridType: this.gridType,
      owner: this.owner,
      armyCnt: this.armyCnt,
    });
  }

  private buildReplayFrame(gameEnd: boolean): UpdatePayload {
    const snapshot = this.buildInitialReplayMapArrays();
    return {
      grid_type: snapshot.grid_type,
      army_cnt: snapshot.army_cnt,
      lst_move: { x: -1, y: -1, dx: -1, dy: -1, half: false },
      leaderboard: this.buildLeaderboard(),
      turn: this.turn,
      kills: {},
      surrender_progress: this.buildSurrenderProgress(),
      game_end: gameEnd,
      is_diff: false,
    };
  }

  private recordReplayTurnMoves(): void {
    this.replayTurnMoves.push(buildTurnMoves(this.lstMove));
  }

  private buildReplayPlayerOps() {
    return buildReplayPlayerOps(this.playerSids.length, this.replayTurnMoves, this.replayTurnSurrenders);
  }

  private buildFinalRank(): string[] {
    return buildFinalRank(this.buildLeaderboard());
  }

  private async sendMap(stat: boolean): Promise<void> {
    let historyHash: string | undefined;

    const kills = this.recentKills;
    this.recentKills = {};
    const leaderboard = this.buildLeaderboard();
    const surrenderProgress = this.buildSurrenderProgress();

    for (let p = -1; p < this.playerSids.length; p += 1) {
      if (p !== -1 && !this.watching[p]) {
        continue;
      }
      const snapshot =
        p === -1
          ? buildFullVisionArrays({
              n: this.n,
              m: this.m,
              gridType: this.gridType,
              owner: this.owner,
              armyCnt: this.armyCnt,
            })
          : buildPlayerVisionArrays({
              n: this.n,
              m: this.m,
              gridType: this.gridType,
              owner: this.owner,
              armyCnt: this.armyCnt,
              viewerTeam: this.team[p],
              playerTeams: this.team,
              forceFullVision: stat || this.team[p] === 0 || this.spec[p],
            });

      const tmp: Move = p === -1 ? [-1, -1, -1, -1, false] : this.lstMove[p];
      const fullSnapshot = stat || p === -1 || this.turn % 50 === 0 || randomInt(51) === 0;

      const payload: UpdatePayload = fullSnapshot
        ? {
            grid_type: snapshot.grid_type,
            army_cnt: snapshot.army_cnt,
            lst_move: { x: tmp[0], y: tmp[1], dx: tmp[2], dy: tmp[3], half: tmp[4] },
            leaderboard,
            turn: this.turn,
            kills,
            surrender_progress: surrenderProgress,
            game_end: stat,
            is_diff: false,
          }
        : {
            grid_type: getDiff(snapshot.grid_type, this.gridTypeLast[p]),
            army_cnt: getDiff(snapshot.army_cnt, this.armyCntLast[p]),
            lst_move: { x: tmp[0], y: tmp[1], dx: tmp[2], dy: tmp[3], half: tmp[4] },
            leaderboard,
            turn: this.turn,
            kills,
            surrender_progress: surrenderProgress,
            game_end: stat,
            is_diff: true,
          };

      if (historyHash) {
        payload.replay = historyHash;
      }

      if (p !== -1) {
        this.gridTypeLast[p] = snapshot.grid_type;
        this.armyCntLast[p] = snapshot.army_cnt;
        this.lstMove[p] = [-1, -1, -1, -1, false];
        this.update(this.playerSids[p], payload);
      } else {
        if (stat) {
          historyHash = await this.saveHistory();
          payload.replay = historyHash;
        }
        for (const spectatorSid of this.externalSpectatorSids) {
          this.update(spectatorSid, payload);
        }
      }
    }
  }

  private buildFullVisionPayload(gameEnd: boolean): UpdatePayload {
    const snapshot = buildFullVisionArrays({
      n: this.n,
      m: this.m,
      gridType: this.gridType,
      owner: this.owner,
      armyCnt: this.armyCnt,
    });

    return {
      grid_type: snapshot.grid_type,
      army_cnt: snapshot.army_cnt,
      lst_move: { x: -1, y: -1, dx: -1, dy: -1, half: false },
      leaderboard: this.buildLeaderboard(),
      turn: this.turn,
      kills: {},
      surrender_progress: this.buildSurrenderProgress(),
      game_end: gameEnd,
      is_diff: false,
    };
  }

  addMove(playerSid: string, x: number, y: number, dx: number, dy: number, half: boolean): void {
    const player = this.playerSidToIndex.get(playerSid);
    if (typeof player === 'undefined') {
      return;
    }
    if (this.pstat[player] === LEFT_GAME) {
      return;
    }
    this.pmove[player].push([x, y, dx, dy, half]);
  }

  clearQueue(playerSid: string): void {
    const player = this.playerSidToIndex.get(playerSid);
    if (typeof player === 'undefined') {
      return;
    }
    this.pmove[player] = [];
  }

  popQueue(playerSid: string): void {
    const player = this.playerSidToIndex.get(playerSid);
    if (typeof player === 'undefined') {
      return;
    }
    if (this.pmove[player].length > 0) {
      this.pmove[player].pop();
    }
  }

  addSpectator(sid: string): void {
    if (this.externalSpectatorSids.has(sid)) {
      return;
    }
    this.externalSpectatorSids.add(sid);
    this.emitInitMap(sid, {
      n: this.n,
      m: this.m,
      player_ids: [...this.playerIds],
      general: [-1, -1],
    });
    this.update(sid, this.buildFullVisionPayload(false));
  }

  removeSpectator(sid: string): void {
    this.externalSpectatorSids.delete(sid);
  }

  sendMessage(sid: string, data: { text: string; team: boolean }): void {
    const id = this.playerSidToIndex.get(sid);
    if (typeof id === 'undefined') {
      return;
    }
    const text = data.text.trim();
    if (text.length === 0) {
      return;
    }
    const uid = this.names[id];
    if (data.team) {
      for (let i = 0; i < this.playerSids.length; i += 1) {
        if (this.team[i] === this.team[id]) {
          this.chatMessage(this.playerSids[i], 'sid', uid, id + 1, text, true);
        }
      }
      return;
    }

    this.chatMessage(this.gid, 'room', uid, id + 1, text);
  }

  private sendSystemMessage(text: string): void {
    this.chatMessage(this.gid, 'room', '', 0, text);
  }

  private markEliminated(playerIndex: number): void {
    if (this.pstat[playerIndex] !== LEFT_GAME) {
      this.pstat[playerIndex] = LEFT_GAME;
      this.deadCount += 1;
      this.deadOrder[playerIndex] = this.deadCount;
    }
    this.spec[playerIndex] = true;
  }

  private kill(attacker: number, victim: number): void {
    for (let i = 0; i < this.n; i += 1) {
      for (let j = 0; j < this.m; j += 1) {
        if (this.owner[i][j] === victim) {
          this.owner[i][j] = attacker;
          this.armyCnt[i][j] = Math.floor((this.armyCnt[i][j] + 1) / 2);
          if (this.gridType[i][j] === -2) {
            this.gridType[i][j] = -1;
          }
        }
      }
    }

    this.markEliminated(victim - 1);
    this.surrenderStartTurn[victim - 1] = -1;
    this.surrenderFinalized[victim - 1] = true;

    if (attacker > 0 && victim > 0) {
      this.recentKills[this.md5(this.playerSids[victim - 1])] = this.names[attacker - 1];
      this.sendSystemMessage(`${this.names[attacker - 1]} 击败并接管了 ${this.names[victim - 1]}。`);
    } else if (victim > 0) {
      this.recentKills[this.md5(this.playerSids[victim - 1])] = '系统';
    }
  }

  private chkMove(x: number, y: number, dx: number, dy: number, p: number): boolean {
    return (
      this.chkxy(x, y) &&
      this.chkxy(dx, dy) &&
      Math.abs(x - dx) + Math.abs(y - dy) === 1 &&
      this.owner[x][y] === p + 1 &&
      this.armyCnt[x][y] > 0 &&
      this.gridType[dx][dy] !== 1
    );
  }

  private attack(x: number, y: number, dx: number, dy: number, half: boolean): void {
    let cnt = this.armyCnt[x][y] - 1;
    if (half) {
      cnt = Math.floor(cnt / 2);
    }

    this.armyCnt[x][y] -= cnt;

    if (this.owner[dx][dy] === this.owner[x][y]) {
      this.armyCnt[dx][dy] += cnt;
      return;
    }

    if (
      this.owner[dx][dy] > 0 &&
      this.owner[x][y] > 0 &&
      this.team[this.owner[dx][dy] - 1] === this.team[this.owner[x][y] - 1]
    ) {
      this.armyCnt[dx][dy] += cnt;
      if (this.gridType[dx][dy] !== -2) {
        this.owner[dx][dy] = this.owner[x][y];
      }
      return;
    }

    if (cnt <= this.armyCnt[dx][dy]) {
      this.armyCnt[dx][dy] -= cnt;
      return;
    }

    const left = cnt - this.armyCnt[dx][dy];
    if (this.gridType[dx][dy] === -2) {
      this.kill(this.owner[x][y], this.owner[dx][dy]);
      this.gridType[dx][dy] = -1;
    }
    this.armyCnt[dx][dy] = left;
    this.owner[dx][dy] = this.owner[x][y];
  }

  private async gameTick(): Promise<boolean> {
    this.turn += 1;
    const nowMs = Date.now();

    applyTickGrowth({
      turn: this.turn,
      n: this.n,
      m: this.m,
      gridType: this.gridType,
      owner: this.owner,
      armyCnt: this.armyCnt,
      pstat: this.pstat,
      leftGameValue: LEFT_GAME,
    });

    for (let p = 0; p < this.playerSids.length; p += 1) {
      if (this.pstat[p] !== 0) {
        this.pstat[p] = Math.min(this.pstat[p] + 1, LEFT_GAME);
        if (this.pstat[p] === LEFT_GAME - 1) {
          this.kill(0, p + 1);
        }
      }
    }

    const order = Array.from({ length: this.playerSids.length }, (_, i) => i);
    if (this.turn % 2 === 1) {
      order.reverse();
    }

    const movedThisTurn = Array.from({ length: this.playerSids.length }, () => false);
    for (const p of order) {
      if (this.pstat[p] === LEFT_GAME) {
        continue;
      }
      while (this.pmove[p].length > 0) {
        const move = this.pmove[p].shift();
        if (!move) {
          continue;
        }
        const [x, y, dx, dy, half] = move;
        if (!this.chkMove(x, y, dx, dy, p)) {
          continue;
        }
        this.attack(x, y, dx, dy, half);
        this.lstMove[p] = [x, y, dx, dy, half];
        movedThisTurn[p] = true;
        break;
      }
    }

    for (let p = 0; p < movedThisTurn.length; p += 1) {
      if (!movedThisTurn[p]) {
        continue;
      }
      this.afkLastMoveTurn[p] = this.turn;
      this.afkLastMoveAt[p] = nowMs;
    }
    this.applyAfkSurrender(nowMs);
    this.applySurrenderFinalize();

    const aliveTeams: Record<number, true> = {};
    for (const p of order) {
      if (this.pstat[p] !== LEFT_GAME) {
        aliveTeams[this.team[p]] = true;
      }
    }

    const gameEnd = Object.keys(aliveTeams).length <= 1;
    this.recordReplayTurnMoves();
    await this.sendMap(gameEnd);
    return gameEnd;
  }

  leaveGame(sid: string): void {
    const id = this.playerSidToIndex.get(sid);
    if (typeof id === 'undefined') {
      return;
    }
    if (this.pstat[id] !== LEFT_GAME) {
      this.kill(0, id + 1);
    }
    this.pmove[id] = [];
    this.watching[id] = false;
    this.sendSystemMessage(`${this.names[id]} 离开了游戏。`);
    this.scheduleImmediateTick();
  }

  surrender(sid: string): void {
    const id = this.playerSidToIndex.get(sid);
    if (typeof id === 'undefined') {
      return;
    }
    const changed = this.applySurrenderByIndex(id, '投降');
    if (!changed) {
      return;
    }
    this.sendSystemMessage(`${this.names[id]} 投降并转为观战。`);
    this.scheduleImmediateTick();
  }

  private applyAfkSurrender(nowMs: number): void {
    if (!this.enableAfkSurrender) {
      return;
    }
    for (let p = 0; p < this.playerSids.length; p += 1) {
      if (this.team[p] === 0 || this.pstat[p] === LEFT_GAME) {
        continue;
      }
      const idleTurns = this.turn - this.afkLastMoveTurn[p];
      const idleMs = nowMs - this.afkLastMoveAt[p];
      if (idleTurns < AFK_MIN_TURNS || idleMs < AFK_MIN_MS) {
        continue;
      }
      if (!this.applySurrenderByIndex(p, '挂机')) {
        continue;
      }
      this.sendSystemMessage(`${this.names[p]} 因挂机自动投降并转为观战。`);
    }
  }

  private applySurrenderByIndex(playerIndex: number, reason: '投降' | '挂机'): boolean {
    if (this.pstat[playerIndex] === LEFT_GAME) {
      return false;
    }
    this.replayTurnSurrenders[playerIndex].add(this.turn + 1);
    this.markEliminated(playerIndex);
    this.surrenderStartTurn[playerIndex] = this.turn + 1;
    this.surrenderFinalized[playerIndex] = false;
    this.recentKills[this.md5(this.playerSids[playerIndex])] = reason;
    this.pmove[playerIndex] = [];
    return true;
  }

  private applySurrenderFinalize(): void {
    applySurrenderFinalize({
      turn: this.turn,
      fadeTicks: SURRENDER_FADE_TICKS,
      playerCount: this.playerSids.length,
      n: this.n,
      m: this.m,
      owner: this.owner,
      armyCnt: this.armyCnt,
      gridType: this.gridType,
      surrenderStartTurn: this.surrenderStartTurn,
      surrenderFinalized: this.surrenderFinalized,
    });
  }

  private buildSurrenderProgress(): Record<number, number> {
    return buildSurrenderProgress({
      turn: this.turn,
      fadeTicks: SURRENDER_FADE_TICKS,
      playerCount: this.playerSids.length,
      surrenderStartTurn: this.surrenderStartTurn,
      surrenderFinalized: this.surrenderFinalized,
    });
  }

  private scheduleImmediateTick(): void {
    if (!this.tickTimer) {
      return;
    }
    clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => {
      void this.tickOnce();
    }, 10);
  }

  private async saveHistory(): Promise<string> {
    const replayId = await this.replayStore.saveReplay(
      {
        version: 'ops-v1',
        meta: this.replayMeta,
        total_turns: this.turn,
        player_ops: this.buildReplayPlayerOps(),
      },
      {
        rank: this.buildFinalRank(),
        turn: Math.floor(this.turn / 2),
      },
    );
    return replayId;
  }

  private finishGame(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    let winners = '';
    for (let p = 0; p < this.playerSids.length; p += 1) {
      if (this.pstat[p] !== LEFT_GAME) {
        winners += winners.length > 0 ? `,${this.names[p]}` : this.names[p];
      }
    }
    if (winners.length > 0) {
      this.sendSystemMessage(`${winners} 获胜。`);
    } else {
      this.sendSystemMessage('本局结束，无人获胜。');
    }
    this.endGame(this.gid);
  }
}
