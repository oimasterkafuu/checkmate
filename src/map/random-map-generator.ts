import {
  Grid,
  MAX_CITY_RATIO,
  MAX_MOUNTAIN_RATIO,
  MAX_SWAMP_RATIO,
  SeededRandom,
  Tile,
  build2D,
  checkConnection,
  computeBaseMapDimensions,
  markLargestComponent,
} from './map-core';

interface MapGenerationConfig {
  widthRatio: number;
  heightRatio: number;
  cityRatio: number;
  mountainRatio: number;
  swampRatio: number;
}

interface GeneratedMap {
  n: number;
  m: number;
  owner: Grid<number>;
  armyCnt: Grid<number>;
  gridType: Grid<Tile>;
  st: Grid<boolean>;
}

const generateRandomMap = (rng: SeededRandom, config: MapGenerationConfig): GeneratedMap => {
  const { n, m } = computeBaseMapDimensions(rng, config.heightRatio, config.widthRatio);
  const owner = build2D(n, m, 0);
  const armyCnt = build2D(n, m, 0);

  const cityRatio = MAX_CITY_RATIO * config.cityRatio;
  const swampRatio = cityRatio + MAX_SWAMP_RATIO * config.swampRatio;
  const mountainRatio = swampRatio + MAX_MOUNTAIN_RATIO * config.mountainRatio;

  let gridType: Grid<Tile> = build2D<Tile>(n, m, 0);
  while (true) {
    const candidate = build2D<Tile>(n, m, 0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        const chance = rng.next();
        if (chance < cityRatio) {
          candidate[i][j] = -1;
        } else if (chance < swampRatio) {
          candidate[i][j] = 2;
        } else if (chance < mountainRatio) {
          candidate[i][j] = 1;
        }
      }
    }
    const [x] = checkConnection(candidate, n, m);
    if (x !== -1) {
      gridType = candidate;
      break;
    }
  }

  const st = build2D(n, m, false);
  markLargestComponent(gridType, n, m, st);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === -1) {
        armyCnt[i][j] = rng.intInclusive(40, 50);
      }
    }
  }

  return {
    n,
    m,
    owner,
    armyCnt,
    gridType,
    st,
  };
};

export { generateRandomMap };
export type { GeneratedMap, MapGenerationConfig };
