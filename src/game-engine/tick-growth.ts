import { Grid, Tile } from '../map/map-core';

interface TickGrowthInput {
  turn: number;
  n: number;
  m: number;
  gridType: Grid<Tile>;
  owner: Grid<number>;
  armyCnt: Grid<number>;
  pstat: number[];
  leftGameValue: number;
}

const applyTickGrowth = (input: TickGrowthInput): void => {
  if (input.turn % 2 === 0) {
    for (let i = 0; i < input.n; i += 1) {
      for (let j = 0; j < input.m; j += 1) {
        const ownerId = input.owner[i][j];
        const ownerAlive = ownerId > 0 && input.pstat[ownerId - 1] !== input.leftGameValue;
        if (input.gridType[i][j] < 0 && ownerAlive) {
          input.armyCnt[i][j] += 1;
        } else if (input.gridType[i][j] === 2 && ownerId > 0) {
          input.armyCnt[i][j] -= 1;
          if (input.armyCnt[i][j] === 0) {
            input.owner[i][j] = 0;
          }
        }
      }
    }
  }

  if (input.turn % 50 === 0) {
    for (let i = 0; i < input.n; i += 1) {
      for (let j = 0; j < input.m; j += 1) {
        const ownerId = input.owner[i][j];
        if (ownerId > 0 && input.pstat[ownerId - 1] !== input.leftGameValue) {
          input.armyCnt[i][j] += 1;
        }
      }
    }
  }
};

export { applyTickGrowth };
