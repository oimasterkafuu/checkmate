import { ReplayPlayerOp } from '../types';
import { toMoveDirection } from './replay-helpers';

type Move = [number, number, number, number, boolean];

const buildTurnMoves = (lastMoves: Move[]): Array<Move | null> => {
  const turnMoves: Array<Move | null> = [];
  for (let p = 0; p < lastMoves.length; p += 1) {
    const move = lastMoves[p];
    if (move[0] === -1) {
      turnMoves.push(null);
    } else {
      turnMoves.push([move[0], move[1], move[2], move[3], move[4]]);
    }
  }
  return turnMoves;
};

const buildReplayPlayerOps = (
  playerCount: number,
  replayTurnMoves: Array<Array<Move | null>>,
  replayTurnSurrenders: Array<Set<number>>,
): ReplayPlayerOp[][] => {
  const playerOps: ReplayPlayerOp[][] = Array.from({ length: playerCount }, () => []);

  for (let p = 0; p < playerCount; p += 1) {
    const ops: ReplayPlayerOp[] = [];
    let wait = 0;
    let selected: [number, number] | null = null;

    for (let t = 0; t < replayTurnMoves.length; t += 1) {
      const turn = t + 1;
      const surrendered = replayTurnSurrenders[p].has(turn);
      const move = replayTurnMoves[t][p];
      if (!move && !surrendered) {
        wait += 1;
        continue;
      }

      if (wait > 0) {
        ops.push({ op: 'w', n: wait });
        wait = 0;
      }

      if (surrendered) {
        ops.push({ op: 'r' });
        selected = null;
        continue;
      }

      if (!move) {
        continue;
      }

      const [x, y, dx, dy, half] = move;
      if (!selected || selected[0] !== x || selected[1] !== y) {
        ops.push({ op: 's', x, y });
        selected = [x, y];
      }
      const dir = toMoveDirection(x, y, dx, dy);
      if (dir === null) {
        continue;
      }

      ops.push(half ? { op: 'm', d: dir, h: 1 } : { op: 'm', d: dir });
      selected = [dx, dy];
    }

    if (wait > 0) {
      ops.push({ op: 'w', n: wait });
    }

    playerOps[p] = ops;
  }

  return playerOps;
};

export { buildReplayPlayerOps, buildTurnMoves };
