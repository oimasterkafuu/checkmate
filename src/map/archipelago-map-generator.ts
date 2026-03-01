import { MOVE_DX, MOVE_DY, SeededRandom, Tile, build2D, computeBaseMapDimensions, shuffle } from './map-core';
import { generateRandomMap } from './random-map-generator';
import type { GeneratedMap, MapGenerationConfig } from './random-map-generator';

interface ArchipelagoMapGenerationConfig extends MapGenerationConfig {
  requiredPlayers: number;
}

interface IslandInfo {
  id: number;
  top: number;
  left: number;
  height: number;
  width: number;
  centerPoint: [number, number];
  centerCells: Array<[number, number]>;
  baseCells: Array<[number, number]>;
  allCells: Set<number>;
}

const RECT_SIZES = [
  [3, 3],
  [3, 4],
  [4, 3],
  [4, 4],
] as const;

const MAP_RETRY_LIMIT = 220;
const COASTLINE_EXPAND_PROBABILITY = 0.12;
const COASTLINE_MAX_CONNECTED_LEN_EXCLUSIVE = 3;

const isInBounds = (n: number, m: number, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < n && y < m;

const canPlaceRectIsland = (
  gridType: Tile[][],
  n: number,
  m: number,
  top: number,
  left: number,
  height: number,
  width: number,
): boolean => {
  if (top < 1 || left < 1 || top + height >= n || left + width >= m) {
    return false;
  }

  for (let i = top - 1; i <= top + height; i += 1) {
    for (let j = left - 1; j <= left + width; j += 1) {
      if (!isInBounds(n, m, i, j) || gridType[i][j] !== 2) {
        return false;
      }
    }
  }

  return true;
};

const collectPlacementsForSize = (
  gridType: Tile[][],
  n: number,
  m: number,
  height: number,
  width: number,
): Array<[number, number]> => {
  const placements: Array<[number, number]> = [];
  const maxTop = n - height - 1;
  const maxLeft = m - width - 1;
  if (maxTop < 1 || maxLeft < 1) {
    return placements;
  }

  for (let top = 1; top <= maxTop; top += 1) {
    for (let left = 1; left <= maxLeft; left += 1) {
      if (canPlaceRectIsland(gridType, n, m, top, left, height, width)) {
        placements.push([top, left]);
      }
    }
  }

  return placements;
};

const buildCenterCells = (top: number, left: number, height: number, width: number): Array<[number, number]> => {
  const centerRows: number[] = [];
  const centerCols: number[] = [];
  const rowStart = top + Math.floor((height - 1) / 2);
  const rowEnd = top + Math.floor(height / 2);
  const colStart = left + Math.floor((width - 1) / 2);
  const colEnd = left + Math.floor(width / 2);

  for (let i = rowStart; i <= rowEnd; i += 1) {
    centerRows.push(i);
  }
  for (let j = colStart; j <= colEnd; j += 1) {
    centerCols.push(j);
  }

  const result: Array<[number, number]> = [];
  for (let i = 0; i < centerRows.length; i += 1) {
    for (let j = 0; j < centerCols.length; j += 1) {
      result.push([centerRows[i], centerCols[j]]);
    }
  }
  return result;
};

const buildIslandInfo = (
  id: number,
  top: number,
  left: number,
  height: number,
  width: number,
  m: number,
): IslandInfo => {
  const baseCells: Array<[number, number]> = [];
  const allCells = new Set<number>();
  for (let i = top; i < top + height; i += 1) {
    for (let j = left; j < left + width; j += 1) {
      baseCells.push([i, j]);
      allCells.add(i * m + j);
    }
  }

  return {
    id,
    top,
    left,
    height,
    width,
    centerPoint: [top + (height - 1) / 2, left + (width - 1) / 2],
    centerCells: buildCenterCells(top, left, height, width),
    baseCells,
    allCells,
  };
};

const placeRectIsland = (
  island: IslandInfo,
  gridType: Tile[][],
  islandIdGrid: number[][],
): void => {
  for (let i = 0; i < island.baseCells.length; i += 1) {
    const [x, y] = island.baseCells[i];
    gridType[x][y] = 0;
    islandIdGrid[x][y] = island.id;
  }
};

const pickBestPlayerIslands = (
  candidates: IslandInfo[],
  requiredPlayers: number,
  rng: SeededRandom,
): IslandInfo[] => {
  if (requiredPlayers <= 0) {
    return [];
  }
  if (candidates.length < requiredPlayers) {
    return [];
  }

  const distance = (a: IslandInfo, b: IslandInfo): number =>
    Math.abs(a.centerPoint[0] - b.centerPoint[0]) + Math.abs(a.centerPoint[1] - b.centerPoint[1]);

  const restartCount = Math.min(120, Math.max(30, requiredPlayers * 12));
  let bestSelection: IslandInfo[] = [];
  let bestMinDist = -1;
  let bestAvgDist = -1;

  for (let restart = 0; restart < restartCount; restart += 1) {
    const selected: IslandInfo[] = [];
    selected.push(candidates[rng.intInclusive(0, candidates.length - 1)]);
    const used = new Set<number>([selected[0].id]);

    while (selected.length < requiredPlayers) {
      let bestCandidate: IslandInfo | null = null;
      let bestScore = -1;

      for (let i = 0; i < candidates.length; i += 1) {
        const island = candidates[i];
        if (used.has(island.id)) {
          continue;
        }

        let minDist = Number.POSITIVE_INFINITY;
        let sumDist = 0;
        for (let j = 0; j < selected.length; j += 1) {
          const d = distance(island, selected[j]);
          minDist = Math.min(minDist, d);
          sumDist += d;
        }
        const score = minDist * 1_000_000 + sumDist * 1_000 + rng.next();
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = island;
        }
      }

      if (!bestCandidate) {
        break;
      }
      selected.push(bestCandidate);
      used.add(bestCandidate.id);
    }

    if (selected.length < requiredPlayers) {
      continue;
    }

    let minPairDist = Number.POSITIVE_INFINITY;
    let sumPairDist = 0;
    let pairCount = 0;
    for (let i = 0; i < selected.length; i += 1) {
      for (let j = i + 1; j < selected.length; j += 1) {
        const d = distance(selected[i], selected[j]);
        minPairDist = Math.min(minPairDist, d);
        sumPairDist += d;
        pairCount += 1;
      }
    }

    const avgPairDist = pairCount > 0 ? sumPairDist / pairCount : minPairDist;
    if (
      minPairDist > bestMinDist ||
      (minPairDist === bestMinDist && avgPairDist > bestAvgDist) ||
      (minPairDist === bestMinDist && avgPairDist === bestAvgDist && rng.next() < 0.5)
    ) {
      bestMinDist = minPairDist;
      bestAvgDist = avgPairDist;
      bestSelection = selected;
    }
  }

  return bestSelection;
};

const canPlaceMountainWithoutTrappingCity = (
  n: number,
  m: number,
  gridType: Tile[][],
  x: number,
  y: number,
): boolean => {
  if (!isInBounds(n, m, x, y)) {
    return false;
  }
  if (gridType[x][y] === -1 || gridType[x][y] === -2) {
    return false;
  }

  for (let d = 0; d < 4; d += 1) {
    const cx = x + MOVE_DX[d];
    const cy = y + MOVE_DY[d];
    if (!isInBounds(n, m, cx, cy) || gridType[cx][cy] !== -1) {
      continue;
    }

    let hasExit = false;
    for (let k = 0; k < 4; k += 1) {
      const nx = cx + MOVE_DX[k];
      const ny = cy + MOVE_DY[k];
      if (!isInBounds(n, m, nx, ny)) {
        continue;
      }
      if (nx === x && ny === y) {
        continue;
      }
      if (gridType[nx][ny] !== 1) {
        hasExit = true;
        break;
      }
    }

    if (!hasExit) {
      return false;
    }
  }

  return true;
};

const canAddCoastlineCell = (
  n: number,
  m: number,
  x: number,
  y: number,
  islandIdGrid: number[][],
  addedCoastCells: Set<number>,
): boolean => {
  const surroundingIslandIds = new Set<number>();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!isInBounds(n, m, nx, ny)) {
        continue;
      }
      const islandId = islandIdGrid[nx][ny];
      if (islandId !== -1) {
        surroundingIslandIds.add(islandId);
      }
    }
  }
  if (surroundingIslandIds.size > 1) {
    return false;
  }

  for (let dx = -1; dx <= 1; dx += 2) {
    for (let dy = -1; dy <= 1; dy += 2) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInBounds(n, m, nx, ny)) {
        continue;
      }
      if (addedCoastCells.has(nx * m + ny)) {
        return false;
      }
    }
  }

  const start = x * m + y;
  const stack = [start];
  const visited = new Set<number>([start]);

  while (stack.length > 0) {
    const idx = stack.pop();
    if (typeof idx === 'undefined') {
      continue;
    }
    const cx = Math.floor(idx / m);
    const cy = idx % m;
    for (let d = 0; d < 4; d += 1) {
      const nx = cx + MOVE_DX[d];
      const ny = cy + MOVE_DY[d];
      if (!isInBounds(n, m, nx, ny)) {
        continue;
      }
      const next = nx * m + ny;
      if (!addedCoastCells.has(next) || visited.has(next)) {
        continue;
      }
      visited.add(next);
      stack.push(next);
    }
  }

  return visited.size < COASTLINE_MAX_CONNECTED_LEN_EXCLUSIVE;
};

const applyCoastlineNoise = (
  rng: SeededRandom,
  n: number,
  m: number,
  gridType: Tile[][],
  islandIdGrid: number[][],
  islandsById: Map<number, IslandInfo>,
): void => {
  const addedCoastCells = new Set<number>();
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] !== 2) {
        continue;
      }
      candidates.push([i, j]);
    }
  }

  shuffle(candidates, rng);
  for (let idx = 0; idx < candidates.length; idx += 1) {
    if (rng.next() > COASTLINE_EXPAND_PROBABILITY) {
      continue;
    }

    const [x, y] = candidates[idx];
    if (gridType[x][y] !== 2) {
      continue;
    }

    const adjacentIslands = new Set<number>();
    for (let d = 0; d < 4; d += 1) {
      const nx = x + MOVE_DX[d];
      const ny = y + MOVE_DY[d];
      if (!isInBounds(n, m, nx, ny)) {
        continue;
      }
      const islandId = islandIdGrid[nx][ny];
      if (islandId !== -1) {
        adjacentIslands.add(islandId);
      }
    }

    if (adjacentIslands.size !== 1) {
      continue;
    }
    if (!canAddCoastlineCell(n, m, x, y, islandIdGrid, addedCoastCells)) {
      continue;
    }

    const islandId = adjacentIslands.values().next().value as number;
    gridType[x][y] = 0;
    islandIdGrid[x][y] = islandId;
    islandsById.get(islandId)?.allCells.add(x * m + y);
    addedCoastCells.add(x * m + y);
  }
};

const placePlayerIslands = (
  rng: SeededRandom,
  n: number,
  m: number,
  gridType: Tile[][],
  armyCnt: number[][],
  selectedPlayerIslands: IslandInfo[],
): boolean => {
  for (let i = 0; i < selectedPlayerIslands.length; i += 1) {
    const island = selectedPlayerIslands[i];
    const centerCandidates = island.centerCells.filter(([x, y]) => gridType[x][y] === 0);
    if (centerCandidates.length === 0) {
      return false;
    }

    shuffle(centerCandidates, rng);
    let placedCenterLayout = false;
    for (let candidateIndex = 0; candidateIndex < centerCandidates.length; candidateIndex += 1) {
      const [cityX, cityY] = centerCandidates[candidateIndex];
      gridType[cityX][cityY] = -1;
      armyCnt[cityX][cityY] = 15;

      let valid = true;
      for (let j = 0; j < centerCandidates.length; j += 1) {
        if (j === candidateIndex) {
          continue;
        }
        const [mx, my] = centerCandidates[j];
        if (!canPlaceMountainWithoutTrappingCity(n, m, gridType, mx, my)) {
          valid = false;
          break;
        }
        gridType[mx][my] = 1;
      }

      if (valid) {
        placedCenterLayout = true;
        break;
      }

      for (let j = 0; j < centerCandidates.length; j += 1) {
        const [rx, ry] = centerCandidates[j];
        gridType[rx][ry] = 0;
        armyCnt[rx][ry] = 0;
      }
    }

    if (!placedCenterLayout) {
      return false;
    }

    const centerSet = new Set<number>(island.centerCells.map(([x, y]) => x * m + y));
    const spawnCandidates = island.baseCells.filter(
      ([x, y]) => gridType[x][y] === 0 && !centerSet.has(x * m + y),
    );
    if (spawnCandidates.length === 0) {
      return false;
    }
    const spawnIndex = rng.intInclusive(0, spawnCandidates.length - 1);
    const [spawnX, spawnY] = spawnCandidates[spawnIndex];
    gridType[spawnX][spawnY] = -2;
  }

  return true;
};

const placeNeutralIslands = (
  rng: SeededRandom,
  n: number,
  m: number,
  gridType: Tile[][],
  armyCnt: number[][],
  islands: IslandInfo[],
  playerIslandIds: Set<number>,
): void => {
  for (let i = 0; i < islands.length; i += 1) {
    const island = islands[i];
    if (playerIslandIds.has(island.id)) {
      continue;
    }

    const centerCells = island.centerCells.filter(([x, y]) => gridType[x][y] === 0);
    if (centerCells.length === 0) {
      continue;
    }
    shuffle(centerCells, rng);

    let maxCities = 1;
    if ((island.height === 3 && island.width === 4) || (island.height === 4 && island.width === 3)) {
      maxCities = 2;
    } else if (island.height === 4 && island.width === 4) {
      maxCities = 4;
    }

    const cityCount = Math.min(centerCells.length, rng.intInclusive(1, maxCities));
    for (let j = 0; j < centerCells.length; j += 1) {
      const [x, y] = centerCells[j];
      if (j < cityCount) {
        gridType[x][y] = -1;
        armyCnt[x][y] = rng.intInclusive(40, 50);
      } else {
        if (!canPlaceMountainWithoutTrappingCity(n, m, gridType, x, y)) {
          continue;
        }
        gridType[x][y] = 1;
      }
    }
  }
};

const placeIslandMountains = (
  rng: SeededRandom,
  n: number,
  m: number,
  gridType: Tile[][],
  islands: IslandInfo[],
): void => {
  for (let i = 0; i < islands.length; i += 1) {
    const island = islands[i];
    const mountainCount = rng.intInclusive(1, 2);
    const candidates: Array<[number, number]> = [];
    for (const idx of island.allCells) {
      const x = Math.floor(idx / m);
      const y = idx % m;
      if (gridType[x][y] === 0) {
        candidates.push([x, y]);
      }
    }

    shuffle(candidates, rng);
    let placed = 0;
    for (let j = 0; j < candidates.length && placed < mountainCount; j += 1) {
      const [x, y] = candidates[j];
      if (!canPlaceMountainWithoutTrappingCity(n, m, gridType, x, y)) {
        continue;
      }
      gridType[x][y] = 1;
      placed += 1;
    }
  }
};

const placeSwampMountains = (
  rng: SeededRandom,
  n: number,
  m: number,
  gridType: Tile[][],
  islandIdGrid: number[][],
  totalCells: number,
): void => {
  const swampCells: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (gridType[i][j] === 2 && islandIdGrid[i][j] === -1) {
        swampCells.push([i, j]);
      }
    }
  }

  shuffle(swampCells, rng);
  const target = Math.min(
    swampCells.length,
    Math.max(1, Math.floor(totalCells * (0.004 + rng.next() * 0.004))),
  );
  let placed = 0;
  for (let i = 0; i < swampCells.length && placed < target; i += 1) {
    const [x, y] = swampCells[i];
    let valid = true;
    for (let dx = -1; dx <= 1 && valid; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (!isInBounds(n, m, nx, ny)) {
          continue;
        }
        if (islandIdGrid[nx][ny] !== -1) {
          valid = false;
          break;
        }
      }
    }
    if (!valid) {
      continue;
    }
    if (!canPlaceMountainWithoutTrappingCity(n, m, gridType, x, y)) {
      continue;
    }
    gridType[x][y] = 1;
    placed += 1;
  }
};

const generateArchipelagoMap = (
  rng: SeededRandom,
  config: ArchipelagoMapGenerationConfig,
): GeneratedMap => {
  const { n, m } = computeBaseMapDimensions(rng, config.heightRatio, config.widthRatio);
  const requiredPlayers = Math.max(0, config.requiredPlayers);

  for (let mapAttempt = 0; mapAttempt < MAP_RETRY_LIMIT; mapAttempt += 1) {
    const owner = build2D(n, m, 0);
    const armyCnt = build2D(n, m, 0);
    const gridType = build2D<Tile>(n, m, 2);
    const islandIdGrid = build2D(n, m, -1);
    const islands: IslandInfo[] = [];
    const islandsById = new Map<number, IslandInfo>();

    const totalCells = n * m;
    const targetIslandCount = requiredPlayers * 2 + 1;
    const targetIslandArea = Math.floor(totalCells / 2) + 1;

    let islandArea = 0;
    let nextIslandId = 0;

    while (islands.length <= requiredPlayers * 2 || islandArea < targetIslandArea) {
      const sizeOrder = [...RECT_SIZES];
      shuffle(sizeOrder, rng);

      let placed = false;
      for (let s = 0; s < sizeOrder.length; s += 1) {
        const [height, width] = sizeOrder[s];
        const placements = collectPlacementsForSize(gridType, n, m, height, width);
        if (placements.length === 0) {
          continue;
        }

        const [top, left] = placements[rng.intInclusive(0, placements.length - 1)];
        const island = buildIslandInfo(nextIslandId, top, left, height, width, m);
        placeRectIsland(island, gridType, islandIdGrid);
        islands.push(island);
        islandsById.set(island.id, island);
        nextIslandId += 1;
        islandArea += height * width;
        placed = true;
        break;
      }

      if (placed) {
        if (islands.length > targetIslandCount && islandArea >= targetIslandArea) {
          break;
        }
        continue;
      }

      const minPlacements = collectPlacementsForSize(gridType, n, m, 3, 3);
      if (minPlacements.length === 0) {
        break;
      }
    }

    if (islands.length < requiredPlayers) {
      continue;
    }

    applyCoastlineNoise(rng, n, m, gridType, islandIdGrid, islandsById);

    const playerCandidates = islands.filter((island) => island.baseCells.length >= 2);
    const selectedPlayerIslands = pickBestPlayerIslands(playerCandidates, requiredPlayers, rng);
    if (selectedPlayerIslands.length < requiredPlayers) {
      continue;
    }

    const playerIslandIds = new Set<number>(selectedPlayerIslands.map((island) => island.id));
    if (!placePlayerIslands(rng, n, m, gridType, armyCnt, selectedPlayerIslands)) {
      continue;
    }

    placeNeutralIslands(rng, n, m, gridType, armyCnt, islands, playerIslandIds);
    placeIslandMountains(rng, n, m, gridType, islands);
    placeSwampMountains(rng, n, m, gridType, islandIdGrid, totalCells);

    const st = build2D(n, m, false);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        st[i][j] = gridType[i][j] !== 1 && gridType[i][j] !== 2;
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
  }

  return generateRandomMap(rng, config);
};

export { generateArchipelagoMap };
