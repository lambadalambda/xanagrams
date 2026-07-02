# DEVLOG

## 2026-07-02

- Added a settings dialog (gear icon) with eight persisted feature toggles so every new behavior can be turned on or off: curated dictionary, distinct required words, daily puzzle, timer & best times, save progress, hints, definitions, and enhanced feedback. All default on.
- Curated dictionary: vendored the public-domain ENABLE word list (`data/enable1.txt`); `npm run build:words` now also emits `EXCLUDED_WORDS` (4,408 entries) covering proper nouns (TINA, NERO), tokenizer artifacts (MENT), contraction fragments (ARENT), informalisms (SHOULDA), and profanity. The generator filters against it when the toggle is on.
- Distinct required words: incidental closure words that are inflections, substrings, near-anagrams, or heavy bigram overlaps of an already-required word (pair similarity >= 1.2) are demoted to bonus words instead of blocking completion (e.g. SOMEONE required, SOME bonus).
- Generator performance: per-board word graph (adjacency + letter maps built once instead of per word) and a letter-multiset prefilter before path search. Random generation dropped from ~380 ms to ~120 ms for 120 attempts.
- Moved puzzle generation off the main thread into a module Web Worker with a synchronous fallback, and prefetch the likely next puzzles in the background, so the starter/random/daily buttons feel instant. `game.js` no longer generates the starter puzzle at module load (use `createStarterPuzzle()`).
- Daily puzzle: date-seeded `Zanagrams #N` (epoch 2026-07-01) identical for everyone on a given day, with a completion checkmark and a day-streak counter.
- Timer & stats: per-mode best times in localStorage, timer pauses while the tab is hidden, completion message shows solve time, best, streak, and bonus-word summary.
- Save progress: in-progress puzzles (seed + found words + hints + elapsed time) are restored after reload by regenerating from the saved seed.
- Hints: one per puzzle plus one per two bonus words found; a hint briefly pulses one remaining word's path in green.
- Definitions: found word chips are tappable and look up meanings via dictionaryapi.dev.
- Enhanced feedback: found words flash on the board before their letters vanish, wrong guesses shake the word pill, completion pops the heading.
- Fixed: "Next puzzle" after finishing a random/daily puzzle now starts a fresh puzzle instead of returning to the tutorial, and a failed generation no longer leaves the random button stuck on "Generating...".

## 2026-07-01

- Implemented Zanagrams as a static browser game in an empty project.
- Captured the screenshot rules in code: drag or tap connected letters, submit hidden words, and remove letters/paths once no remaining word needs them.
- Added a guided tutorial puzzle matching the provided reference images and a second playable starter puzzle.
- Added Node unit tests for path spelling, connected-path validation, order-independent word solving, and letter/path removal.
- Replaced the hand-authored second puzzle with a reusable 4x4 generator that filters ranked common words to 4+ letters, finds neighbor-path words, and scores puzzles for coverage/connectivity.
- Updated generation so the answer set is closed over the visible graph: every ranked 4+ letter word playable on the shown paths counts, including reverse paths and incidental words.
- Tuned the generated starter puzzle for a mix of word lengths instead of only four-letter words.
- Added required vs bonus word tiers. Required words control completion and disappearing paths; lower-frequency playable words are accepted as bonus words without blocking puzzle completion.
- Vendored a frequency-ranked `wordfreq` source and generated the importable word list with `npm run build:words`.
- Retuned puzzle generation to avoid hyperdense boards: required words are scored toward an 8-15 range, edge unions are penalized above 23 edges, and the starter puzzle now has 11 required words with 5 bonus words.
- Added a frontend Random puzzle button. Current generation averages about 226 ms for 80 candidate attempts in Node and uses the same required/bonus/count/density caps as the starter puzzle.
- Improved random-puzzle variety by sampling anchor words across frequency bands and penalizing repeated HERE/THERE-family clusters, excessive TH/HER/ERE words, low letter diversity, and overuse of high-frequency letters. Generation now averages about 242 ms for 80 attempts.
- Added a broader near-duplicate penalty for required words, covering prefix/substring variants, inflections like LEAD/LEADING, dropped-e variants like LIVE/LIVING, high bigram overlap, and near-anagrams such as BEING/BEGIN. Increased random generation to 120 attempts to preserve board coverage while avoiding repetitive word families.
