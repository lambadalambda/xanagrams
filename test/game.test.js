import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMON_WORDS, EXCLUDED_WORDS } from '../src/common-words.js';
import {
  areAdjacent,
  createGameState,
  createRandomPuzzle,
  createStarterPuzzle,
  getActiveEdges,
  getActiveNodeIds,
  getAllEdges,
  getSelectionWord,
  getBonusWords,
  getRequiredWords,
  getWordList,
  isValidPath,
  submitPath,
  tutorialPuzzle,
} from '../src/game.js';
import { filterRankedWords, generatePuzzle, getWordSimilarityPenalty } from '../src/generator.js';
import { dailyNumber, dailySeed, formatDuration, hintsAvailable, localDateString, previousDateString } from '../src/features.js';
import { SETTING_DEFINITIONS, defaultSettings, loadSettings, saveSettings } from '../src/settings.js';
import { loadProgress, recordCompletion, saveProgress } from '../src/storage.js';

const starterPuzzle = createStarterPuzzle();

const hasEdge = (edges, firstNodeId, secondNodeId) =>
  edges.some(
    ([from, to]) =>
      (from === firstNodeId && to === secondNodeId) || (from === secondNodeId && to === firstNodeId),
  );

const largestComponentSize = (edges) => {
  const graph = new Map();

  for (const [from, to] of edges) {
    graph.set(from, [...(graph.get(from) ?? []), to]);
    graph.set(to, [...(graph.get(to) ?? []), from]);
  }

  const unvisited = new Set(graph.keys());
  let largest = 0;

  for (const start of graph.keys()) {
    if (!unvisited.has(start)) {
      continue;
    }

    const queue = [start];
    let size = 0;
    unvisited.delete(start);

    while (queue.length > 0) {
      const nodeId = queue.shift();
      size += 1;

      for (const neighbor of graph.get(nodeId) ?? []) {
        if (unvisited.has(neighbor)) {
          unvisited.delete(neighbor);
          queue.push(neighbor);
        }
      }
    }

    largest = Math.max(largest, size);
  }

  return largest;
};

const commonHereFamily = new Set(['HERE', 'HERES', 'THEIR', 'THERE', 'THERES', 'THESE', 'THREE', 'WHERE', 'WHETHER']);

describe('zanagrams game engine', () => {
  it('spells a selected path from connected letters', () => {
    assert.equal(getSelectionWord(tutorialPuzzle, ['playP', 'playL', 'sharedA', 'playY']), 'PLAY');
  });

  it('accepts a hidden word and removes letters no remaining word needs', () => {
    const state = submitPath(createGameState(tutorialPuzzle), ['playP', 'playL', 'sharedA', 'playY']);
    const activeNodes = getActiveNodeIds(tutorialPuzzle, state.foundWordIds);
    const activeEdges = getActiveEdges(tutorialPuzzle, state.foundWordIds);

    assert.deepEqual(state.foundWordIds, ['play']);
    assert.equal(activeNodes.has('playP'), false);
    assert.equal(activeNodes.has('playL'), false);
    assert.equal(activeNodes.has('playY'), false);
    assert.equal(activeNodes.has('sharedA'), true);
    assert.equal(hasEdge(activeEdges, 'playP', 'playL'), false);
    assert.equal(hasEdge(activeEdges, 'sharedA', 'middleI'), true);
  });

  it('rejects a disconnected path without changing solved words', () => {
    const state = createGameState(tutorialPuzzle);
    const nextState = submitPath(state, ['playP', 'sharedA', 'rightL']);

    assert.equal(areAdjacent(tutorialPuzzle, 'playP', 'sharedA'), false);
    assert.equal(isValidPath(tutorialPuzzle, state.foundWordIds, ['playP', 'sharedA', 'rightL']), false);
    assert.deepEqual(nextState.foundWordIds, []);
    assert.equal(nextState.message.kind, 'error');
  });

  it('allows words to be found in any order while preserving shared letters', () => {
    const state = submitPath(createGameState(tutorialPuzzle), [
      'topT',
      'leftU',
      'leftT',
      'bottomO',
      'rightR',
      'middleI',
      'sharedA',
      'rightL',
      'rightS',
    ]);
    const activeNodes = getActiveNodeIds(tutorialPuzzle, state.foundWordIds);

    assert.deepEqual(state.foundWordIds, ['tutorials']);
    assert.equal(activeNodes.has('sharedA'), true);
    assert.equal(activeNodes.has('playP'), true);
    assert.equal(activeNodes.has('nextN'), true);
    assert.equal(activeNodes.has('rightS'), false);
  });

  it('completes the tutorial after all hidden words are submitted', () => {
    const state = [
      ['playP', 'playL', 'sharedA', 'playY'],
      ['nextN', 'nextE', 'nextX', 'nextT'],
      ['topT', 'leftU', 'leftT', 'bottomO', 'rightR', 'middleI', 'sharedA', 'rightL', 'rightS'],
    ].reduce((currentState, path) => submitPath(currentState, path), createGameState(tutorialPuzzle));

    assert.equal(state.complete, true);
    assert.equal(getActiveNodeIds(tutorialPuzzle, state.foundWordIds).size, 0);
  });

  it('accepts bonus words without requiring them to complete the puzzle', () => {
    const puzzle = {
      id: 'bonus-test',
      title: 'Bonus Test',
      nodes: [
        { id: 'n0', letter: 'T', x: 12, y: 12 },
        { id: 'n1', letter: 'I', x: 37, y: 12 },
        { id: 'n2', letter: 'M', x: 62, y: 12 },
        { id: 'n3', letter: 'E', x: 87, y: 12 },
      ],
      words: [{ id: 'time', text: 'TIME', path: ['n0', 'n1', 'n2', 'n3'] }],
      bonusWords: [{ id: 'emit', text: 'EMIT', path: ['n3', 'n2', 'n1', 'n0'] }],
    };
    const bonusState = submitPath(createGameState(puzzle), ['n3', 'n2', 'n1', 'n0'], puzzle);
    const completedState = submitPath(bonusState, ['n0', 'n1', 'n2', 'n3'], puzzle);

    assert.deepEqual(bonusState.foundWordIds, []);
    assert.deepEqual(bonusState.bonusWordIds, ['emit']);
    assert.equal(bonusState.complete, false);
    assert.equal(bonusState.message.kind, 'bonus');
    assert.deepEqual(completedState.foundWordIds, ['time']);
    assert.deepEqual(completedState.bonusWordIds, ['emit']);
    assert.equal(completedState.complete, true);
  });

  it('reports already found for duplicate required and bonus submissions', () => {
    const puzzle = {
      id: 'duplicate-test',
      title: 'Duplicate Test',
      nodes: [
        { id: 'n0', letter: 'T', x: 12, y: 12 },
        { id: 'n1', letter: 'I', x: 37, y: 12 },
        { id: 'n2', letter: 'M', x: 62, y: 12 },
        { id: 'n3', letter: 'E', x: 87, y: 12 },
      ],
      words: [{ id: 'time', text: 'TIME', path: ['n0', 'n1', 'n2', 'n3'] }],
      bonusWords: [{ id: 'emit', text: 'EMIT', path: ['n3', 'n2', 'n1', 'n0'] }],
    };
    const state = createGameState(puzzle);
    const afterRequired = submitPath(state, ['n0', 'n1', 'n2', 'n3'], puzzle);
    const repeatedRequired = submitPath(afterRequired, ['n0', 'n1', 'n2', 'n3'], puzzle);
    const afterBonus = submitPath(state, ['n3', 'n2', 'n1', 'n0'], puzzle);
    const repeatedBonus = submitPath(afterBonus, ['n3', 'n2', 'n1', 'n0'], puzzle);

    assert.equal(repeatedRequired.message.kind, 'already-found');
    assert.equal(repeatedRequired.message.text, 'TIME already found.');
    assert.equal(repeatedBonus.message.kind, 'already-found');
    assert.equal(repeatedBonus.message.text, 'EMIT already found.');
  });

  it('uses a dense 4x4 layout for the playable puzzle', () => {
    const activeNodes = getActiveNodeIds(starterPuzzle, []);
    const edges = getAllEdges(starterPuzzle);

    assert.equal(starterPuzzle.nodes.length, 16);
    assert.equal(activeNodes.size, 16);
    assert.equal(new Set(starterPuzzle.nodes.map((node) => node.x)).size, 4);
    assert.equal(new Set(starterPuzzle.nodes.map((node) => node.y)).size, 4);
    assert.ok(getRequiredWords(starterPuzzle).length >= 8);
    assert.ok(getRequiredWords(starterPuzzle).length <= 15);
    assert.ok(getBonusWords(starterPuzzle).length <= 40);
    assert.ok(getBonusWords(starterPuzzle).length > 0);
    assert.ok(edges.length >= 18);
    assert.ok(edges.length <= 23);
    assert.equal(largestComponentSize(edges), 16);
  });

  it('filters source words to ranked common words with at least four letters', () => {
    assert.deepEqual(
      filterRankedWords(['a', 'cat', 'care', 'CARE', 'river!', 'unknown'], { maxRank: 5 }),
      [
        { text: 'CARE', rank: 2 },
        { text: 'RIVER', rank: 4 },
      ],
    );
  });

  it('generates playable 4x4 puzzles from the ranked common-word list', () => {
    const commonWords = new Set(COMMON_WORDS.map((word) => word.toUpperCase()));
    const puzzle = generatePuzzle({
      id: 'test-generated',
      title: 'Generated Test Puzzle',
      rankedWords: COMMON_WORDS,
      targetWordCount: 5,
      attempts: 80,
      seed: 'board',
      seedBoards: [],
    });

    assert.equal(puzzle.nodes.length, 16);
    assert.ok(getRequiredWords(puzzle).length >= 8);
    assert.ok(getRequiredWords(puzzle).length <= 15);
    assert.ok(getAllEdges(puzzle).length >= 18);
    assert.ok(getAllEdges(puzzle).length <= 23);
    assert.equal(largestComponentSize(getAllEdges(puzzle)), 16);

    for (const word of [...getRequiredWords(puzzle), ...getBonusWords(puzzle)]) {
      assert.ok(word.text.length >= 4);
      assert.ok(commonWords.has(word.text));
      assert.equal(getSelectionWord(puzzle, word.path), word.text);
      assert.equal(isValidPath(puzzle, [], word.path), true);
    }
  });

  it('creates random puzzles within playable count and density caps', () => {
    for (const seed of ['random-test-a', 'random-test-b', 'random-test-c', 'similarity-a']) {
      const puzzle = createRandomPuzzle({ seed, number: 99 });
      const requiredWords = getRequiredWords(puzzle);
      const bonusWords = getBonusWords(puzzle);
      const edges = getAllEdges(puzzle);

      assert.equal(puzzle.nodes.length, 16);
      assert.equal(getActiveNodeIds(puzzle, []).size, 16);
      assert.ok(requiredWords.length >= 8, `${seed} required word count too low`);
      assert.ok(requiredWords.length <= 15, `${seed} required word count too high`);
      assert.ok(bonusWords.length <= 40, `${seed} bonus word count too high`);
      assert.ok(edges.length >= 18, `${seed} edge count too low`);
      assert.ok(edges.length <= 23, `${seed} edge count too high`);
    }
  });

  it('keeps random puzzles from overusing the same here-there word family', () => {
    for (const seed of ['random-test-b', 'a', 'd']) {
      const puzzle = createRandomPuzzle({ seed, number: 99 });
      const familyCount = getRequiredWords(puzzle).filter((word) => commonHereFamily.has(word.text)).length;
      const uniqueLetterCount = new Set(puzzle.nodes.map((node) => node.letter)).size;

      assert.ok(familyCount <= 2, `${seed} has ${familyCount} here/there-family words`);
      assert.ok(uniqueLetterCount >= 9, `${seed} only has ${uniqueLetterCount} unique letters`);
    }
  });

  it('penalizes near-duplicate required word sets', () => {
    const badSet = ['BEING', 'LEFT', 'EARLY', 'NEAR', 'LEAD', 'LEADING', 'NEARLY', 'BEGIN', 'LIVE', 'LIVING'];
    const variedSet = ['BEING', 'LEFT', 'CROWN', 'MUSIC', 'PLANT', 'VIDEO', 'SUGAR', 'BRICK'];

    assert.ok(getWordSimilarityPenalty(badSet) >= 7);
    assert.ok(getWordSimilarityPenalty(variedSet) <= 1.5);
  });

  it('keeps generated required words below the near-duplicate threshold', () => {
    for (const seed of ['random-test-b', 'similarity-a', 'similarity-b', 'similarity-c']) {
      const puzzle = createRandomPuzzle({ seed, number: 99 });
      const similarityPenalty = getWordSimilarityPenalty(getRequiredWords(puzzle));

      assert.ok(similarityPenalty <= 4.5, `${seed} similarity penalty is ${similarityPenalty}`);
    }
  });

  it('counts every ranked word playable on the visible graph, including lower-frequency bonus words', () => {
    const puzzle = generatePuzzle({
      rankedWords: [
        'time',
        'team',
        'face',
        'care',
        'cape',
        'clear',
        'space',
        'street',
        'trade',
        'star',
        'rats',
        'arts',
        'rate',
        'date',
        'steam',
        'cadet',
      ],
      requiredMaxRank: 10,
      bonusMaxRank: 20,
      targetWordCount: 10,
      attempts: 0,
      seedBoards: ['TIMCLEARCDETFAPS'],
    });
    const requiredWords = new Set(getRequiredWords(puzzle).map((word) => word.text));
    const bonusWords = new Set(getBonusWords(puzzle).map((word) => word.text));
    const allWords = new Set([...requiredWords, ...bonusWords]);

    for (const expectedWord of ['RATS', 'ARTS', 'RATE', 'DATE', 'STEAM', 'CADET']) {
      assert.ok(allWords.has(expectedWord), `${expectedWord} should count as required or bonus`);
    }

    assert.ok(bonusWords.has('CADET'));
  });

  it('keeps generated starter word counts playable', () => {
    const requiredLengths = new Set(getRequiredWords(starterPuzzle).map((word) => word.text.length));

    assert.ok(getRequiredWords(starterPuzzle).length <= 15);
    assert.ok(getBonusWords(starterPuzzle).length <= 40);
    assert.ok(requiredLengths.size >= 2);
  });

  it('generates a mix of word lengths instead of only four-letter words', () => {
    const lengths = new Set(getRequiredWords(starterPuzzle).map((word) => word.text.length));

    assert.ok(lengths.size >= 2);
    assert.ok(Math.max(...lengths) >= 5);
  });

  it('can complete the playable puzzle from its declared word paths', () => {
    const state = getRequiredWords(starterPuzzle).reduce(
      (currentState, word) => submitPath(currentState, word.path, starterPuzzle),
      createGameState(starterPuzzle),
    );

    assert.equal(state.complete, true);
    assert.equal(getActiveNodeIds(starterPuzzle, state.foundWordIds).size, 0);
  });
});

describe('curated word list', () => {
  it('filters excluded words out of the curated list', () => {
    const curated = new Set(getWordList(true));

    assert.ok(getWordList(false).length > curated.size);

    for (const junk of ['tina', 'ment', 'arent', 'tits']) {
      assert.ok(COMMON_WORDS.includes(junk), `${junk} should be in the raw list`);
      assert.ok(EXCLUDED_WORDS.includes(junk), `${junk} should be excluded`);
      assert.equal(curated.has(junk), false);
    }

    assert.ok(curated.has('time'));
    assert.ok(curated.has('names'));
  });

  it('keeps curated words out of generated puzzles', () => {
    const excluded = new Set(EXCLUDED_WORDS.map((word) => word.toUpperCase()));
    const puzzle = createRandomPuzzle({ seed: 'curated-test' });

    for (const word of [...getRequiredWords(puzzle), ...getBonusWords(puzzle)]) {
      assert.equal(excluded.has(word.text), false, `${word.text} should not appear in curated puzzles`);
    }
  });
});

describe('distinct required words', () => {
  const rankedWords = ['names', 'name'];
  const seedBoards = ['NAMEXQJSKVWZBPFG'];

  it('demotes closure near-duplicates to bonus words when enabled', () => {
    const puzzle = generatePuzzle({ rankedWords, targetWordCount: 1, attempts: 0, seedBoards, distinctRequired: true });

    assert.deepEqual(getRequiredWords(puzzle).map((word) => word.text), ['NAMES']);
    assert.ok(getBonusWords(puzzle).map((word) => word.text).includes('NAME'));
  });

  it('keeps near-duplicates required when disabled', () => {
    const puzzle = generatePuzzle({ rankedWords, targetWordCount: 1, attempts: 0, seedBoards });

    assert.deepEqual(getRequiredWords(puzzle).map((word) => word.text).sort(), ['NAME', 'NAMES']);
  });

  it('keeps generated required lists free of substrings and inflections', () => {
    for (const seed of ['eval-1', 'eval-2', 'similarity-a']) {
      const words = getRequiredWords(createRandomPuzzle({ seed })).map((word) => word.text);

      for (const first of words) {
        for (const second of words) {
          if (first === second) {
            continue;
          }

          assert.equal(
            first.length >= 4 && second.includes(first),
            false,
            `${seed}: ${first} is a substring of required ${second}`,
          );
        }
      }
    }
  });
});

describe('daily puzzles and helpers', () => {
  it('numbers daily puzzles from the epoch', () => {
    assert.equal(dailyNumber('2026-07-01'), 1);
    assert.equal(dailyNumber('2026-07-02'), 2);
    assert.equal(dailyNumber('2026-08-01'), 32);
    assert.equal(dailySeed('2026-07-02'), 'daily-2026-07-02');
  });

  it('formats local dates and durations', () => {
    assert.equal(localDateString(new Date(2026, 6, 2, 23, 59)), '2026-07-02');
    assert.equal(previousDateString('2026-07-01'), '2026-06-30');
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(61_000), '1:01');
    assert.equal(formatDuration(600_500), '10:00');
  });

  it('grants one hint plus one per two bonus words', () => {
    assert.equal(hintsAvailable({ bonusWordCount: 0, hintsUsed: 0 }), 1);
    assert.equal(hintsAvailable({ bonusWordCount: 0, hintsUsed: 1 }), 0);
    assert.equal(hintsAvailable({ bonusWordCount: 1, hintsUsed: 1 }), 0);
    assert.equal(hintsAvailable({ bonusWordCount: 4, hintsUsed: 1 }), 2);
  });
});

const makeFakeStorage = () => {
  const map = new Map();

  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

describe('settings', () => {
  it('defaults every setting to its declared default', () => {
    const settings = defaultSettings();

    for (const definition of SETTING_DEFINITIONS) {
      assert.equal(settings[definition.key], definition.default);
    }
  });

  it('round-trips saved settings and ignores junk values', () => {
    const storage = makeFakeStorage();
    saveSettings(storage, { ...defaultSettings(), timer: false, bogus: true });
    const loaded = loadSettings(storage);

    assert.equal(loaded.timer, false);
    assert.equal(loaded.cleanWords, true);
    assert.equal('bogus' in loaded, false);

    storage.setItem('zanagrams-settings', 'not json');
    assert.deepEqual(loadSettings(storage), defaultSettings());
  });
});

describe('progress and stats storage', () => {
  it('round-trips progress and rejects malformed payloads', () => {
    const storage = makeFakeStorage();
    const progress = {
      version: 1,
      mode: 'daily',
      spec: { id: 'daily-2026-07-02', title: 'Zanagrams #2', seed: 'daily-2026-07-02', cleanWords: true, distinctWords: true },
      foundWordIds: ['time'],
      bonusWordIds: [],
      hintsUsed: 1,
      elapsedMs: 45_000,
      savedAt: 0,
    };

    saveProgress(storage, progress);
    assert.deepEqual(loadProgress(storage), progress);

    storage.setItem('zanagrams-progress', JSON.stringify({ mode: 'daily' }));
    assert.equal(loadProgress(storage), null);
  });

  it('records best times and daily streaks', () => {
    const stats = { tutorialDone: true, bestTimes: {}, dailyStreak: 0, lastDailyDate: null };
    const first = recordCompletion(stats, { mode: 'daily', elapsedMs: 90_000, dateString: '2026-07-01' });

    assert.equal(first.isNewBest, true);
    assert.equal(first.stats.bestTimes.daily, 90_000);
    assert.equal(first.stats.dailyStreak, 1);

    const second = recordCompletion(first.stats, { mode: 'daily', elapsedMs: 120_000, dateString: '2026-07-02' });

    assert.equal(second.isNewBest, false);
    assert.equal(second.stats.bestTimes.daily, 90_000);
    assert.equal(second.stats.dailyStreak, 2);

    const afterGap = recordCompletion(second.stats, { mode: 'daily', elapsedMs: 60_000, dateString: '2026-07-05' });

    assert.equal(afterGap.stats.dailyStreak, 1);
    assert.equal(afterGap.stats.bestTimes.daily, 60_000);
  });
});
