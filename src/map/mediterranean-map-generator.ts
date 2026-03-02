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
  shuffle,
} from './map-core';
import type { GeneratedMap, MapGenerationConfig } from './random-map-generator';

interface MediterraneanMapGenerationConfig extends MapGenerationConfig {
  requiredPlayers: number;
}

const resolveEdgeDistance = (n: number, m: number, x: number, y: number): number =>
  Math.min(x, n - 1 - x, y, m - 1 - y);

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
  const mountainRatio = MAX_MOUNTAIN_RATIO * config.mountainRatio;

  const centerX = (n - 1) / 2;
  const centerY = (m - 1) / 2;
  const centerRadiusX = Math.max(2, n * (0.42 + rng.next() * 0.08));
  const centerRadiusY = Math.max(2, m * (0.42 + rng.next() * 0.08));
  const centerSwampNoise = 0.09 + rng.next() * 0.08;
  const centerMountainChance = 0.04 + rng.next() * 0.04;
  const baseSpawnBand = Math.max(1, Math.floor(Math.min(n, m) * 0.11));

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

  const coastalCityCandidates: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!st[i][j] || gridType[i][j] === 1 || gridType[i][j] === -1) {
        continue;
      }
      if (resolveEdgeDistance(n, m, i, j) <= baseSpawnBand) {
        continue;
      }
      const dx = (i - centerX) / centerRadiusX;
      const dy = (j - centerY) / centerRadiusY;
      const radial = dx * dx + dy * dy;
      if (radial > 1.02 && radial < 2.3) {
        coastalCityCandidates.push([i, j]);
      }
    }
  }
  shuffle(coastalCityCandidates, rng);
  const coastalCityTarget = Math.min(
    coastalCityCandidates.length,
    Math.floor(n * m * MAX_CITY_RATIO * config.cityRatio * 0.55),
  );
  for (let i = 0; i < coastalCityTarget; i += 1) {
    const [x, y] = coastalCityCandidates[i];
    gridType[x][y] = -1;
  }

  const requiredPlayers = Math.max(0, config.requiredPlayers);
  const spawnPoints: Array<[number, number]> = [];
  if (requiredPlayers > 0) {
    let spawnBand = baseSpawnBand;
    const maxBand = Math.max(spawnBand, Math.floor(Math.min(n, m) / 2) - 1);
    let edgeCells = collectEdgeCandidates(n, m, st, gridType, spawnBand, false);

    while (edgeCells.length < requiredPlayers && spawnBand < maxBand) {
      spawnBand += 1;
      edgeCells = collectEdgeCandidates(n, m, st, gridType, spawnBand, false);
    }

    let edgePlain = collectEdgeCandidates(n, m, st, gridType, spawnBand, true);
    if (edgePlain.length < requiredPlayers) {
      const convertible = edgeCells.filter(([x, y]) => gridType[x][y] !== 0);
      shuffle(convertible, rng);
      for (let i = 0; i < convertible.length && edgePlain.length < requiredPlayers; i += 1) {
        const [x, y] = convertible[i];
        gridType[x][y] = 0;
        owner[x][y] = 0;
        armyCnt[x][y] = 0;
        edgePlain.push([x, y]);
      }
    }

    spawnPoints.push(...pickDistributedEdgeSpawns(edgePlain, requiredPlayers, m, rng));
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === -1) {
        armyCnt[i][j] = rng.intInclusive(20, 30);
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
