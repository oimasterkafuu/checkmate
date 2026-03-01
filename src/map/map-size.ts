import { MAX_TEAMS } from '../types';

const resolveMapSizeRatioByPlayers = (playingCount: number): number => {
  const minPlayers = 2;
  const maxPlayers = MAX_TEAMS;
  const clampedPlayingCount = Math.max(minPlayers, Math.min(maxPlayers, playingCount));
  const x = clampedPlayingCount - minPlayers;
  const ratio = 0.34 + 0.1067857143 * x - 0.0030357143 * x * x;
  return Math.max(0.34, ratio);
};

export { resolveMapSizeRatioByPlayers };
