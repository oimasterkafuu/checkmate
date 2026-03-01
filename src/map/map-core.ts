import { createHash } from 'node:crypto';

const DEFAULT_WIDTH = 45;
const MAP_TOKEN_MAX_LENGTH = 32;
const MAX_CITY_RATIO = 0.04;
const MAX_SWAMP_RATIO = 0.16;
const MAX_MOUNTAIN_RATIO = 0.24;
const MAZE_CITY_RATIO_BOOST = 2.8;
const MOVE_DX = [-1, 1, 0, 0] as const;
const MOVE_DY = [0, 0, -1, 1] as const;

type Tile = -2 | -1 | 0 | 1 | 2;
type Grid<T> = T[][];
type GeneralPos = [number, number];
type MapMode = 'random' | 'maze' | 'archipelago';

class DSU {
  private readonly parent: number[];

  private readonly size: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.size = Array.from({ length: n }, () => 1);
  }

  find(x: number): number {
    if (this.parent[x] === x) {
      return x;
    }
    this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  merge(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) {
      return;
    }
    this.size[ry] += this.size[rx];
    this.parent[rx] = ry;
  }

  componentSize(x: number): number {
    return this.size[this.find(x)];
  }
}

class SeededRandom {
  private state: number;

  constructor(seed: string) {
    const digest = createHash('sha256').update(seed, 'utf-8').digest();
    this.state = digest.readUInt32LE(0) || 1;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  intInclusive(left: number, right: number): number {
    return left + Math.floor(this.next() * (right - left + 1));
  }
}

const shuffle = <T>(arr: T[], rng: SeededRandom): void => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = rng.intInclusive(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

const build2D = <T>(n: number, m: number, value: T): Grid<T> =>
  Array.from({ length: n }, () => Array.from({ length: m }, () => value));

const computeBaseMapDimensions = (
  rng: SeededRandom,
  heightRatio: number,
  widthRatio: number,
): { n: number; m: number } => {
  const ni = rng.intInclusive(DEFAULT_WIDTH - 5, DEFAULT_WIDTH + 5);
  const mi = Math.floor((DEFAULT_WIDTH * DEFAULT_WIDTH) / ni);
  const toOddAtLeast = (value: number, min: number): number => {
    const base = Math.max(min, value);
    return base % 2 === 0 ? base + 1 : base;
  };
  return {
    n: toOddAtLeast(Math.floor(ni * heightRatio), 7),
    m: toOddAtLeast(Math.floor(mi * widthRatio), 7),
  };
};

const checkConnection = (gridType: Grid<number>, n: number, m: number): GeneralPos => {
  const dsu = new DSU(n * m);
  let blocked = 0;

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === 1) {
        blocked += 1;
        continue;
      }
      if (i + 1 < n && gridType[i + 1][j] !== 1) {
        dsu.merge(i * m + j, i * m + j + m);
      }
      if (j + 1 < m && gridType[i][j + 1] !== 1) {
        dsu.merge(i * m + j, i * m + j + 1);
      }
    }
  }

  const threshold = (n * m - blocked) * 0.9;
  for (let i = 0; i < n * m; i += 1) {
    if (dsu.componentSize(i) > threshold) {
      return [Math.floor(i / m), i % m];
    }
  }

  return [-1, -1];
};

const markLargestComponent = (gridType: Grid<number>, n: number, m: number, st: Grid<boolean>): void => {
  const dsu = new DSU(n * m);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === 1) {
        continue;
      }
      if (i + 1 < n && gridType[i + 1][j] !== 1) {
        dsu.merge(i * m + j, i * m + j + m);
      }
      if (j + 1 < m && gridType[i][j + 1] !== 1) {
        dsu.merge(i * m + j, i * m + j + 1);
      }
    }
  }

  let maxSize = 0;
  for (let i = 0; i < n * m; i += 1) {
    maxSize = Math.max(maxSize, dsu.componentSize(i));
  }

  for (let i = 0; i < n * m; i += 1) {
    st[Math.floor(i / m)][i % m] = dsu.componentSize(i) === maxSize;
  }
};

const resolveMapSeed = (mapMode: MapMode, mapToken: string): string =>
  `${mapMode}:${mapToken.trim() || 'default'}`;

const normalizeMapToken = (token: string): string => token.trim().slice(0, MAP_TOKEN_MAX_LENGTH);

const resolveSeededTerrainRatio = (seed: string, key: string): number => {
  const digest = createHash('sha256').update(`${seed}:${key}`, 'utf-8').digest();
  const value = digest.readUInt16BE(0) / 65535;
  return 0.35 + value * 0.65;
};

export {
  MAP_TOKEN_MAX_LENGTH,
  MAX_CITY_RATIO,
  MAX_MOUNTAIN_RATIO,
  MAX_SWAMP_RATIO,
  MAZE_CITY_RATIO_BOOST,
  MOVE_DX,
  MOVE_DY,
  SeededRandom,
  build2D,
  checkConnection,
  computeBaseMapDimensions,
  markLargestComponent,
  normalizeMapToken,
  resolveMapSeed,
  resolveSeededTerrainRatio,
  shuffle,
};

export type { GeneralPos, Grid, MapMode, Tile };
