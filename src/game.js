import { COMMON_WORDS } from './common-words.js';
import { generatePuzzle } from './generator.js';

const edgeKey = (from, to) => [from, to].sort().join('|');

const makeEdgesFromWords = (words) => {
  const seen = new Set();

  return words.flatMap((word) =>
    word.path.slice(0, -1).flatMap((from, index) => {
      const to = word.path[index + 1];
      const key = edgeKey(from, to);

      if (seen.has(key)) {
        return [];
      }

      seen.add(key);
      return [[from, to]];
    }),
  );
};

export const tutorialPuzzle = {
  id: 'tutorial',
  title: 'Tutorial',
  nodes: [
    { id: 'playP', letter: 'P', x: 12, y: 14 },
    { id: 'playL', letter: 'L', x: 37, y: 14 },
    { id: 'sharedA', letter: 'A', x: 62, y: 14 },
    { id: 'playY', letter: 'Y', x: 87, y: 14 },
    { id: 'nextN', letter: 'N', x: 12, y: 38 },
    { id: 'topT', letter: 'T', x: 37, y: 38 },
    { id: 'middleI', letter: 'I', x: 62, y: 38 },
    { id: 'rightL', letter: 'L', x: 87, y: 38 },
    { id: 'leftU', letter: 'U', x: 12, y: 62 },
    { id: 'nextE', letter: 'E', x: 37, y: 62 },
    { id: 'rightR', letter: 'R', x: 62, y: 62 },
    { id: 'rightS', letter: 'S', x: 87, y: 62 },
    { id: 'leftT', letter: 'T', x: 12, y: 86 },
    { id: 'bottomO', letter: 'O', x: 37, y: 86 },
    { id: 'nextX', letter: 'X', x: 62, y: 86 },
    { id: 'nextT', letter: 'T', x: 87, y: 86 },
  ],
  words: [
    { id: 'play', text: 'PLAY', path: ['playP', 'playL', 'sharedA', 'playY'] },
    { id: 'next', text: 'NEXT', path: ['nextN', 'nextE', 'nextX', 'nextT'] },
    {
      id: 'tutorials',
      text: 'TUTORIALS',
      path: ['topT', 'leftU', 'leftT', 'bottomO', 'rightR', 'middleI', 'sharedA', 'rightL', 'rightS'],
    },
  ],
  tutorialSteps: [
    {
      wordId: 'play',
      heading: 'Welcome to Zanagrams',
      promptStart: 'Drag',
      promptEnd: 'to begin',
    },
    {
      wordId: 'next',
      heading: 'Letters disappear when no longer needed.',
      promptStart: 'Drag',
      promptEnd: 'to continue',
    },
    {
      wordId: 'tutorials',
      heading: 'Find all the words to complete the puzzle',
      promptStart: 'Drag',
      promptEnd: 'to finish',
    },
  ],
};

export const starterPuzzle = generatePuzzle({
  id: 'starter',
  title: 'Zanagrams #1',
  rankedWords: COMMON_WORDS,
  seed: 'board',
  targetWordCount: 5,
  minRequiredWords: 8,
  maxRequiredWords: 15,
  targetEdges: 20,
  maxEdges: 23,
  requiredMaxRank: 1500,
  bonusMaxRank: 25000,
  attempts: 80,
  seedBoards: [],
});

export const createRandomPuzzle = ({ seed = `random-${Date.now()}`, number = 1 } = {}) =>
  generatePuzzle({
    id: `random-${seed}`,
    title: `Zanagrams #${number}`,
    rankedWords: COMMON_WORDS,
    seed,
    targetWordCount: 5,
    minRequiredWords: 8,
    maxRequiredWords: 15,
    targetEdges: 20,
    maxEdges: 23,
    requiredMaxRank: 1500,
    bonusMaxRank: 25000,
    attempts: 80,
    seedBoards: [],
  });

export const puzzles = [tutorialPuzzle, starterPuzzle];

export const normalizeWord = (word) => word.toUpperCase().replace(/[^A-Z]/g, '');

export const createGameState = (puzzle) => ({
  puzzleId: puzzle.id,
  foundWordIds: [],
  bonusWordIds: [],
  message: { kind: 'idle', text: '' },
  complete: false,
});

export const getNodeMap = (puzzle) => new Map(puzzle.nodes.map((node) => [node.id, node]));

export const getRequiredWords = (puzzle) => puzzle.words ?? [];

export const getBonusWords = (puzzle) => puzzle.bonusWords ?? [];

export const getWordMap = (puzzle) =>
  new Map([...getRequiredWords(puzzle), ...getBonusWords(puzzle)].map((word) => [word.id, word]));

export const getSelectionWord = (puzzle, path) => {
  const nodes = getNodeMap(puzzle);
  return path.map((nodeId) => nodes.get(nodeId)?.letter ?? '').join('');
};

export const getFoundWordSet = (foundWordIds) => new Set(foundWordIds);

export const getRemainingWords = (puzzle, foundWordIds) => {
  const foundWords = getFoundWordSet(foundWordIds);
  return getRequiredWords(puzzle).filter((word) => !foundWords.has(word.id));
};

export const getRemainingBonusWords = (puzzle, bonusWordIds = []) => {
  const foundWords = getFoundWordSet(bonusWordIds);
  return getBonusWords(puzzle).filter((word) => !foundWords.has(word.id));
};

export const getActiveNodeIds = (puzzle, foundWordIds) =>
  new Set(getRemainingWords(puzzle, foundWordIds).flatMap((word) => word.path));

export const getActiveEdges = (puzzle, foundWordIds) => makeEdgesFromWords(getRemainingWords(puzzle, foundWordIds));

export const getAllEdges = (puzzle) => makeEdgesFromWords(puzzle.words);

export const areAdjacent = (puzzle, from, to, foundWordIds = null) => {
  const edges = foundWordIds ? getActiveEdges(puzzle, foundWordIds) : getAllEdges(puzzle);
  const targetKey = edgeKey(from, to);
  return edges.some(([edgeFrom, edgeTo]) => edgeKey(edgeFrom, edgeTo) === targetKey);
};

export const isValidPath = (puzzle, foundWordIds, path) => {
  if (path.length === 0) {
    return false;
  }

  const activeNodes = getActiveNodeIds(puzzle, foundWordIds);
  const uniqueNodes = new Set(path);

  if (uniqueNodes.size !== path.length || path.some((nodeId) => !activeNodes.has(nodeId))) {
    return false;
  }

  return path.slice(0, -1).every((from, index) => areAdjacent(puzzle, from, path[index + 1], foundWordIds));
};

const isValidPuzzlePath = (puzzle, path) => {
  if (path.length === 0 || new Set(path).size !== path.length) {
    return false;
  }

  const nodes = getNodeMap(puzzle);

  if (path.some((nodeId) => !nodes.has(nodeId))) {
    return false;
  }

  return path.slice(0, -1).every((from, index) => areAdjacent(puzzle, from, path[index + 1]));
};

const findAlreadyFoundWord = (puzzle, state, path) => {
  if (!isValidPuzzlePath(puzzle, path)) {
    return null;
  }

  const selectedWord = normalizeWord(getSelectionWord(puzzle, path));
  const foundRequiredIds = getFoundWordSet(state.foundWordIds);
  const foundBonusIds = getFoundWordSet(state.bonusWordIds);

  return (
    getRequiredWords(puzzle).find((word) => foundRequiredIds.has(word.id) && normalizeWord(word.text) === selectedWord) ??
    getBonusWords(puzzle).find((word) => foundBonusIds.has(word.id) && normalizeWord(word.text) === selectedWord) ??
    null
  );
};

export const findMatchingWord = (puzzle, foundWordIds, path, bonusWordIds = []) => {
  if (!isValidPath(puzzle, foundWordIds, path)) {
    return null;
  }

  const selectedWord = normalizeWord(getSelectionWord(puzzle, path));
  const requiredWord = getRemainingWords(puzzle, foundWordIds).find(
    (word) => normalizeWord(word.text) === selectedWord,
  );

  if (requiredWord) {
    return { ...requiredWord, kind: 'required' };
  }

  const bonusWord = getRemainingBonusWords(puzzle, bonusWordIds).find(
    (word) => normalizeWord(word.text) === selectedWord,
  );

  return bonusWord ? { ...bonusWord, kind: 'bonus' } : null;
};

export const submitPath = (state, path, puzzleOverride = null) => {
  const puzzle = puzzleOverride ?? puzzles.find((candidate) => candidate.id === state.puzzleId) ?? tutorialPuzzle;
  const selectedWord = getSelectionWord(puzzle, path);
  const alreadyFoundWord = findAlreadyFoundWord(puzzle, state, path);

  if (alreadyFoundWord) {
    return {
      ...state,
      message: { kind: 'already-found', text: `${alreadyFoundWord.text} already found.` },
    };
  }

  if (!isValidPath(puzzle, state.foundWordIds, path)) {
    return {
      ...state,
      message: { kind: 'error', text: selectedWord ? `${selectedWord} is not a valid connected path.` : 'Choose connected letters.' },
    };
  }

  const matchingWord = findMatchingWord(puzzle, state.foundWordIds, path, state.bonusWordIds);

  if (!matchingWord) {
    return {
      ...state,
      message: { kind: 'error', text: `${selectedWord} is not hidden here.` },
    };
  }

  if (matchingWord.kind === 'bonus') {
    return {
      ...state,
      bonusWordIds: [...state.bonusWordIds, matchingWord.id],
      message: { kind: 'bonus', text: `Bonus word: ${matchingWord.text}!` },
    };
  }

  const foundWordIds = [...state.foundWordIds, matchingWord.id];
  const complete = foundWordIds.length === getRequiredWords(puzzle).length;

  return {
    ...state,
    foundWordIds,
    complete,
    message: {
      kind: complete ? 'success' : 'found',
      text: complete ? 'Puzzle complete!' : `${matchingWord.text} found.`,
    },
  };
};
