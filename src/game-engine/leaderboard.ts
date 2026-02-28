import { Grid } from '../map/map-core';
import { LeaderboardEntry } from '../types';

interface LeaderboardInput {
  n: number;
  m: number;
  owner: Grid<number>;
  armyCnt: Grid<number>;
  playerSidsLength: number;
  names: string[];
  team: number[];
  pstat: number[];
  deadOrder: number[];
  leftGameValue: number;
}

const buildLeaderboard = (input: LeaderboardInput): LeaderboardEntry[] => {
  const playerValues = Array.from({ length: input.playerSidsLength }, () => [0, 0]);

  for (let i = 0; i < input.n; i += 1) {
    for (let j = 0; j < input.m; j += 1) {
      if (input.owner[i][j] > 0) {
        const idx = input.owner[i][j] - 1;
        playerValues[idx][0] += input.armyCnt[i][j];
        playerValues[idx][1] += 1;
      }
    }
  }

  const leaderboard: LeaderboardEntry[] = [];
  for (let i = 0; i < input.playerSidsLength; i += 1) {
    let className = '';
    if (input.pstat[i] === input.leftGameValue) {
      className = 'dead';
    } else if (input.pstat[i] !== 0) {
      className = 'afk';
    }
    if (input.team[i] !== 0) {
      leaderboard.push({
        team: input.team[i],
        uid: input.names[i],
        army: playerValues[i][0],
        land: playerValues[i][1],
        class_: className,
        dead: input.deadOrder[i],
        id: i + 1,
      });
    }
  }

  return leaderboard;
};

const buildFinalRank = (leaderboard: LeaderboardEntry[]): string[] =>
  [...leaderboard]
    .sort((a, b) => b.dead + b.land * 100 + b.army * 10000000 - (a.dead + a.land * 100 + a.army * 10000000))
    .map((item) => item.uid);

export { buildFinalRank, buildLeaderboard };
