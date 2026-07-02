export const DAILY_EPOCH = '2026-07-01';

const msPerDay = 24 * 60 * 60 * 1000;

export const localDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const dailyNumber = (dateString) =>
  Math.round((Date.parse(`${dateString}T00:00:00Z`) - Date.parse(`${DAILY_EPOCH}T00:00:00Z`)) / msPerDay) + 1;

export const dailySeed = (dateString) => `daily-${dateString}`;

export const previousDateString = (dateString) =>
  new Date(Date.parse(`${dateString}T00:00:00Z`) - msPerDay).toISOString().slice(0, 10);

export const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const hintsAvailable = ({ bonusWordCount = 0, hintsUsed = 0 } = {}) =>
  Math.max(0, 1 + Math.floor(bonusWordCount / 2) - hintsUsed);
