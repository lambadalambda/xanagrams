import {
  areAdjacent,
  createGameState,
  createRandomPuzzle,
  getActiveEdges,
  getActiveNodeIds,
  getBonusWords,
  getRemainingWords,
  getRequiredWords,
  getSelectionWord,
  puzzles,
  submitPath,
} from './game.js';

const boardHitRadius = 8.5;

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
  skipTutorial: document.querySelector('#skip-tutorial'),
  randomPuzzle: document.querySelector('#random-puzzle'),
  restart: document.querySelector('#restart'),
  nextPuzzle: document.querySelector('#next-puzzle'),
  help: document.querySelector('#help-dialog'),
};

let puzzleIndex = 0;
let puzzle = puzzles[puzzleIndex];
let state = createGameState(puzzle);
let selection = [];
let activePointer = null;
let suppressedNodeClick = null;
let randomPuzzleCount = 1;

const getNodeById = (nodeId) => puzzle.nodes.find((node) => node.id === nodeId);

const selectedEdgeKeys = () =>
  new Set(selection.slice(0, -1).map((nodeId, index) => [nodeId, selection[index + 1]].sort().join('|')));

const formatPrompt = ({ promptStart, word, promptEnd }) =>
  `${promptStart} <strong>${word}</strong> ${promptEnd}`;

const getTutorialStep = () =>
  puzzle.tutorialSteps?.find((step) => !state.foundWordIds.includes(step.wordId)) ?? null;

const renderHeading = () => {
  if (state.complete) {
    elements.heading.textContent = 'Puzzle complete';
    elements.prompt.innerHTML = puzzle.id === 'tutorial' ? 'You are ready for the full puzzle.' : 'All hidden words found.';
    return;
  }

  const tutorialStep = getTutorialStep();

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
  elements.lines.replaceChildren(
    ...getActiveEdges(puzzle, state.foundWordIds).map(([from, to]) => {
      const fromNode = getNodeById(from);
      const toNode = getNodeById(to);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', fromNode.x);
      line.setAttribute('y1', fromNode.y);
      line.setAttribute('x2', toNode.x);
      line.setAttribute('y2', toNode.y);
      line.classList.add('board-path');

      if (selectedEdges.has([from, to].sort().join('|'))) {
        line.classList.add('is-selected');
      }

      return line;
    }),
  );
};

const renderNodes = () => {
  const activeNodes = getActiveNodeIds(puzzle, state.foundWordIds);

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

      return [button];
    }),
  );
};

const renderCurrentWord = () => {
  const selectedWord = getSelectionWord(puzzle, selection);
  elements.currentWord.textContent = selectedWord || 'Select letters';
  elements.currentWord.disabled = selection.length < 2;
};

const renderWordList = () => {
  const foundBonusWords = getBonusWords(puzzle).filter((word) => state.bonusWordIds.includes(word.id));

  elements.wordList.replaceChildren(
    ...getRequiredWords(puzzle).map((word) => {
      const item = document.createElement('li');
      item.className = 'word-chip';

      if (state.foundWordIds.includes(word.id)) {
        item.classList.add('is-found');
        item.textContent = word.text;
      } else {
        item.textContent = '•'.repeat(word.text.length);
        item.setAttribute('aria-label', `Unfound ${word.text.length} letter word`);
      }

      return item;
    }),
    ...foundBonusWords.map((word) => {
      const item = document.createElement('li');
      item.className = 'word-chip is-found is-bonus';
      item.textContent = `+${word.text}`;
      item.setAttribute('aria-label', `Bonus word ${word.text}`);
      return item;
    }),
  );
};

const renderActions = () => {
  elements.skipTutorial.hidden = puzzle.id !== 'tutorial' || state.complete;
  elements.nextPuzzle.hidden = !state.complete;
  elements.nextPuzzle.textContent = puzzleIndex < puzzles.length - 1 ? 'Next puzzle' : 'Play again';
};

const renderMessage = () => {
  elements.message.textContent = state.message.text;
  elements.message.dataset.kind = state.message.kind;
};

const render = () => {
  elements.app.dataset.puzzle = puzzle.id;
  renderHeading();
  renderLines();
  renderNodes();
  renderCurrentWord();
  renderWordList();
  renderActions();
  renderMessage();
};

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

const submitSelection = () => {
  if (selection.length < 2) {
    return;
  }

  state = submitPath(state, selection, puzzle);
  selection = [];
  render();
};

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
  if (!activePointer || activePointer.id !== event.pointerId) {
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

const loadPuzzle = (nextPuzzleIndex) => {
  puzzleIndex = nextPuzzleIndex;
  puzzle = puzzles[puzzleIndex];
  state = createGameState(puzzle);
  selection = [];
  activePointer = null;
  suppressedNodeClick = null;
  render();
};

const loadGeneratedPuzzle = () => {
  const previousText = elements.randomPuzzle.textContent;
  elements.randomPuzzle.disabled = true;
  elements.randomPuzzle.textContent = 'Generating...';

  window.setTimeout(() => {
    randomPuzzleCount += 1;
    puzzle = createRandomPuzzle({
      seed: `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      number: randomPuzzleCount,
    });
    puzzleIndex = -1;
    state = createGameState(puzzle);
    selection = [];
    activePointer = null;
    suppressedNodeClick = null;
    elements.randomPuzzle.disabled = false;
    elements.randomPuzzle.textContent = previousText;
    render();
  }, 0);
};

elements.board.addEventListener('pointerdown', startPointerSelection);
elements.board.addEventListener('pointermove', continuePointerSelection);
elements.board.addEventListener('pointerup', endPointerSelection);
elements.board.addEventListener('pointercancel', endPointerSelection);
elements.nodes.addEventListener('click', handleNodeClick);
elements.currentWord.addEventListener('click', submitSelection);

elements.skipTutorial.addEventListener('click', () => loadPuzzle(1));
elements.randomPuzzle.addEventListener('click', loadGeneratedPuzzle);
elements.restart.addEventListener('click', () => {
  if (puzzleIndex >= 0) {
    loadPuzzle(puzzleIndex);
    return;
  }

  state = createGameState(puzzle);
  selection = [];
  activePointer = null;
  suppressedNodeClick = null;
  render();
});
elements.nextPuzzle.addEventListener('click', () => loadPuzzle((puzzleIndex + 1) % puzzles.length));

document.querySelector('#open-help').addEventListener('click', () => elements.help.showModal());
document.querySelector('#close-help').addEventListener('click', () => elements.help.close());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    selection = [];
    render();
  }

  if (event.key === 'Backspace' && selection.length > 0) {
    event.preventDefault();
    selection = selection.slice(0, -1);
    render();
  }
});

render();
