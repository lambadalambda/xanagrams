# DEVLOG

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
