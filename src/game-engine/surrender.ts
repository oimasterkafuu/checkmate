import { Grid, Tile } from '../map/map-core';

interface SurrenderFinalizeInput {
  turn: number;
  fadeTicks: number;
  playerCount: number;
  n: number;
  m: number;
  owner: Grid<number>;
  armyCnt: Grid<number>;
  gridType: Grid<Tile>;
  surrenderStartTurn: number[];
  surrenderFinalized: boolean[];
}

interface SurrenderProgressInput {
  turn: number;
  fadeTicks: number;
  playerCount: number;
  surrenderStartTurn: number[];
  surrenderFinalized: boolean[];
}

const finalizeSurrenderEmpire = (
  playerIndex: number,
  n: number,
  m: number,
  owner: Grid<number>,
  armyCnt: Grid<number>,
  gridType: Grid<Tile>,
): void => {
  const ownerId = playerIndex + 1;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (owner[i][j] !== ownerId) {
        continue;
      }
      owner[i][j] = 0;
      armyCnt[i][j] = Math.floor((armyCnt[i][j] + 1) / 2);
      if (gridType[i][j] === -2) {
        gridType[i][j] = -1;
      }
    }
  }
};

const applySurrenderFinalize = (input: SurrenderFinalizeInput): void => {
  for (let p = 0; p < input.playerCount; p += 1) {
    if (input.surrenderFinalized[p]) {
      continue;
    }
    const startTurn = input.surrenderStartTurn[p];
    if (startTurn < 0) {
      continue;
    }
    if (input.turn - startTurn < input.fadeTicks) {
      continue;
    }
    finalizeSurrenderEmpire(p, input.n, input.m, input.owner, input.armyCnt, input.gridType);
    input.surrenderFinalized[p] = true;
    input.surrenderStartTurn[p] = -1;
  }
};

const buildSurrenderProgress = (input: SurrenderProgressInput): Record<number, number> => {
  const progress: Record<number, number> = {};
  for (let p = 0; p < input.playerCount; p += 1) {
    if (input.surrenderFinalized[p]) {
      continue;
    }
    const startTurn = input.surrenderStartTurn[p];
    if (startTurn < 0) {
      continue;
    }
    const ratio = Math.max(0, Math.min(1, (input.turn - startTurn) / input.fadeTicks));
    if (ratio > 0) {
      progress[p + 1] = ratio;
    }
  }
  return progress;
};

export { applySurrenderFinalize, buildSurrenderProgress };
