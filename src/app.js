import {
  areAdjacent,
  createGameState,
  createSeededPuzzle,
  getActiveEdges,
  getActiveNodeIds,
  getBonusWords,
  getRemainingWords,
  getRequiredWords,
  getSelectionWord,
  getWordMap,
  submitPath,
  tutorialPuzzle,
} from './game.js';
import { dailyNumber, dailySeed, formatDuration, hintsAvailable, localDateString } from './features.js';
import { SETTING_DEFINITIONS, loadSettings, saveSettings } from './settings.js';
import {
  clearProgress,
  loadProgress,
  loadStats,
  recordCompletion,
  saveProgress,
  saveStats,
} from './storage.js';

const boardHitRadius = 8.5;
const flashDurationMs = 430;
const hintDurationMs = 3200;

const storage = window.localStorage;

const elements = {
  app: document.querySelector('#app'),
  board: document.querySelector('#board'),
  lines: document.querySelector('#board-lines'),
  nodes: document.querySelector('#board-nodes'),
  currentWord: document.querySelector('#current-word'),
  heading: document.querySelector('#heading'),
  prompt: document.querySelector('#prompt'),
  wordList: document.querySelector('#word-list'),
  message: document.querySelector('#message'),
  timer: document.querySelector('#timer'),
  skipTutorial: document.querySelector('#skip-tutorial'),
  hint: document.querySelector('#hint'),
  dailyPuzzle: document.querySelector('#daily-puzzle'),
  randomPuzzle: document.querySelector('#random-puzzle'),
  restart: document.querySelector('#restart'),
  nextPuzzle: document.querySelector('#next-puzzle'),
  help: document.querySelector('#help-dialog'),
  settingsDialog: document.querySelector('#settings-dialog'),
  settingsList: document.querySelector('#settings-list'),
  definitionsDialog: document.querySelector('#definitions-dialog'),
  definitionWord: document.querySelector('#definition-word'),
  definitionBody: document.querySelector('#definition-body'),
};

let settings = loadSettings(storage);
let stats = loadStats(storage);

let mode = 'tutorial';
let spec = null;
let puzzle = tutorialPuzzle;
let state = createGameState(tutorialPuzzle);
let selection = [];
let activePointer = null;
let suppressedNodeClick = null;

let generating = false;
let generatingText = 'Generating puzzle...';
let inputLocked = false;
let flash = null;
let hintPath = null;
let hintTimeout = null;
let hintsUsed = 0;
let completionInfo = null;

let timerBase = 0;
let timerStartedAt = null;
let timerInterval = null;

const edgeKey = (from, to) => [from, to].sort().join('|');

const pathEdgeKeys = (path) => new Set(path.slice(0, -1).map((nodeId, index) => edgeKey(nodeId, path[index + 1])));

const getNodeById = (nodeId) => puzzle.nodes.find((node) => node.id === nodeId);

const formatPrompt = ({ promptStart, word, promptEnd }) =>
  `${promptStart} <strong>${word}</strong> ${promptEnd}`;

const getTutorialStep = () =>
  puzzle.tutorialSteps?.find((step) => !state.foundWordIds.includes(step.wordId)) ?? null;

// --- Puzzle generation (worker with synchronous fallback) ---

let worker = null;
let requestCounter = 0;
const pendingRequests = new Map();

const generateSynchronously = (puzzleSpec) =>
  new Promise((resolve, reject) => {
    window.setTimeout(() => {
      try {
        resolve(createSeededPuzzle(puzzleSpec));
      } catch (error) {
        reject(error);
      }
    }, 30);
  });

const initWorker = () => {
  try {
    worker = new Worker(new URL('./puzzle-worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return;
  }

  worker.addEventListener('message', (event) => {
    const { requestId, puzzle: result, error } = event.data;
    const pending = pendingRequests.get(requestId);

    if (!pending) {
      return;
    }

    pendingRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  });

  worker.addEventListener('error', () => {
    const failed = [...pendingRequests.values()];
    pendingRequests.clear();
    worker.terminate();
    worker = null;

    for (const pending of failed) {
      generateSynchronously(pending.spec).then(pending.resolve, pending.reject);
    }
  });
};

const generatePuzzleAsync = (puzzleSpec) => {
  if (!worker) {
    return generateSynchronously(puzzleSpec);
  }

  return new Promise((resolve, reject) => {
    const requestId = ++requestCounter;
    pendingRequests.set(requestId, { resolve, reject, spec: puzzleSpec });
    worker.postMessage({ requestId, spec: puzzleSpec });
  });
};

const optionsKey = () => `${settings.cleanWords}|${settings.distinctWords}`;

const specFor = (kind) => {
  const options = { cleanWords: settings.cleanWords, distinctWords: settings.distinctWords };

  if (kind === 'starter') {
    return { id: 'starter', title: 'Starter puzzle', seed: 'board', ...options };
  }

  if (kind === 'daily') {
    const date = localDateString();
    return { id: `daily-${date}`, title: `Zanagrams #${dailyNumber(date)}`, seed: dailySeed(date), ...options };
  }

  const seed = `random-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id: seed, title: 'Random puzzle', seed, ...options };
};

const prefetches = new Map();

const prefetchKey = (kind, puzzleSpec) => (kind === 'random' ? optionsKey() : `${optionsKey()}|${puzzleSpec.seed}`);

const ensurePrefetch = (kind) => {
  const puzzleSpec = specFor(kind);
  const key = prefetchKey(kind, puzzleSpec);
  const existing = prefetches.get(kind);

  if (existing?.key === key) {
    return existing;
  }

  const record = { key, spec: puzzleSpec, promise: generatePuzzleAsync(puzzleSpec) };
  record.promise.catch(() => {
    if (prefetches.get(kind) === record) {
      prefetches.delete(kind);
    }
  });
  prefetches.set(kind, record);
  return record;
};

const takePuzzle = (kind) => {
  const record = ensurePrefetch(kind);
  prefetches.delete(kind);
  return record.promise.then((result) => ({ spec: record.spec, puzzle: result }));
};

const schedulePrefetches = () => {
  if (mode === 'tutorial') {
    ensurePrefetch('starter');
  }

  ensurePrefetch('random');

  if (settings.dailyPuzzle && mode !== 'daily' && stats.lastDailyDate !== localDateString()) {
    ensurePrefetch('daily');
  }
};

// --- Timer ---

const timerElapsed = () => timerBase + (timerStartedAt ? Date.now() - timerStartedAt : 0);

const renderTimer = () => {
  elements.timer.hidden = !(settings.timer && mode !== 'tutorial' && !generating);
  elements.timer.textContent = formatDuration(timerElapsed());
};

const startTimer = () => {
  if (timerStartedAt) {
    return;
  }

  timerStartedAt = Date.now();
  timerInterval = window.setInterval(renderTimer, 1000);
};

const stopTimer = () => {
  timerBase = timerElapsed();
  timerStartedAt = null;
  window.clearInterval(timerInterval);
  timerInterval = null;
};

// --- Persistence ---

const persistProgress = () => {
  if (!settings.saveProgress || mode === 'tutorial' || !spec) {
    return;
  }

  if (state.complete) {
    clearProgress(storage);
    return;
  }

  saveProgress(storage, {
    version: 1,
    mode,
    spec,
    foundWordIds: state.foundWordIds,
    bonusWordIds: state.bonusWordIds,
    hintsUsed,
    elapsedMs: timerElapsed(),
    savedAt: Date.now(),
  });
};

// --- Rendering ---

const selectedEdgeKeys = () => pathEdgeKeys(selection);

const renderHeading = () => {
  if (generating) {
    elements.heading.textContent = generatingText;
    elements.prompt.innerHTML = '';
    return;
  }

  if (state.complete) {
    elements.heading.textContent = 'Puzzle complete';
    elements.prompt.innerHTML = mode === 'tutorial' ? 'You are ready for the full puzzle.' : 'All hidden words found.';
    return;
  }

  const tutorialStep = mode === 'tutorial' ? getTutorialStep() : null;

  if (tutorialStep) {
    const word = puzzle.words.find((candidate) => candidate.id === tutorialStep.wordId);
    elements.heading.textContent = tutorialStep.heading;
    elements.prompt.innerHTML = formatPrompt({
      promptStart: tutorialStep.promptStart,
      word: word.text,
      promptEnd: tutorialStep.promptEnd,
    });
    return;
  }

  const remaining = getRemainingWords(puzzle, state.foundWordIds).length;
  const bonusCount = state.bonusWordIds.length;
  elements.heading.textContent = puzzle.title;
  elements.prompt.innerHTML =
    remaining === getRequiredWords(puzzle).length
      ? `Find <strong>${getRequiredWords(puzzle).length}</strong> hidden words${bonusCount ? ` and ${bonusCount} bonus` : ''}`
      : `Find <strong>${remaining}</strong> more hidden words${bonusCount ? ` · ${bonusCount} bonus found` : ''}`;
};

const renderLines = () => {
  const selectedEdges = selectedEdgeKeys();
  const flashEdges = flash ? pathEdgeKeys(flash.path) : null;
  const hintEdges = hintPath ? pathEdgeKeys(hintPath) : null;

  elements.lines.replaceChildren(
    ...getActiveEdges(puzzle, state.foundWordIds).map(([from, to]) => {
      const fromNode = getNodeById(from);
      const toNode = getNodeById(to);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const key = edgeKey(from, to);
      line.setAttribute('x1', fromNode.x);
      line.setAttribute('y1', fromNode.y);
      line.setAttribute('x2', toNode.x);
      line.setAttribute('y2', toNode.y);
      line.classList.add('board-path');

      if (selectedEdges.has(key)) {
        line.classList.add('is-selected');
      }

      if (flashEdges?.has(key)) {
        line.classList.add('is-flash', `is-flash-${flash.kind}`);
      }

      if (hintEdges?.has(key)) {
        line.classList.add('is-hint');
      }

      return line;
    }),
  );
};

const renderNodes = () => {
  const activeNodes = getActiveNodeIds(puzzle, state.foundWordIds);
  const flashNodes = flash ? new Set(flash.path) : null;
  const hintNodes = hintPath ? new Set(hintPath) : null;

  elements.nodes.replaceChildren(
    ...puzzle.nodes.flatMap((node) => {
      if (!activeNodes.has(node.id)) {
        return [];
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'letter-node';
      button.dataset.nodeId = node.id;
      button.textContent = node.letter;
      button.style.left = `${node.x}%`;
      button.style.top = `${node.y}%`;
      button.setAttribute('aria-label', `Letter ${node.letter}`);

      if (selection.includes(node.id)) {
        button.classList.add('is-selected');
      }

      if (flashNodes?.has(node.id)) {
        button.classList.add('is-flash', `is-flash-${flash.kind}`);
      }

      if (hintNodes?.has(node.id)) {
        button.classList.add('is-hint');
      }

      return [button];
    }),
  );
};

const renderCurrentWord = () => {
  const selectedWord = getSelectionWord(puzzle, selection);
  elements.currentWord.textContent = selectedWord || 'Select letters';
  elements.currentWord.disabled = selection.length < 2;
};

const makeWordChip = (word, { found, bonus }) => {
  const item = document.createElement('li');
  item.className = 'word-chip';

  if (!found) {
    item.textContent = '•'.repeat(word.text.length);
    item.setAttribute('aria-label', `Unfound ${word.text.length} letter word`);
    return item;
  }

  item.classList.add('is-found');

  if (bonus) {
    item.classList.add('is-bonus');
  }

  const label = bonus ? `+${word.text}` : word.text;

  if (settings.definitions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'word-chip-button';
    button.dataset.word = word.text;
    button.textContent = label;
    button.setAttribute('aria-label', `Definition of ${word.text}`);
    item.classList.add('is-clickable');
    item.append(button);
  } else {
    item.textContent = label;
  }

  return item;
};

const renderWordList = () => {
  const foundBonusWords = getBonusWords(puzzle).filter((word) => state.bonusWordIds.includes(word.id));

  elements.wordList.replaceChildren(
    ...getRequiredWords(puzzle).map((word) =>
      makeWordChip(word, { found: state.foundWordIds.includes(word.id), bonus: false }),
    ),
    ...foundBonusWords.map((word) => makeWordChip(word, { found: true, bonus: true })),
  );
};

const renderActions = () => {
  const today = localDateString();

  elements.skipTutorial.hidden = mode !== 'tutorial' || state.complete || generating;

  elements.hint.hidden = !(settings.hints && mode !== 'tutorial' && !state.complete && !generating);
  const available = hintsAvailable({ bonusWordCount: state.bonusWordIds.length, hintsUsed });
  elements.hint.textContent = `Hint (${available})`;
  elements.hint.disabled = available === 0 || inputLocked;
  elements.hint.title = available === 0 ? 'Find two bonus words to earn another hint.' : 'Briefly reveal one hidden word.';

  elements.dailyPuzzle.hidden = !settings.dailyPuzzle;
  elements.dailyPuzzle.textContent = `Daily #${dailyNumber(today)}${stats.lastDailyDate === today ? ' ✓' : ''}`;
  elements.dailyPuzzle.disabled = generating || (mode === 'daily' && spec?.seed === dailySeed(today) && !state.complete);

  elements.randomPuzzle.disabled = generating;
  elements.restart.disabled = generating;

  elements.nextPuzzle.hidden = !state.complete || generating;
  elements.nextPuzzle.textContent = mode === 'tutorial' ? 'Start puzzle' : 'Next puzzle';
};

const completionSummary = () => {
  const parts = [];

  if (settings.timer && completionInfo) {
    const bestNote =
      completionInfo.isNewBest && completionInfo.previousBest !== undefined
        ? ' — new best!'
        : completionInfo.previousBest !== undefined
          ? ` · Best ${formatDuration(Math.min(completionInfo.previousBest, completionInfo.elapsedMs))}`
          : '';
    parts.push(`Solved in ${formatDuration(completionInfo.elapsedMs)}${bestNote}`);
  }

  if (mode === 'daily' && completionInfo?.streak > 1) {
    parts.push(`${completionInfo.streak}-day streak`);
  }

  if (settings.feedback) {
    const bonusTotal = getBonusWords(puzzle).length;

    if (bonusTotal > 0) {
      parts.push(`${state.bonusWordIds.length} of ${bonusTotal} bonus words found`);
    }
  }

  return parts.join(' · ');
};

const renderMessage = () => {
  if (state.complete && mode !== 'tutorial') {
    const summary = completionSummary();
    elements.message.textContent = summary || state.message.text;
    elements.message.dataset.kind = 'success';
    return;
  }

  elements.message.textContent = state.message.text;
  elements.message.dataset.kind = state.message.kind;
};

const render = () => {
  elements.app.dataset.puzzle = puzzle.id;
  elements.app.classList.toggle('is-complete', state.complete && settings.feedback);
  renderHeading();
  renderLines();
  renderNodes();
  renderCurrentWord();
  renderWordList();
  renderActions();
  renderMessage();
  renderTimer();
};

// --- Selection ---

const canAppendNode = (nodeId) => {
  const lastNodeId = selection.at(-1);

  if (!lastNodeId || selection.includes(nodeId)) {
    return false;
  }

  return areAdjacent(puzzle, lastNodeId, nodeId, state.foundWordIds);
};

const selectNode = (nodeId) => {
  const previousNodeId = selection.at(-2);
  const lastNodeId = selection.at(-1);

  if (nodeId === lastNodeId) {
    return false;
  }

  if (nodeId === previousNodeId) {
    selection = selection.slice(0, -1);
    render();
    return true;
  }

  if (selection.length === 0 || !lastNodeId) {
    selection = [nodeId];
    render();
    return true;
  }

  if (canAppendNode(nodeId)) {
    selection = [...selection, nodeId];
    render();
    return true;
  }

  selection = [nodeId];
  render();
  return true;
};

const triggerShake = () => {
  elements.currentWord.classList.remove('is-shake');
  // Force a reflow so re-adding the class restarts the animation.
  void elements.currentWord.offsetWidth;
  elements.currentWord.classList.add('is-shake');
};

const handleCompletion = () => {
  if (mode === 'tutorial') {
    if (!stats.tutorialDone) {
      stats = { ...stats, tutorialDone: true };
      saveStats(storage, stats);
    }

    return;
  }

  stopTimer();
  const elapsedMs = timerElapsed();
  const result = recordCompletion(stats, { mode, elapsedMs, dateString: localDateString() });
  completionInfo = {
    elapsedMs,
    isNewBest: result.isNewBest,
    previousBest: result.previousBest,
    streak: result.stats.dailyStreak,
  };
  stats = result.stats;
  saveStats(storage, stats);
};

const afterStateChange = () => {
  if (state.complete && !completionInfo) {
    handleCompletion();
  }

  render();
  persistProgress();
  schedulePrefetches();
};

const submitSelection = () => {
  if (selection.length < 2 || inputLocked || generating) {
    return;
  }

  const next = submitPath(state, selection, puzzle);
  const foundRequired = next.foundWordIds.length > state.foundWordIds.length;
  const foundBonus = next.bonusWordIds.length > state.bonusWordIds.length;

  if (settings.feedback && (foundRequired || foundBonus)) {
    flash = { path: [...selection], kind: foundRequired ? 'found' : 'bonus' };
    inputLocked = true;
    render();

    window.setTimeout(() => {
      flash = null;
      inputLocked = false;
      state = next;
      selection = [];
      afterStateChange();
    }, flashDurationMs);
    return;
  }

  if (settings.feedback && next.message.kind === 'error') {
    triggerShake();
  }

  state = next;
  selection = [];
  afterStateChange();
};

// --- Pointer input ---

const getBoardPoint = ({ clientX, clientY }) => {
  const rect = elements.board.getBoundingClientRect();

  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
};

const getNodeAtPoint = (event) => {
  const activeNodes = getActiveNodeIds(puzzle, state.foundWordIds);
  const point = getBoardPoint(event);

  return puzzle.nodes.find((node) => {
    if (!activeNodes.has(node.id)) {
      return false;
    }

    return Math.hypot(node.x - point.x, node.y - point.y) <= boardHitRadius;
  });
};

const startPointerSelection = (event) => {
  if (inputLocked || generating) {
    return;
  }

  const node = getNodeAtPoint(event);

  if (!node) {
    return;
  }

  event.preventDefault();
  activePointer = { id: event.pointerId, dragged: false };
  elements.board.setPointerCapture(event.pointerId);
  selectNode(node.id);
};

const continuePointerSelection = (event) => {
  if (!activePointer || activePointer.id !== event.pointerId || inputLocked) {
    return;
  }

  const node = getNodeAtPoint(event);

  if (node && node.id !== selection.at(-1)) {
    const changed = selectNode(node.id);
    activePointer.dragged = activePointer.dragged || (changed && selection.length > 1);
  }
};

const endPointerSelection = (event) => {
  if (!activePointer || activePointer.id !== event.pointerId) {
    return;
  }

  const shouldSubmit = activePointer.dragged && selection.length > 1;
  const submittedNodeId = selection.at(-1);
  activePointer = null;

  if (elements.board.hasPointerCapture(event.pointerId)) {
    elements.board.releasePointerCapture(event.pointerId);
  }

  if (shouldSubmit) {
    suppressedNodeClick = { nodeId: submittedNodeId, expiresAt: performance.now() + 350 };
    submitSelection();
  }
};

const handleNodeClick = (event) => {
  if (inputLocked || generating) {
    return;
  }

  const button = event.target.closest('[data-node-id]');

  if (!button) {
    return;
  }

  if (
    suppressedNodeClick &&
    suppressedNodeClick.nodeId === button.dataset.nodeId &&
    performance.now() < suppressedNodeClick.expiresAt
  ) {
    suppressedNodeClick = null;
    return;
  }

  suppressedNodeClick = null;

  selectNode(button.dataset.nodeId);
};

// --- Hints ---

const useHint = () => {
  if (inputLocked || generating || state.complete) {
    return;
  }

  if (hintsAvailable({ bonusWordCount: state.bonusWordIds.length, hintsUsed }) <= 0) {
    return;
  }

  const remaining = getRemainingWords(puzzle, state.foundWordIds);

  if (remaining.length === 0) {
    return;
  }

  hintsUsed += 1;
  hintPath = remaining[Math.floor(Math.random() * remaining.length)].path;
  render();
  persistProgress();

  window.clearTimeout(hintTimeout);
  hintTimeout = window.setTimeout(() => {
    hintPath = null;
    render();
  }, hintDurationMs);
};

// --- Definitions ---

const definitionCache = new Map();

const renderDefinitionEntries = (entries) => {
  const meanings = entries.flatMap((entry) => entry.meanings ?? []).slice(0, 3);

  if (meanings.length === 0) {
    return [Object.assign(document.createElement('p'), { className: 'definition-status', textContent: 'No definition found.' })];
  }

  return meanings.map((meaning) => {
    const block = document.createElement('div');
    block.className = 'definition-meaning';
    const partOfSpeech = document.createElement('p');
    partOfSpeech.className = 'definition-part';
    partOfSpeech.textContent = meaning.partOfSpeech ?? '';
    const definition = document.createElement('p');
    definition.className = 'definition-text';
    definition.textContent = meaning.definitions?.[0]?.definition ?? '';
    block.append(partOfSpeech, definition);
    return block;
  });
};

const openDefinition = async (wordText) => {
  elements.definitionWord.textContent = wordText;
  elements.definitionBody.replaceChildren(
    Object.assign(document.createElement('p'), { className: 'definition-status', textContent: 'Looking up...' }),
  );
  elements.definitionsDialog.showModal();

  try {
    let entries = definitionCache.get(wordText);

    if (!entries) {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${wordText.toLowerCase()}`);

      if (!response.ok) {
        throw new Error(`Lookup failed (${response.status})`);
      }

      entries = await response.json();
      definitionCache.set(wordText, entries);
    }

    if (elements.definitionWord.textContent === wordText) {
      elements.definitionBody.replaceChildren(...renderDefinitionEntries(entries));
    }
  } catch {
    if (elements.definitionWord.textContent === wordText) {
      elements.definitionBody.replaceChildren(
        Object.assign(document.createElement('p'), { className: 'definition-status', textContent: 'No definition found.' }),
      );
    }
  }
};

// --- Puzzle lifecycle ---

const applyPuzzle = ({ nextMode, nextSpec, nextPuzzle, restored = null }) => {
  stopTimer();
  mode = nextMode;
  spec = nextSpec;
  puzzle = nextPuzzle;
  state = createGameState(puzzle);

  if (restored) {
    const wordMap = getWordMap(puzzle);
    const foundWordIds = restored.foundWordIds.filter((id) => wordMap.has(id));
    const bonusWordIds = restored.bonusWordIds.filter((id) => wordMap.has(id));
    state = {
      ...state,
      foundWordIds,
      bonusWordIds,
      complete: foundWordIds.length === getRequiredWords(puzzle).length,
    };
    hintsUsed = restored.hintsUsed ?? 0;
    timerBase = restored.elapsedMs ?? 0;
  } else {
    hintsUsed = 0;
    timerBase = 0;
  }

  selection = [];
  activePointer = null;
  suppressedNodeClick = null;
  hintPath = null;
  window.clearTimeout(hintTimeout);
  flash = null;
  inputLocked = false;
  completionInfo = null;
  generating = false;

  if (mode !== 'tutorial' && !state.complete) {
    startTimer();
  }

  render();
  persistProgress();
  schedulePrefetches();
};

const loadTutorial = () => {
  applyPuzzle({ nextMode: 'tutorial', nextSpec: null, nextPuzzle: tutorialPuzzle });
};

const startPuzzle = async (kind) => {
  if (generating) {
    return;
  }

  generating = true;
  generatingText = 'Generating puzzle...';
  stopTimer();
  render();

  try {
    const next = await takePuzzle(kind);
    applyPuzzle({ nextMode: kind, nextSpec: next.spec, nextPuzzle: next.puzzle });
  } catch {
    generating = false;
    state = { ...state, message: { kind: 'error', text: 'Could not generate a puzzle. Please try again.' } };

    if (mode !== 'tutorial' && !state.complete) {
      startTimer();
    }

    render();
  }
};

const nextPuzzleKind = () => {
  if (mode === 'tutorial') {
    return 'starter';
  }

  if (settings.dailyPuzzle && mode !== 'daily' && stats.lastDailyDate !== localDateString()) {
    return 'daily';
  }

  return 'random';
};

const restartPuzzle = () => {
  if (generating) {
    return;
  }

  if (mode === 'tutorial') {
    loadTutorial();
    return;
  }

  applyPuzzle({ nextMode: mode, nextSpec: spec, nextPuzzle: puzzle });
};

// --- Settings ---

const buildSettingsList = () => {
  elements.settingsList.replaceChildren(
    ...SETTING_DEFINITIONS.map((definition) => {
      const item = document.createElement('li');
      item.className = 'settings-row';

      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.setting = definition.key;
      input.checked = settings[definition.key];

      const text = document.createElement('span');
      text.className = 'settings-text';
      const title = document.createElement('span');
      title.className = 'settings-label';
      title.textContent = definition.label;
      const description = document.createElement('span');
      description.className = 'settings-description';
      description.textContent = definition.description;
      text.append(title, description);

      label.append(input, text);
      item.append(label);
      return item;
    }),
  );
};

const handleSettingChange = (event) => {
  const input = event.target.closest('[data-setting]');

  if (!input) {
    return;
  }

  const key = input.dataset.setting;
  settings = { ...settings, [key]: input.checked };
  saveSettings(storage, settings);

  if (key === 'saveProgress') {
    if (settings.saveProgress) {
      persistProgress();
    } else {
      clearProgress(storage);
    }
  }

  if (key === 'cleanWords' || key === 'distinctWords') {
    prefetches.clear();
  }

  if (key === 'timer' && settings.timer && mode !== 'tutorial' && !state.complete && !generating) {
    startTimer();
  }

  render();
};

// --- Events ---

elements.board.addEventListener('pointerdown', startPointerSelection);
elements.board.addEventListener('pointermove', continuePointerSelection);
elements.board.addEventListener('pointerup', endPointerSelection);
elements.board.addEventListener('pointercancel', endPointerSelection);
elements.nodes.addEventListener('click', handleNodeClick);
elements.currentWord.addEventListener('click', submitSelection);

elements.skipTutorial.addEventListener('click', () => {
  if (!stats.tutorialDone) {
    stats = { ...stats, tutorialDone: true };
    saveStats(storage, stats);
  }

  startPuzzle('starter');
});
elements.hint.addEventListener('click', useHint);
elements.dailyPuzzle.addEventListener('click', () => startPuzzle('daily'));
elements.randomPuzzle.addEventListener('click', () => startPuzzle('random'));
elements.restart.addEventListener('click', restartPuzzle);
elements.nextPuzzle.addEventListener('click', () => startPuzzle(nextPuzzleKind()));

document.querySelector('#open-help').addEventListener('click', () => elements.help.showModal());
document.querySelector('#close-help').addEventListener('click', () => elements.help.close());
document.querySelector('#open-settings').addEventListener('click', () => elements.settingsDialog.showModal());
document.querySelector('#close-settings').addEventListener('click', () => elements.settingsDialog.close());
document.querySelector('#close-definitions').addEventListener('click', () => elements.definitionsDialog.close());

elements.settingsList.addEventListener('change', handleSettingChange);

elements.wordList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-word]');

  if (button && settings.definitions) {
    openDefinition(button.dataset.word);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    selection = [];
    render();
  }

  if (event.key === 'Backspace' && selection.length > 0 && !inputLocked) {
    event.preventDefault();
    selection = selection.slice(0, -1);
    render();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTimer();
    persistProgress();
    return;
  }

  if (mode !== 'tutorial' && !state.complete && !generating) {
    startTimer();
  }
});

window.addEventListener('pagehide', persistProgress);

// --- Boot ---

const boot = async () => {
  buildSettingsList();
  initWorker();

  const progress = settings.saveProgress ? loadProgress(storage) : null;

  if (progress && progress.mode !== 'tutorial') {
    generating = true;
    generatingText = 'Restoring puzzle...';
    render();

    try {
      const restoredPuzzle = await generatePuzzleAsync(progress.spec);
      applyPuzzle({ nextMode: progress.mode, nextSpec: progress.spec, nextPuzzle: restoredPuzzle, restored: progress });
      return;
    } catch {
      generating = false;
    }
  }

  if (stats.tutorialDone) {
    startPuzzle('starter');
    return;
  }

  loadTutorial();
};

render();
boot();
