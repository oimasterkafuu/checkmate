import { Grid, Tile } from '../map/map-core';

interface BoardState {
  n: number;
  m: number;
  gridType: Grid<Tile>;
  owner: Grid<number>;
  armyCnt: Grid<number>;
}

interface PlayerVisionInput extends BoardState {
  viewerTeam: number;
  playerTeams: number[];
  forceFullVision: boolean;
}

interface FlatMapArrays {
  grid_type: number[];
  army_cnt: number[];
}

const NEARBY_DX = [0, -1, 1, 0, 0, -1, -1, 1, 1];
const NEARBY_DY = [0, 0, 0, -1, 1, -1, 1, -1, 1];

const isInBounds = (n: number, m: number, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < n && y < m;

const encodeFullVisionTile = (tile: Tile, owner: number, army: number): number => {
  if (tile === 2) {
    return owner === 0 ? 204 : owner + 150;
  }
  if (tile === 1) {
    return 201;
  }
  if (tile === -1) {
    return owner + 50;
  }
  if (tile === -2) {
    return owner + 100;
  }
  return owner || army ? owner : 200;
};

const encodePartialVisionTile = (visible: boolean, tile: Tile, owner: number, army: number): number => {
  if (tile === 2) {
    return visible ? (owner === 0 ? 204 : owner + 150) : 205;
  }
  if (tile === 1) {
    return visible ? 201 : 203;
  }
  if (tile === -1) {
    return visible ? owner + 50 : 203;
  }
  if (tile === -2) {
    return visible ? owner + 100 : 202;
  }
  if (!visible) {
    return 202;
  }
  return owner || army ? owner : 200;
};

const buildFullVisionArrays = (state: BoardState): FlatMapArrays => {
  const gridTypeFlat: number[] = [];
  const armyCntFlat: number[] = [];

  for (let i = 0; i < state.n; i += 1) {
    for (let j = 0; j < state.m; j += 1) {
      const owner = state.owner[i][j];
      const army = state.armyCnt[i][j];
      gridTypeFlat.push(encodeFullVisionTile(state.gridType[i][j], owner, army));
      armyCntFlat.push(army);
    }
  }

  return {
    grid_type: gridTypeFlat,
    army_cnt: armyCntFlat,
  };
};

const buildPlayerVisionArrays = (input: PlayerVisionInput): FlatMapArrays => {
  if (input.forceFullVision) {
    return buildFullVisionArrays(input);
  }

  const gridTypeFlat: number[] = [];
  const armyCntFlat: number[] = [];

  for (let i = 0; i < input.n; i += 1) {
    for (let j = 0; j < input.m; j += 1) {
      let visible = false;
      for (let d = 0; d < NEARBY_DX.length; d += 1) {
        const nx = i + NEARBY_DX[d];
        const ny = j + NEARBY_DY[d];
        if (!isInBounds(input.n, input.m, nx, ny)) {
          continue;
        }
        const nearbyOwner = input.owner[nx][ny];
        if (nearbyOwner === 0) {
          continue;
        }
        if (input.playerTeams[nearbyOwner - 1] === input.viewerTeam) {
          visible = true;
          break;
        }
      }

      const owner = input.owner[i][j];
      const army = input.armyCnt[i][j];
      gridTypeFlat.push(encodePartialVisionTile(visible, input.gridType[i][j], owner, army));
      armyCntFlat.push(visible ? army : 0);
    }
  }

  return {
    grid_type: gridTypeFlat,
    army_cnt: armyCntFlat,
  };
};

export { buildFullVisionArrays, buildPlayerVisionArrays };
export type { FlatMapArrays };
