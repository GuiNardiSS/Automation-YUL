# Noridoc: src/filters

Path: @/src/filters

### Overview

- Pure, synchronous filtering logic that decides which `TenderMatch` records (from `src/pncp/mapper.ts`) are relevant: must be in a target state AND match an audiovisual keyword.
- No I/O, no config dependency — every function here takes plain data in and returns plain data out, which is why this folder has full unit test coverage.

### How it fits into the larger codebase

- `src/pipeline.ts` calls `filterAudiovisualTenders` (from `index.ts`) once per cycle, immediately after mapping raw PNCP items to `TenderMatch` and before the dedup step in `src/dedup/`.
- Depends only on `TenderMatch` (`src/domain/tender.ts`); has no knowledge of PNCP's raw API shape, Redis, email, or config.

### Core Implementation

- `stateFilter.ts` (`matchesTargetState`) checks `tender.uf` (upper-cased) against a hardcoded set: SC, PR, RS.
- `keywordFilter.ts` (`matchesKeywords`) normalizes `tender.description` (Unicode NFD decomposition + strip combining diacritics + lowercase) and checks whether it contains any keyword from `keywords.ts` as a plain substring.
- `index.ts` (`filterAudiovisualTenders`) combines both checks with AND — a tender must pass the state filter and the keyword filter to be included.

### Things to Know

- Keyword matching is deliberate plain substring matching, not word-boundary-aware. A coincidental substring match inside an unrelated longer word is an accepted tradeoff for simplicity (YAGNI), not a bug to fix.
- `keywords.ts` is the single extension point for tuning what counts as "audiovisual" — it is a flat, lowercase, accent-stripped string array checked against the normalized description.
- Filtering only inspects `description`, which `src/pncp/mapper.ts` currently populates from the same source field (`objetoCompra`) as `title` — there is no separate signal being checked beyond that one field.

Created and maintained by Nori.
