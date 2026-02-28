import { MOVE_DX, MOVE_DY } from '../map/map-core';
import { ReplayActionData, ReplayMoveDirection } from '../types';

type Move = [number, number, number, number, boolean];

interface ScheduledReplayActions {
  scheduledMoves: Array<Map<number, Move>>;
  scheduledSurrenders: Array<Set<number>>;
}

const buildScheduledReplayActions = (replay: ReplayActionData): ScheduledReplayActions => {
  const scheduledMoves = replay.player_ops.map(() => new Map<number, Move>());
  const scheduledSurrenders = replay.player_ops.map(() => new Set<number>());

  for (let p = 0; p < replay.player_ops.length; p += 1) {
    const ops = replay.player_ops[p];
    let cursorTurn = 1;
    let selected: [number, number] | null = null;

    for (const op of ops) {
      if (op.op === 'w') {
        cursorTurn += Math.max(0, op.n);
        continue;
      }
      if (op.op === 's') {
        selected = [op.x, op.y];
        continue;
      }
      if (op.op === 'r') {
        scheduledSurrenders[p].add(cursorTurn);
        selected = null;
        cursorTurn += 1;
        continue;
      }
      if (!selected) {
        continue;
      }

      const dir = op.d as ReplayMoveDirection;
      const dx = selected[0] + MOVE_DX[dir];
      const dy = selected[1] + MOVE_DY[dir];
      scheduledMoves[p].set(cursorTurn, [selected[0], selected[1], dx, dy, op.h === 1]);
      selected = [dx, dy];
      cursorTurn += 1;
    }
  }

  return {
    scheduledMoves,
    scheduledSurrenders,
  };
};

export { buildScheduledReplayActions };
