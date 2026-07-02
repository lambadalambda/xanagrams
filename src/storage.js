import { previousDateString } from './features.js';

export const PROGRESS_STORAGE_KEY = 'zanagrams-progress';
export const STATS_STORAGE_KEY = 'zanagrams-stats';

const readJson = (storage, key) => {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (storage, key, value) => {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; progress simply does not persist.
  }
};

export const loadProgress = (storage) => {
  const progress = readJson(storage, PROGRESS_STORAGE_KEY);

  if (
    !progress ||
    typeof progress.mode !== 'string' ||
    typeof progress.spec?.seed !== 'string' ||
    !Array.isArray(progress.foundWordIds) ||
    !Array.isArray(progress.bonusWordIds)
  ) {
    return null;
  }

  return progress;
};

export const saveProgress = (storage, progress) => writeJson(storage, PROGRESS_STORAGE_KEY, progress);

export const clearProgress = (storage) => {
  try {
    storage?.removeItem(PROGRESS_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
};

export const loadStats = (storage) => ({
  tutorialDone: false,
  bestTimes: {},
  dailyStreak: 0,
  lastDailyDate: null,
  ...readJson(storage, STATS_STORAGE_KEY),
});

export const saveStats = (storage, stats) => writeJson(storage, STATS_STORAGE_KEY, stats);

export const recordCompletion = (stats, { mode, elapsedMs, dateString }) => {
  const previousBest = stats.bestTimes[mode];
  const isNewBest = typeof elapsedMs === 'number' && (previousBest === undefined || elapsedMs < previousBest);
  const next = {
    ...stats,
    bestTimes: isNewBest ? { ...stats.bestTimes, [mode]: elapsedMs } : stats.bestTimes,
  };

  if (mode === 'daily' && dateString && stats.lastDailyDate !== dateString) {
    next.dailyStreak = stats.lastDailyDate === previousDateString(dateString) ? stats.dailyStreak + 1 : 1;
    next.lastDailyDate = dateString;
  }

  return { stats: next, isNewBest, previousBest };
};
