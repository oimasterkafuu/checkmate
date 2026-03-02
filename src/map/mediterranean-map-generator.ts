import {
  Grid,
  MAX_CITY_RATIO,
  MAX_MOUNTAIN_RATIO,
  MAX_SWAMP_RATIO,
  MOVE_DX,
  MOVE_DY,
  SeededRandom,
  Tile,
  build2D,
  checkConnection,
  computeBaseMapDimensions,
  markLargestComponent,
  shuffle,
} from './map-core';
import type { GeneratedMap, MapGenerationConfig } from './random-map-generator';

interface MediterraneanMapGenerationConfig extends MapGenerationConfig {
  requiredPlayers: number;
}

const resolveEdgeDistance = (n: number, m: number, x: number, y: number): number =>
  Math.min(x, n - 1 - x, y, m - 1 - y);

const buildSeaDistanceMap = (gridType: Grid<Tile>, n: number, m: number): Int16Array => {
  const total = n * m;
  const dist = new Int16Array(total);
  dist.fill(32767);

  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] !== 2) {
        continue;
      }
      const idx = i * m + j;
      dist[idx] = 0;
      queue[tail] = idx;
      tail += 1;
    }
  }

  if (tail === 0) {
    dist.fill(999);
    return dist;
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = Math.floor(index / m);
    const y = index % m;
    const nextDistance = dist[index] + 1;

    for (let d = 0; d < 4; d += 1) {
      const nx = x + MOVE_DX[d];
      const ny = y + MOVE_DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= m) {
        continue;
      }
      const nextIndex = nx * m + ny;
      if (dist[nextIndex] <= nextDistance) {
        continue;
      }
      dist[nextIndex] = nextDistance;
      queue[tail] = nextIndex;
      tail += 1;
    }
  }

  return dist;
};

const hasAdjacentSwamp8 = (gridType: Grid<Tile>, n: number, m: number, x: number, y: number): boolean => {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= m) {
        continue;
      }
      if (gridType[nx][ny] === 2) {
        return true;
      }
    }
  }
  return false;
};

const collectEdgeCandidates = (
  n: number,
  m: number,
  st: Grid<boolean>,
  gridType: Grid<Tile>,
  maxEdgeDistance: number,
  plainOnly: boolean,
): Array<[number, number]> => {
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!st[i][j]) {
        continue;
      }
      if (resolveEdgeDistance(n, m, i, j) > maxEdgeDistance) {
        continue;
      }
      if (plainOnly) {
        if (gridType[i][j] === 0) {
          candidates.push([i, j]);
        }
      } else if (gridType[i][j] !== 1) {
        candidates.push([i, j]);
      }
    }
  }
  return candidates;
};

const pickDistributedEdgeSpawns = (
  candidates: Array<[number, number]>,
  requiredPlayers: number,
  m: number,
  rng: SeededRandom,
): Array<[number, number]> => {
  if (requiredPlayers <= 0 || candidates.length === 0) {
    return [];
  }
  if (candidates.length <= requiredPlayers) {
    const shuffled = [...candidates];
    shuffle(shuffled, rng);
    return shuffled.slice(0, requiredPlayers);
  }

  const selected: Array<[number, number]> = [];
  const used = new Set<number>();
  const firstIndex = rng.intInclusive(0, candidates.length - 1);
  selected.push(candidates[firstIndex]);
  used.add(candidates[firstIndex][0] * m + candidates[firstIndex][1]);

  while (selected.length < requiredPlayers) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      const [x, y] = candidates[i];
      const key = x * m + y;
      if (used.has(key)) {
        continue;
      }

      let minDist = Number.POSITIVE_INFINITY;
      for (let j = 0; j < selected.length; j += 1) {
        const [sx, sy] = selected[j];
        const dist = Math.abs(x - sx) + Math.abs(y - sy);
        if (dist < minDist) {
          minDist = dist;
        }
      }

      const score = minDist * 1000 + rng.next();
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      break;
    }

    const [x, y] = candidates[bestIndex];
    selected.push([x, y]);
    used.add(x * m + y);
  }

  return selected.slice(0, requiredPlayers);
};

const generateMediterraneanMap = (
  rng: SeededRandom,
  config: MediterraneanMapGenerationConfig,
): GeneratedMap => {
  const { n, m } = computeBaseMapDimensions(rng, config.heightRatio, config.widthRatio);
  const owner = build2D(n, m, 0);
  const armyCnt = build2D(n, m, 0);

  const cityRatio = MAX_CITY_RATIO * config.cityRatio * 1.15;
  const ringSwampRatio = MAX_SWAMP_RATIO * config.swampRatio * 0.4;
  const mountainRatio = MAX_MOUNTAIN_RATIO * config.mountainRatio * 0.7;

  const centerX = (n - 1) / 2;
  const centerY = (m - 1) / 2;
  const centerRadiusX = Math.max(2, n * (0.34 + rng.next() * 0.08));
  const centerRadiusY = Math.max(2, m * (0.34 + rng.next() * 0.08));
  const centerSwampNoise = 0.1 + rng.next() * 0.08;
  const centerMountainChance = 0.015 + rng.next() * 0.02;
  const baseSpawnBand = Math.max(2, Math.floor(Math.min(n, m) * 0.12));

  let gridType: Grid<Tile> = build2D<Tile>(n, m, 0);
  while (true) {
    const candidate = build2D<Tile>(n, m, 0);

    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        const dx = (i - centerX) / centerRadiusX;
        const dy = (j - centerY) / centerRadiusY;
        const radial = dx * dx + dy * dy + (rng.next() - 0.5) * centerSwampNoise;

        if (radial <= 1) {
          candidate[i][j] = rng.next() < centerMountainChance ? 1 : 2;
          continue;
        }

        const edgeDistance = resolveEdgeDistance(n, m, i, j);
        let localCityRatio = cityRatio;
        let localSwampRatio = ringSwampRatio;
        let localMountainRatio = mountainRatio;
        if (edgeDistance <= baseSpawnBand) {
          localCityRatio *= 0.55;
          localSwampRatio *= 0.35;
          localMountainRatio *= 0.45;
        }

        const swampBoundary = localCityRatio + localSwampRatio;
        const mountainBoundary = swampBoundary + localMountainRatio;
        const chance = rng.next();
        if (chance < localCityRatio) {
          candidate[i][j] = -1;
        } else if (chance < swampBoundary) {
          candidate[i][j] = 2;
        } else if (chance < mountainBoundary) {
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
  const seaDistance = buildSeaDistanceMap(gridType, n, m);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === -1) {
        gridType[i][j] = 0;
      }
    }
  }

  const outerCitySeaDistanceMin = Math.max(4, Math.floor(Math.min(n, m) * 0.07));
  const cityCandidates: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!st[i][j] || gridType[i][j] !== 0) {
        continue;
      }
      if (hasAdjacentSwamp8(gridType, n, m, i, j)) {
        continue;
      }
      if (seaDistance[i * m + j] < outerCitySeaDistanceMin) {
        continue;
      }
      cityCandidates.push([i, j]);
    }
  }
  shuffle(cityCandidates, rng);
  const targetCityCount = Math.min(
    cityCandidates.length,
    Math.max(1, Math.floor(n * m * MAX_CITY_RATIO * config.cityRatio * 1.85)),
  );
  for (let i = 0; i < targetCityCount; i += 1) {
    const [x, y] = cityCandidates[i];
    gridType[x][y] = -1;
  }

  const innerSeaCityCandidates: Array<[number, number]> = [];
  for (let i = 1; i + 1 < n; i += 1) {
    for (let j = 1; j + 1 < m; j += 1) {
      if (!st[i][j] || gridType[i][j] !== 2) {
        continue;
      }
      let surroundedByNonEmpty = true;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          if (gridType[i + dx][j + dy] === 0) {
            surroundedByNonEmpty = false;
            break;
          }
        }
        if (!surroundedByNonEmpty) {
          break;
        }
      }
      if (surroundedByNonEmpty) {
        innerSeaCityCandidates.push([i, j]);
      }
    }
  }
  shuffle(innerSeaCityCandidates, rng);
  const innerSeaCityTarget = Math.min(
    innerSeaCityCandidates.length,
    Math.max(1, Math.floor(targetCityCount * 0.3)),
  );
  const innerSeaCitySet = new Set<number>();
  for (let i = 0; i < innerSeaCityTarget; i += 1) {
    const [x, y] = innerSeaCityCandidates[i];
    gridType[x][y] = -1;
    innerSeaCitySet.add(x * m + y);
  }

  const requiredPlayers = Math.max(0, config.requiredPlayers);
  const spawnPoints: Array<[number, number]> = [];
  if (requiredPlayers > 0) {
    const outerMaxBand = Math.max(baseSpawnBand + 2, Math.floor(Math.min(n, m) * 0.26));
    const spawnSeaDistanceStart = Math.max(3, Math.floor(Math.min(n, m) * 0.06));
    let spawnBand = baseSpawnBand;
    let outerPlain: Array<[number, number]> = [];
    let spawnSeaThreshold = spawnSeaDistanceStart;

    for (let seaThreshold = spawnSeaDistanceStart; seaThreshold >= 1; seaThreshold -= 1) {
      spawnBand = baseSpawnBand;
      let bestForThreshold: Array<[number, number]> = [];
      while (spawnBand <= outerMaxBand) {
        const candidates = collectEdgeCandidates(n, m, st, gridType, spawnBand, true).filter(([x, y]) => {
          const edgeDistance = resolveEdgeDistance(n, m, x, y);
          if (edgeDistance === 0) {
            return false;
          }
          if (hasAdjacentSwamp8(gridType, n, m, x, y)) {
            return false;
          }
          return seaDistance[x * m + y] >= seaThreshold;
        });
        if (candidates.length >= requiredPlayers) {
          bestForThreshold = candidates;
          break;
        }
        if (candidates.length > bestForThreshold.length) {
          bestForThreshold = candidates;
        }
        spawnBand += 1;
      }
      if (bestForThreshold.length > outerPlain.length) {
        outerPlain = bestForThreshold;
        spawnSeaThreshold = seaThreshold;
      }
      if (outerPlain.length >= requiredPlayers) {
        break;
      }
    }

    if (outerPlain.length < requiredPlayers) {
      const fallbackOuter = collectEdgeCandidates(n, m, st, gridType, outerMaxBand, true).filter(([x, y]) => {
        const edgeDistance = resolveEdgeDistance(n, m, x, y);
        if (edgeDistance === 0) {
          return false;
        }
        if (hasAdjacentSwamp8(gridType, n, m, x, y)) {
          return false;
        }
        return seaDistance[x * m + y] >= Math.max(1, spawnSeaThreshold - 1);
      });
      if (fallbackOuter.length > outerPlain.length) {
        outerPlain = fallbackOuter;
      }
    }

    if (outerPlain.length < requiredPlayers) {
      const anyOuter = collectEdgeCandidates(n, m, st, gridType, outerMaxBand, false).filter(([x, y]) => {
        const edgeDistance = resolveEdgeDistance(n, m, x, y);
        if (edgeDistance === 0 || hasAdjacentSwamp8(gridType, n, m, x, y)) {
          return false;
        }
        return true;
      });
      shuffle(anyOuter, rng);
      for (let i = 0; i < anyOuter.length && outerPlain.length < requiredPlayers; i += 1) {
        const [x, y] = anyOuter[i];
        if (gridType[x][y] !== 0) {
          gridType[x][y] = 0;
          owner[x][y] = 0;
          armyCnt[x][y] = 0;
        }
        outerPlain.push([x, y]);
      }
    }

    spawnPoints.push(...pickDistributedEdgeSpawns(outerPlain, requiredPlayers, m, rng));
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === -1) {
        const key = i * m + j;
        armyCnt[i][j] = innerSeaCitySet.has(key) ? 10 : rng.intInclusive(40, 50);
      }
    }
  }

  for (let i = 0; i < spawnPoints.length; i += 1) {
    const [x, y] = spawnPoints[i];
    gridType[x][y] = -2;
    owner[x][y] = 0;
    armyCnt[x][y] = 0;
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

export { generateMediterraneanMap };
