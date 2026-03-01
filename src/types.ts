export const MAX_TEAMS = 16;

export type ChatScope = 'room' | 'sid';

export interface LobbyConfig {
  width_ratio: number;
  height_ratio: number;
  city_ratio: number;
  mountain_ratio: number;
  swamp_ratio: number;
  speed: number;
  allow_team: boolean;
  map_token: string;
  map_mode: 'random' | 'maze';
}

export interface LobbyPlayer {
  sid: string;
  uid: string;
  team: number;
  ready: boolean;
}

export interface RoomPlayerView {
  sid: string;
  uid: string;
  team: number;
  ready: boolean;
}

export interface RoomUpdatePayload {
  speed: number;
  allow_team: boolean;
  map_token: string;
  map_mode: 'random' | 'maze';
  in_game: boolean;
  players: RoomPlayerView[];
  ready: number;
  need: number;
}

export interface MovePayload {
  x: number;
  y: number;
  dx: number;
  dy: number;
  half: boolean;
}

export interface LeaderboardEntry {
  team: number;
  uid: string;
  army: number;
  land: number;
  class_: string;
  dead: number;
  id: number;
}

export interface UpdatePayload {
  grid_type: number[];
  army_cnt: number[];
  lst_move: MovePayload;
  leaderboard: LeaderboardEntry[];
  turn: number;
  kills: Record<string, string>;
  surrender_progress: Record<number, number>;
  game_end: boolean;
  is_diff: boolean;
  replay?: string;
}

export interface ReplayPatchPayload {
  grid_type: number[];
  army_cnt: number[];
  lst_move: MovePayload;
  leaderboard: LeaderboardEntry[];
  turn: number;
  kills: Record<string, string>;
  surrender_progress: Record<number, number>;
  game_end: boolean;
}

export interface ReplayPatch {
  forward: ReplayPatchPayload;
  backward: ReplayPatchPayload;
}

export interface ReplayData {
  n: number;
  m: number;
  initial: UpdatePayload;
  patches: ReplayPatch[];
  meta?: ReplayMeta;
}

export interface GameConfig extends LobbyConfig {
  player_names: string[];
  player_teams: number[];
  map_size_version?: 1 | 2;
}

export interface ReplayMeta {
  width_ratio: number;
  height_ratio: number;
  city_ratio: number;
  mountain_ratio: number;
  swamp_ratio: number;
  speed: number;
  allow_team: boolean;
  map_token: string;
  map_mode: 'random' | 'maze';
  player_names: string[];
  player_teams: number[];
  map_size_version?: 1 | 2;
}

export interface ReplayListItem {
  time: number;
  id: string;
  rank: string[];
  turn: number;
}

export type ReplayMoveDirection = 0 | 1 | 2 | 3;

export interface ReplayPlayerOpSelect {
  op: 's';
  x: number;
  y: number;
}

export interface ReplayPlayerOpMove {
  op: 'm';
  d: ReplayMoveDirection;
  h?: 1;
}

export interface ReplayPlayerOpWait {
  op: 'w';
  n: number;
}

export interface ReplayPlayerOpSurrender {
  op: 'r';
}

export type ReplayPlayerOp =
  | ReplayPlayerOpSelect
  | ReplayPlayerOpMove
  | ReplayPlayerOpWait
  | ReplayPlayerOpSurrender;

export interface ReplayActionData {
  version: 'ops-v1';
  meta: ReplayMeta;
  total_turns: number;
  player_ops: ReplayPlayerOp[][];
}

export interface RoomListItem {
  room: string;
  host: string;
  total: number;
  playing: number;
  spectators: number;
  ready: number;
  need: number;
}
