export const SETTINGS_STORAGE_KEY = 'zanagrams-settings';

export const SETTING_DEFINITIONS = [
  {
    key: 'cleanWords',
    label: 'Curated dictionary',
    description: 'Only use real dictionary words — no names, fragments, or profanity. Applies to new puzzles.',
    default: true,
  },
  {
    key: 'distinctWords',
    label: 'Distinct required words',
    description: 'Keep near-duplicates like NAME/NAMES out of the required list; they still count as bonus words. Applies to new puzzles.',
    default: true,
  },
  {
    key: 'dailyPuzzle',
    label: 'Daily puzzle',
    description: 'A numbered puzzle that is the same for everyone on a given day.',
    default: true,
  },
  {
    key: 'timer',
    label: 'Timer & best times',
    description: 'Time each puzzle and remember your best solves.',
    default: true,
  },
  {
    key: 'saveProgress',
    label: 'Save progress',
    description: 'Resume an unfinished puzzle after closing the page.',
    default: true,
  },
  {
    key: 'hints',
    label: 'Hints',
    description: 'Start each puzzle with one hint and earn another for every two bonus words.',
    default: true,
  },
  {
    key: 'definitions',
    label: 'Definitions',
    description: 'Tap a found word to look up its meaning.',
    default: true,
  },
  {
    key: 'feedback',
    label: 'Enhanced feedback',
    description: 'Flash found words, shake wrong guesses, and show a completion summary.',
    default: true,
  },
];

export const defaultSettings = () =>
  Object.fromEntries(SETTING_DEFINITIONS.map((definition) => [definition.key, definition.default]));

export const loadSettings = (storage) => {
  const settings = defaultSettings();

  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;

    if (saved && typeof saved === 'object') {
      for (const { key } of SETTING_DEFINITIONS) {
        if (typeof saved[key] === 'boolean') {
          settings[key] = saved[key];
        }
      }
    }
  } catch {
    // Corrupted storage falls back to defaults.
  }

  return settings;
};

export const saveSettings = (storage, settings) => {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings simply do not persist.
  }
};
