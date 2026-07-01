const gridSize = 4;
const gridCoordinates = [12, 37, 62, 87];
const commonLetterFill = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';
const commonHereFamily = new Set(['HERE', 'HERES', 'THEIR', 'THERE', 'THERES', 'THESE', 'THREE', 'WHERE', 'WHETHER']);

const normalizeWord = (word) => word.toUpperCase().replace(/[^A-Z]/g, '');

const edgeKey = (from, to) => [from, to].sort().join('|');

const hashSeed = (seed) => {
  const text = String(seed);
  let hash = 1779033703 ^ text.length;

  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
};

const createRandom = (seed) => {
  const seedHash = hashSeed(seed)();
  let state = seedHash || 1;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = (items, random) => {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]];
  }

  return nextItems;
};

const cellId = (index) => `n${Math.floor(index / gridSize)}${index % gridSize}`;

const cellNeighbors = (index) => {
  const row = Math.floor(index / gridSize);
  const column = index % gridSize;
  const neighbors = [];

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) {
        continue;
      }

      const nextRow = row + rowOffset;
      const nextColumn = column + columnOffset;

      if (nextRow >= 0 && nextRow < gridSize && nextColumn >= 0 && nextColumn < gridSize) {
        neighbors.push(nextRow * gridSize + nextColumn);
      }
    }
  }

  return neighbors;
};

const neighborMap = Array.from({ length: gridSize * gridSize }, (_, index) => cellNeighbors(index));

export const filterRankedWords = (rankedWords, { minLength = 4, maxRank = 25000 } = {}) => {
  const seen = new Set();

  return rankedWords.slice(0, maxRank).flatMap((word, rank) => {
    const normalized = normalizeWord(word);

    if (normalized.length < minLength || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [{ text: normalized, rank }];
  });
};

const findPathsForWord = (letters, word, maxPaths = 12) => {
  const paths = [];
  const target = normalizeWord(word);

  const walk = (index, path) => {
    if (paths.length >= maxPaths) {
      return;
    }

    if (path.length === target.length) {
      paths.push(path.map(cellId));
      return;
    }

    for (const neighbor of neighborMap[index]) {
      if (path.includes(neighbor) || letters[neighbor] !== target[path.length]) {
        continue;
      }

      walk(neighbor, [...path, neighbor]);
    }
  };

  letters.forEach((letter, index) => {
    if (letter === target[0]) {
      walk(index, [index]);
    }
  });

  return paths;
};

const pathEdges = (path) => path.slice(0, -1).map((from, index) => edgeKey(from, path[index + 1]));

const makeAdjacency = (edges) => {
  const adjacency = new Map();

  for (const [from, to] of edges) {
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    adjacency.set(to, [...(adjacency.get(to) ?? []), from]);
  }

  return adjacency;
};

const findPathsForWordOnGraph = (nodes, edges, word, maxPaths = 4) => {
  const paths = [];
  const target = normalizeWord(word);
  const adjacency = makeAdjacency(edges);

  const walk = (nodeId, path) => {
    if (paths.length >= maxPaths) {
      return;
    }

    if (path.length === target.length) {
      paths.push(path);
      return;
    }

    for (const neighborId of adjacency.get(nodeId) ?? []) {
      const neighbor = nodes.find((node) => node.id === neighborId);

      if (!neighbor || path.includes(neighborId) || neighbor.letter !== target[path.length]) {
        continue;
      }

      walk(neighborId, [...path, neighborId]);
    }
  };

  for (const node of nodes) {
    if (node.letter === target[0]) {
      walk(node.id, [node.id]);
    }
  }

  return paths;
};

const closeWordsOverGraph = (nodes, selectedWords, rankedWords) => {
  const edges = [...new Map(selectedWords.flatMap((word) => pathEdges(word.path)).map((key) => [key, key])).keys()].map((key) =>
    key.split('|'),
  );
  const selectedByText = new Map(selectedWords.map((word) => [word.text, word]));

  return rankedWords.flatMap((word) => {
    const selectedWord = selectedByText.get(word.text);

    if (selectedWord) {
      return [{ id: word.text.toLowerCase(), text: word.text, path: selectedWord.path, rank: word.rank }];
    }

    const [path] = findPathsForWordOnGraph(nodes, edges, word.text);

    if (!path) {
      return [];
    }

    return [{ id: word.text.toLowerCase(), text: word.text, path, rank: word.rank }];
  });
};

const bestPathForCandidate = (candidate, usedNodes, usedEdges) =>
  candidate.paths
    .map((path) => {
      const nodes = new Set(path);
      const edges = pathEdges(path);
      const newNodeCount = [...nodes].filter((nodeId) => !usedNodes.has(nodeId)).length;
      const sharedNodeCount = path.length - newNodeCount;
      const newEdgeCount = edges.filter((key) => !usedEdges.has(key)).length;

      return {
        path,
        score:
          newNodeCount * 120 +
          newEdgeCount * 34 +
          sharedNodeCount * 12 +
          candidate.text.length * 4 +
          Math.max(0, candidate.text.length - 4) * 160 -
          candidate.rank * 0.04,
      };
    })
    .sort((first, second) => second.score - first.score)[0];

const selectWords = (candidates, { targetWordCount }) => {
  const selected = [];
  const usedNodes = new Set();
  const usedEdges = new Set();
  const remaining = [...candidates];

  while (remaining.length > 0 && selected.length < targetWordCount) {
    const scored = remaining
      .map((candidate) => ({ candidate, ...bestPathForCandidate(candidate, usedNodes, usedEdges) }))
      .sort((first, second) => second.score - first.score || first.candidate.rank - second.candidate.rank);
    const [next] = scored;

    if (!next) {
      break;
    }

    selected.push({
      id: next.candidate.text.toLowerCase(),
      text: next.candidate.text,
      path: next.path,
      rank: next.candidate.rank,
    });
    next.path.forEach((nodeId) => usedNodes.add(nodeId));
    pathEdges(next.path).forEach((key) => usedEdges.add(key));

    const selectedText = next.candidate.text;
    const index = remaining.findIndex((candidate) => candidate.text === selectedText);

    if (index >= 0) {
      remaining.splice(index, 1);
    }
  }

  return selected;
};

const largestComponentSize = (words) => {
  const graph = new Map();

  for (const word of words) {
    for (let index = 0; index < word.path.length - 1; index += 1) {
      const from = word.path[index];
      const to = word.path[index + 1];
      graph.set(from, [...(graph.get(from) ?? []), to]);
      graph.set(to, [...(graph.get(to) ?? []), from]);
    }
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

const scorePuzzle = (words, boardLetters, { minRequiredWords, maxRequiredWords, targetEdges, maxEdges }) => {
  const nodes = new Set(words.flatMap((word) => word.path));
  const edges = new Set(words.flatMap((word) => pathEdges(word.path)));
  const lengths = new Set(words.map((word) => word.text.length));
  const longWordCount = words.filter((word) => word.text.length >= 5).length;
  const uniqueLetterCount = new Set(boardLetters).size;
  const hereFamilyCount = words.filter((word) => commonHereFamily.has(word.text)).length;
  const thClusterCount = words.filter((word) => /TH|HER|ERE/.test(word.text)).length;
  const wordCount = words.length;
  const idealWordCount = (minRequiredWords + maxRequiredWords) / 2;
  const wordRangePenalty =
    wordCount < minRequiredWords
      ? (minRequiredWords - wordCount) * 1400
      : wordCount > maxRequiredWords
        ? (wordCount - maxRequiredWords) * 1800
        : Math.abs(wordCount - idealWordCount) * 90;
  const edgePenalty =
    edges.size > maxEdges ? (edges.size - maxEdges) * 650 : Math.abs(edges.size - targetEdges) * 80;
  const nodeCoveragePenalty = nodes.size < gridSize * gridSize ? (gridSize * gridSize - nodes.size) * 3000 : 0;
  const uniqueLetterPenalty = uniqueLetterCount < 9 ? (9 - uniqueLetterCount) * 1400 : 0;
  const commonLetterPenalty = [...'ETHRS'].reduce(
    (penalty, letter) => penalty + Math.max(0, boardLetters.filter((candidate) => candidate === letter).length - 2) * 220,
    0,
  );
  const hereFamilyPenalty = Math.max(0, hereFamilyCount - 2) * 1800;
  const thClusterPenalty = Math.max(0, thClusterCount - 4) * 300;

  return (
    nodes.size * 900 +
    largestComponentSize(words) * 75 +
    uniqueLetterCount * 180 +
    lengths.size * 400 +
    longWordCount * 160 -
    wordRangePenalty -
    edgePenalty -
    nodeCoveragePenalty -
    uniqueLetterPenalty -
    commonLetterPenalty -
    hereFamilyPenalty -
    thClusterPenalty
  );
};

const createNodes = (letters) =>
  letters.map((letter, index) => ({
    id: cellId(index),
    letter,
    x: gridCoordinates[index % gridSize],
    y: gridCoordinates[Math.floor(index / gridSize)],
  }));

const fillEmptyCells = (letters, random) =>
  letters.map((letter) => letter ?? commonLetterFill[Math.floor(random() * Math.min(12, commonLetterFill.length))]);

const findPlacementPaths = (letters, word, maxPaths = 24) => {
  const target = normalizeWord(word);
  const paths = [];

  const walk = (path) => {
    if (paths.length >= maxPaths) {
      return;
    }

    if (path.length === target.length) {
      paths.push(path);
      return;
    }

    const previous = path.at(-1);
    const options = previous === undefined ? letters.map((_, index) => index) : neighborMap[previous];

    for (const nextIndex of options) {
      if (path.includes(nextIndex)) {
        continue;
      }

      const currentLetter = letters[nextIndex];

      if (currentLetter && currentLetter !== target[path.length]) {
        continue;
      }

      walk([...path, nextIndex]);
    }
  };

  walk([]);
  return paths;
};

const selectAnchorWords = (words, random) => {
  const anchorBands = [
    { minRank: 0, maxRank: 700, take: 24 },
    { minRank: 700, maxRank: 1800, take: 30 },
    { minRank: 1800, maxRank: 4200, take: 36 },
    { minRank: 4200, maxRank: Infinity, take: 42 },
  ];
  const anchors = anchorBands.flatMap(({ minRank, maxRank, take }) =>
    shuffle(
      words.filter((word) => word.rank >= minRank && word.rank < maxRank && word.text.length >= 4 && word.text.length <= 7),
      random,
    ).slice(0, take),
  );

  return shuffle(anchors, random);
};

const buildCandidateBoard = (words, random) => {
  const letters = Array.from({ length: gridSize * gridSize }, () => null);
  const anchors = selectAnchorWords(words, random);

  for (const word of anchors) {
    const paths = findPlacementPaths(letters, word.text);

    if (paths.length === 0) {
      continue;
    }

    const scoredPaths = paths
      .map((path) => ({
        path,
        newCells: path.filter((index) => letters[index] === null).length,
        overlaps: path.filter((index, letterIndex) => letters[index] === word.text[letterIndex]).length,
      }))
      .sort((first, second) => second.overlaps - first.overlaps || second.newCells - first.newCells);
    const chosen = scoredPaths[Math.floor(random() * Math.min(4, scoredPaths.length))].path;

    chosen.forEach((index, letterIndex) => {
      letters[index] = word.text[letterIndex];
    });

    if (letters.every(Boolean)) {
      break;
    }
  }

  return fillEmptyCells(letters, random).join('');
};

const boardCandidates = (words, { attempts, seedBoards, random }) => [
  ...seedBoards.map((letters) => normalizeWord(letters).slice(0, gridSize * gridSize)),
  ...Array.from({ length: attempts }, () => buildCandidateBoard(words, random)),
];

export const generatePuzzle = ({
  id = 'generated',
  title = 'Generated Puzzle',
  rankedWords = [],
  seed = 'zanagrams',
  targetWordCount = 13,
  minRequiredWords = 8,
  maxRequiredWords = 15,
  targetEdges = 20,
  maxEdges = 23,
  minLength = 4,
  maxRank = 25000,
  requiredMaxRank = 1500,
  anchorMaxRank = 8000,
  bonusMaxRank = maxRank,
  attempts = 80,
  seedBoards = ['STARELIDOPNECARS'],
} = {}) => {
  const random = createRandom(seed);
  const requiredWords = filterRankedWords(rankedWords, { minLength, maxRank: requiredMaxRank });
  const anchorWords = filterRankedWords(rankedWords, { minLength, maxRank: anchorMaxRank });
  const bonusCandidates = filterRankedWords(rankedWords, { minLength, maxRank: bonusMaxRank }).filter(
    (word) => word.rank >= requiredMaxRank,
  );
  const boards = boardCandidates(anchorWords, { attempts, seedBoards, random }).filter((letters) => letters.length === 16);
  const best = boards.reduce(
    (bestPuzzle, letters) => {
      const boardLetters = [...letters];
      const candidates = requiredWords.flatMap((word) => {
        const paths = findPathsForWord(boardLetters, word.text);
        return paths.length > 0 ? [{ ...word, paths }] : [];
      });
      const selectedWords = selectWords(candidates, { targetWordCount });
      const nodes = createNodes(boardLetters);
      const closedRequiredWords = closeWordsOverGraph(nodes, selectedWords, requiredWords);
      const score = scorePuzzle(closedRequiredWords, boardLetters, {
        minRequiredWords,
        maxRequiredWords,
        targetEdges,
        maxEdges,
      });

      if (!bestPuzzle || score > bestPuzzle.score) {
        return { letters, selectedWords, requiredWords: closedRequiredWords, score };
      }

      return bestPuzzle;
    },
    null,
  );

  if (!best || best.requiredWords.length === 0) {
    throw new Error('Unable to generate a Zanagrams puzzle from the provided word list.');
  }

  const nodes = createNodes([...best.letters]);
  const bonusWords = closeWordsOverGraph(nodes, best.selectedWords, bonusCandidates);

  return {
    id,
    title,
    nodes,
    words: best.requiredWords.map(({ rank, ...word }) => word),
    bonusWords: bonusWords.map(({ rank, ...word }) => word),
  };
};
