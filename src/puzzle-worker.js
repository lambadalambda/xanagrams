import { createSeededPuzzle } from './game.js';

self.addEventListener('message', (event) => {
  const { requestId, spec } = event.data;

  try {
    self.postMessage({ requestId, puzzle: createSeededPuzzle(spec) });
  } catch (error) {
    self.postMessage({ requestId, error: String(error) });
  }
});
