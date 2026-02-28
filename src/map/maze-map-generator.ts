import {
  MAX_CITY_RATIO,
  MAX_SWAMP_RATIO,
  MAZE_CITY_RATIO_BOOST,
  MOVE_DX,
  MOVE_DY,
  SeededRandom,
  Tile,
  build2D,
  computeBaseMapDimensions,
  markLargestComponent,
  shuffle,
} from './map-core';
import { generateRandomMap } from './random-map-generator';
import type { GeneratedMap, MapGenerationConfig } from './random-map-generator';

const generateMazeMap = (rng: SeededRandom, config: MapGenerationConfig): GeneratedMap => {
  const { n, m } = computeBaseMapDimensions(rng, config.heightRatio, config.widthRatio);
  const owner = build2D(n, m, 0);
  const armyCnt = build2D(n, m, 0);
  const gridType = build2D<Tile>(n, m, 1);

  const mazeRows: number[] = [];
  const mazeCols: number[] = [];
  for (let i = 1; i < n; i += 2) {
    mazeRows.push(i);
  }
  for (let j = 1; j < m; j += 2) {
    mazeCols.push(j);
  }

  if (mazeRows.length === 0 || mazeCols.length === 0) {
    return generateRandomMap(rng, config);
  }

  const visited = build2D(n, m, false);
  const stack: Array<[number, number]> = [];
  const start: [number, number] = [
    mazeRows[rng.intInclusive(0, mazeRows.length - 1)],
    mazeCols[rng.intInclusive(0, mazeCols.length - 1)],
  ];
  stack.push(start);
  visited[start[0]][start[1]] = true;
  gridType[start[0]][start[1]] = 0;

  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const nexts: Array<{ nx: number; ny: number; wx: number; wy: number }> = [];

    for (let d = 0; d < 4; d += 1) {
      const nx = x + MOVE_DX[d] * 2;
      const ny = y + MOVE_DY[d] * 2;
      if (nx <= 0 || nx >= n || ny <= 0 || ny >= m || visited[nx][ny]) {
        continue;
      }
      nexts.push({ nx, ny, wx: x + MOVE_DX[d], wy: y + MOVE_DY[d] });
    }

    if (nexts.length === 0) {
      stack.pop();
      continue;
    }

    const choice = nexts[rng.intInclusive(0, nexts.length - 1)];
    visited[choice.nx][choice.ny] = true;
    gridType[choice.wx][choice.wy] = 0;
    gridType[choice.nx][choice.ny] = 0;
    stack.push([choice.nx, choice.ny]);
  }

  const extraOpeningsTarget = Math.floor(n * m * 0.03);
  let extraOpenings = 0;
  const createsOpen2x2 = (x: number, y: number): boolean => {
    for (let ax = x - 1; ax <= x; ax += 1) {
      for (let ay = y - 1; ay <= y; ay += 1) {
        if (ax < 0 || ay < 0 || ax + 1 >= n || ay + 1 >= m) {
          continue;
        }
        let allEmpty = true;
        for (let dx = 0; dx <= 1; dx += 1) {
          for (let dy = 0; dy <= 1; dy += 1) {
            const cx = ax + dx;
            const cy = ay + dy;
            const isOpeningCell = cx === x && cy === y;
            const isEmpty = isOpeningCell ? true : gridType[cx][cy] === 0;
            if (!isEmpty) {
              allEmpty = false;
              break;
            }
          }
          if (!allEmpty) {
            break;
          }
        }
        if (allEmpty) {
          return true;
        }
      }
    }
    return false;
  };

  for (
    let attempt = 0;
    attempt < extraOpeningsTarget * 10 && extraOpenings < extraOpeningsTarget;
    attempt += 1
  ) {
    if (n <= 2 || m <= 2) {
      break;
    }
    const x = rng.intInclusive(1, n - 2);
    const y = rng.intInclusive(1, m - 2);
    if (gridType[x][y] !== 1) {
      continue;
    }
    const openLR = gridType[x][y - 1] !== 1 && gridType[x][y + 1] !== 1;
    const openUD = gridType[x - 1][y] !== 1 && gridType[x + 1][y] !== 1;
    if (!openLR && !openUD) {
      continue;
    }
    if (createsOpen2x2(x, y)) {
      continue;
    }
    gridType[x][y] = 0;
    extraOpenings += 1;
  }

  const st = build2D(n, m, false);
  markLargestComponent(gridType, n, m, st);

  const passable: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (st[i][j] && gridType[i][j] === 0) {
        passable.push([i, j]);
      }
    }
  }

  shuffle(passable, rng);
  const cityCandidates = passable.filter(([x, y]) => x % 2 === 0 || y % 2 === 0);
  shuffle(cityCandidates, rng);
  const mazeCityRatio = Math.min(1, MAX_CITY_RATIO * config.cityRatio * MAZE_CITY_RATIO_BOOST);
  const cityTarget = Math.min(cityCandidates.length, Math.floor(n * m * mazeCityRatio));
  const citySet = new Set<number>();
  for (let i = 0; i < cityTarget; i += 1) {
    const [x, y] = cityCandidates[i];
    gridType[x][y] = -1;
    armyCnt[x][y] = rng.intInclusive(20, 30);
    citySet.add(x * m + y);
  }

  const swampCandidates = passable.filter(([x, y]) => !citySet.has(x * m + y));
  shuffle(swampCandidates, rng);
  const swampTarget = Math.min(
    swampCandidates.length,
    Math.floor(n * m * MAX_SWAMP_RATIO * config.swampRatio),
  );
  for (let i = 0; i < swampTarget; i += 1) {
    const [x, y] = swampCandidates[i];
    gridType[x][y] = 2;
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

export { generateMazeMap };
