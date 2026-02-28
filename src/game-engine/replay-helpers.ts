import { MOVE_DX, MOVE_DY } from '../map/map-core';
import {
  LeaderboardEntry,
  ReplayMoveDirection,
  ReplayPatch,
  ReplayPatchPayload,
  UpdatePayload,
} from '../types';

const getDiff = (next: number[], prev: number[]): number[] => {
  const diff: number[] = [];
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== prev[i]) {
      diff.push(i, next[i]);
    }
  }
  return diff;
};

const cloneMovePayload = (move: UpdatePayload['lst_move']): UpdatePayload['lst_move'] => ({
  x: move.x,
  y: move.y,
  dx: move.dx,
  dy: move.dy,
  half: move.half,
});

const cloneLeaderboard = (leaderboard: LeaderboardEntry[]): LeaderboardEntry[] =>
  leaderboard.map((item) => ({
    team: item.team,
    uid: item.uid,
    army: item.army,
    land: item.land,
    class_: item.class_,
    dead: item.dead,
    id: item.id,
  }));

const buildReplayPatchPayload = (
  frame: UpdatePayload,
  gridDiff: number[],
  armyDiff: number[],
): ReplayPatchPayload => ({
  grid_type: gridDiff,
  army_cnt: armyDiff,
  lst_move: cloneMovePayload(frame.lst_move),
  leaderboard: cloneLeaderboard(frame.leaderboard),
  turn: frame.turn,
  kills: { ...frame.kills },
  surrender_progress: { ...frame.surrender_progress },
  game_end: frame.game_end,
});

const buildReplayPatch = (prevFrame: UpdatePayload, nextFrame: UpdatePayload): ReplayPatch => ({
  forward: buildReplayPatchPayload(
    nextFrame,
    getDiff(nextFrame.grid_type, prevFrame.grid_type),
    getDiff(nextFrame.army_cnt, prevFrame.army_cnt),
  ),
  backward: buildReplayPatchPayload(
    prevFrame,
    getDiff(prevFrame.grid_type, nextFrame.grid_type),
    getDiff(prevFrame.army_cnt, nextFrame.army_cnt),
  ),
});

const toMoveDirection = (x: number, y: number, dx: number, dy: number): ReplayMoveDirection | null => {
  for (let i = 0; i < 4; i += 1) {
    if (x + MOVE_DX[i] === dx && y + MOVE_DY[i] === dy) {
      return i as ReplayMoveDirection;
    }
  }
  return null;
};

export { buildReplayPatch, getDiff, toMoveDirection };
