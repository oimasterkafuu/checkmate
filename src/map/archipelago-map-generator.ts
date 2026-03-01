import { MOVE_DX, MOVE_DY, SeededRandom, Tile, build2D, computeBaseMapDimensions, shuffle } from './map-core';
import { generateRandomMap } from './random-map-generator';
import type { GeneratedMap, MapGenerationConfig } from './random-map-generator';

interface ArchipelagoMapGenerationConfig extends MapGenerationConfig {
  requiredPlayers: number;
}

interface IslandInfo {
  id: number;
  cells: Array<[number, number]>;
}

const GENERATION_RETRY_LIMIT = 120;
const ISLAND_MIN_SIZE = 4;
const PLAYER_ISLAND_MIN_SIZE = 7;

const isInBounds = (n: number, m: number, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < n && y < m;

const canClaimLandCell = (
  n: number,
  m: number,
  x: number,
  y: number,
  islandId: number,
  islandIdGrid: number[][],
  gridType: Tile[][],
): boolean => {
  if (!isInBounds(n, m, x, y) || x === 0 || y === 0 || x === n - 1 || y === m - 1) {
    return false;
  }
  if (gridType[x][y] !== 2) {
    return false;
  }

  for (let d = 0; d < 4; d += 1) {
    const nx = x + MOVE_DX[d];
    const ny = y + MOVE_DY[d];
    if (!isInBounds(n, m, nx, ny)) {
      continue;
    }
    const nearIslandId = islandIdGrid[nx][ny];
    if (nearIslandId !== -1 && nearIslandId !== islandId) {
      return false;
    }
  }

  return true;
};

const isIslandConnectedAfterBlocking = (
  islandSet: Set<number>,
  blocked: Set<number>,
  n: number,
  m: number,
): boolean => {
  const target = islandSet.size - blocked.size;
  if (target <= 0) {
    return false;
  }

  let start = -1;
  for (const idx of islandSet) {
    if (!blocked.has(idx)) {
      start = idx;
      break;
    }
  }
  if (start === -1) {
    return false;
  }

  const queue: number[] = [start];
  const visited = new Set<number>([start]);

  while (queue.length > 0) {
    const idx = queue.pop();
    if (typeof idx === 'undefined') {
      continue;
    }
    const x = Math.floor(idx / m);
    const y = idx % m;
    for (let d = 0; d < 4; d += 1) {
      const nx = x + MOVE_DX[d];
      const ny = y + MOVE_DY[d];
      if (!isInBounds(n, m, nx, ny)) {
        continue;
      }
      const nextIdx = nx * m + ny;
      if (!islandSet.has(nextIdx) || blocked.has(nextIdx) || visited.has(nextIdx)) {
        continue;
      }
      visited.add(nextIdx);
      queue.push(nextIdx);
    }
  }

  return visited.size === target;
};

const generateArchipelagoMap = (
  rng: SeededRandom,
  config: ArchipelagoMapGenerationConfig,
): GeneratedMap => {
  const { n, m } = computeBaseMapDimensions(rng, config.heightRatio, config.widthRatio);
  const requiredPlayers = Math.max(0, config.requiredPlayers);

  for (let mapAttempt = 0; mapAttempt < GENERATION_RETRY_LIMIT; mapAttempt += 1) {
    const owner = build2D(n, m, 0);
    const armyCnt = build2D(n, m, 0);
    const gridType = build2D<Tile>(n, m, 2);
    const islandIdGrid = build2D(n, m, -1);
    const islands: IslandInfo[] = [];

    const totalCells = n * m;
    const targetIslandCount = Math.max(
      requiredPlayers + 4,
      Math.min(34, Math.floor(totalCells / 36) + rng.intInclusive(0, 4)),
    );
    const targetLandCells = Math.max(
      targetIslandCount * 6,
      Math.floor(totalCells * (0.2 + rng.next() * 0.06)),
    );
    const targetLargeIslands = Math.min(targetIslandCount, requiredPlayers + 3 + Math.floor(requiredPlayers / 2));

    let createdLandCells = 0;
    let createdLargeIslands = 0;
    let nextIslandId = 0;

    const maxIslandBuildAttempts = targetIslandCount * 18;
    for (
      let buildAttempt = 0;
      buildAttempt < maxIslandBuildAttempts &&
      (islands.length < targetIslandCount || createdLandCells < targetLandCells);
      buildAttempt += 1
    ) {
      const wantsLargeIsland = createdLargeIslands < targetLargeIslands && rng.next() < 0.88;
      const minSize = wantsLargeIsland ? PLAYER_ISLAND_MIN_SIZE : ISLAND_MIN_SIZE;
      const maxSize = wantsLargeIsland ? 16 : 10;
      const targetSize = rng.intInclusive(minSize, maxSize);

      let seed: [number, number] | null = null;
      for (let seedAttempt = 0; seedAttempt < 160; seedAttempt += 1) {
        const x = rng.intInclusive(1, n - 2);
        const y = rng.intInclusive(1, m - 2);
        if (!canClaimLandCell(n, m, x, y, nextIslandId, islandIdGrid, gridType)) {
          continue;
        }
        seed = [x, y];
        break;
      }
      if (!seed) {
        continue;
      }

      const cells: Array<[number, number]> = [seed];
      const frontier: Array<[number, number]> = [seed];
      gridType[seed[0]][seed[1]] = 0;
      islandIdGrid[seed[0]][seed[1]] = nextIslandId;

      let growAttempt = 0;
      while (frontier.length > 0 && cells.length < targetSize && growAttempt < targetSize * 32) {
        growAttempt += 1;
        const frontierIdx = rng.intInclusive(0, frontier.length - 1);
        const [x, y] = frontier[frontierIdx];
        const dirs = [0, 1, 2, 3];
        shuffle(dirs, rng);

        let expanded = false;
        for (let k = 0; k < dirs.length; k += 1) {
          const d = dirs[k];
          const nx = x + MOVE_DX[d];
          const ny = y + MOVE_DY[d];
          if (!canClaimLandCell(n, m, nx, ny, nextIslandId, islandIdGrid, gridType)) {
            continue;
          }
          gridType[nx][ny] = 0;
          islandIdGrid[nx][ny] = nextIslandId;
          cells.push([nx, ny]);
          frontier.push([nx, ny]);
          expanded = true;
          break;
        }

        if (!expanded) {
          const lastIdx = frontier.length - 1;
          [frontier[frontierIdx], frontier[lastIdx]] = [frontier[lastIdx], frontier[frontierIdx]];
          frontier.pop();
        }
      }

      if (cells.length < minSize) {
        for (let i = 0; i < cells.length; i += 1) {
          const [x, y] = cells[i];
          gridType[x][y] = 2;
          islandIdGrid[x][y] = -1;
        }
        continue;
      }

      islands.push({ id: nextIslandId, cells });
      createdLandCells += cells.length;
      if (cells.length >= PLAYER_ISLAND_MIN_SIZE) {
        createdLargeIslands += 1;
      }
      nextIslandId += 1;
    }

    const minNeutralIslands = Math.max(4, Math.min(9, Math.floor(requiredPlayers * 0.6) + 3));
    if (islands.length < requiredPlayers + minNeutralIslands) {
      continue;
    }

    const swampCells: Array<[number, number]> = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (gridType[i][j] === 2) {
          swampCells.push([i, j]);
        }
      }
    }
    shuffle(swampCells, rng);
    const reefTarget = Math.min(
      swampCells.length,
      Math.floor(totalCells * (0.006 + config.mountainRatio * 0.012)),
    );
    for (let i = 0; i < reefTarget; i += 1) {
      const [x, y] = swampCells[i];
      gridType[x][y] = 1;
    }

    for (let islandIndex = 0; islandIndex < islands.length; islandIndex += 1) {
      const island = islands[islandIndex];
      const islandSet = new Set<number>();
      for (let i = 0; i < island.cells.length; i += 1) {
        const [x, y] = island.cells[i];
        islandSet.add(x * m + y);
      }

      let mountainTarget = 0;
      if (island.cells.length >= 8 && rng.next() < 0.5) {
        mountainTarget += 1;
      }
      if (island.cells.length >= 13 && rng.next() < 0.2 + config.mountainRatio * 0.2) {
        mountainTarget += 1;
      }
      mountainTarget = Math.min(mountainTarget, Math.max(0, island.cells.length - 5));
      if (mountainTarget <= 0) {
        continue;
      }

      const candidates = [...island.cells];
      shuffle(candidates, rng);
      const blocked = new Set<number>();
      for (let i = 0; i < candidates.length && blocked.size < mountainTarget; i += 1) {
        const [x, y] = candidates[i];
        const idx = x * m + y;
        blocked.add(idx);
        if (!isIslandConnectedAfterBlocking(islandSet, blocked, n, m)) {
          blocked.delete(idx);
          continue;
        }
      }

      for (const idx of blocked) {
        const x = Math.floor(idx / m);
        const y = idx % m;
        gridType[x][y] = 1;
      }
    }

    const eligiblePlayerIslands = islands.filter((island) => {
      let passable = 0;
      for (let i = 0; i < island.cells.length; i += 1) {
        const [x, y] = island.cells[i];
        if (gridType[x][y] === 0) {
          passable += 1;
        }
      }
      return passable >= PLAYER_ISLAND_MIN_SIZE;
    });

    if (eligiblePlayerIslands.length < requiredPlayers) {
      continue;
    }

    shuffle(eligiblePlayerIslands, rng);
    const playerIslandIds = new Set<number>();
    for (let i = 0; i < requiredPlayers; i += 1) {
      playerIslandIds.add(eligiblePlayerIslands[i].id);
    }

    let generationValid = true;
    for (let islandIndex = 0; islandIndex < islands.length; islandIndex += 1) {
      const island = islands[islandIndex];
      const passableCells: Array<[number, number]> = [];
      for (let i = 0; i < island.cells.length; i += 1) {
        const [x, y] = island.cells[i];
        if (gridType[x][y] === 0) {
          passableCells.push([x, y]);
        }
      }

      if (passableCells.length < 2) {
        generationValid = false;
        break;
      }
      shuffle(passableCells, rng);

      const isPlayerIsland = playerIslandIds.has(island.id);
      const [cityAx, cityAy] = passableCells[0];
      const [cityBx, cityBy] = passableCells[1];
      gridType[cityAx][cityAy] = -1;
      gridType[cityBx][cityBy] = -1;
      armyCnt[cityAx][cityAy] = isPlayerIsland ? 15 : rng.intInclusive(40, 50);
      armyCnt[cityBx][cityBy] = isPlayerIsland ? 15 : rng.intInclusive(40, 50);

      if (!isPlayerIsland) {
        continue;
      }

      const spawnCandidates = passableCells.slice(2);
      if (spawnCandidates.length === 0) {
        generationValid = false;
        break;
      }

      let centerX = 0;
      let centerY = 0;
      for (let i = 0; i < island.cells.length; i += 1) {
        centerX += island.cells[i][0];
        centerY += island.cells[i][1];
      }
      centerX /= island.cells.length;
      centerY /= island.cells.length;

      let minDistance = Number.POSITIVE_INFINITY;
      const distances: number[] = [];
      for (let i = 0; i < spawnCandidates.length; i += 1) {
        const [x, y] = spawnCandidates[i];
        const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
        distances.push(distance);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }

      const farCandidates: Array<[number, number]> = [];
      for (let i = 0; i < spawnCandidates.length; i += 1) {
        if (distances[i] > minDistance) {
          farCandidates.push(spawnCandidates[i]);
        }
      }
      const spawnPool = farCandidates.length > 0 ? farCandidates : spawnCandidates;
      const [spawnX, spawnY] = spawnPool[rng.intInclusive(0, spawnPool.length - 1)];
      gridType[spawnX][spawnY] = -2;
    }

    if (!generationValid) {
      continue;
    }

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
