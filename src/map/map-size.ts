import { MAX_TEAMS } from '../types';

const resolveMapSizeRatioByPlayers = (playingCount: number): number => {
  const clampedPlayingCount = Math.max(2, Math.min(MAX_TEAMS, playingCount));
  if (clampedPlayingCount <= 2) {
    return 0.28;
  }
  if (clampedPlayingCount === 3) {
    return 0.3;
  }
  if (clampedPlayingCount === 4) {
    return 0.32;
  }
  if (clampedPlayingCount <= 10) {
    const progress = (clampedPlayingCount - 4) / (10 - 4);
    return 0.32 + progress * (0.76 - 0.32);
  }
  const progress = (clampedPlayingCount - 10) / (MAX_TEAMS - 10);
  return 0.76 + progress * (0.96 - 0.76);
};

export { resolveMapSizeRatioByPlayers };
