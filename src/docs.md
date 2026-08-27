# Noridoc: src

Path: @/src

### Overview

- The application's source code, organized by concern: PNCP API integration, filtering, dedup, email, plus the shared config/logger/scheduler/pipeline glue that ties them together.
- `src/index.ts` is the only process entrypoint; everything else is either pure business logic (tested) or thin I/O wiring (not unit tested, verified manually instead).

### How it fits into the larger codebase

- `src/domain/tender.ts` defines `TenderMatch`, the normalized shape used everywhere downstream of `src/pncp/mapper.ts` — filters, dedup, and email formatting all consume `TenderMatch`, never PNCP's raw API shape directly.
- `src/pipeline.ts` (`runOnce`) is the orchestrator: it calls out to `src/pncp/` (fetch + map), `src/filters/` (state + keyword filter), `src/dedup/` (seen-check), and `src/email/` (format + send), in that order.
- `src/scheduler.ts` wraps `node-cron` and only invokes the pipeline handler during business hours (08:00–18:00 in the configured timezone), independent of the cron expression's own hour range.
- `src/config.ts` is read once at startup by `src/index.ts` and threaded through every other module as a plain `Config` object — there is no runtime config reloading.

### Core Implementation

- `loadConfig(env)` in `src/config.ts` is a pure function: it fails fast, by variable name, both for missing required vars (`SMTP_USER`, `SMTP_APP_PASSWORD`, `RECIPIENT_EMAILS`, `REDIS_URL`) and for optional numeric vars that don't parse to a number (e.g. `PNCP_PAGE_SIZE=fifty`), instead of letting `NaN` silently propagate into query strings/timers; everything else falls back to a default (see `.env.example`). Comma-separated list vars (`RECIPIENT_EMAILS`, `PNCP_UFS`, `PNCP_MODALIDADE_CODES`) go through a shared `splitList` helper that trims entries and drops empty ones, so a trailing comma doesn't produce a spurious empty-string entry.
- `isWithinBusinessHours(date, timezone)` in `src/scheduler.ts` is a pure, independently-tested function (using `Intl.DateTimeFormat` for timezone-aware hour extraction); `registerPollSchedule` is the thin, untested wrapper that wires it to `node-cron`.
- `runOnce()` in `src/pipeline.ts` logs four checkpoints per cycle (`pncp.request`/`pncp.response`, `filter.summary`, `email.draft`, `email.sent`) via the winston logger from `src/logger.ts`, which are the primary way to debug a live run (see `README.md`'s "Manual verification before go-live" section).
- Per-UF PNCP fetch failures inside `runOnce` are caught and logged (`pncp.error`) without aborting the whole cycle, so one state's API failure doesn't prevent alerts for the others.
- `runOnce` maps raw PNCP items via `toTenderMatchesSafely` (`src/pncp/mapper.ts`) rather than mapping directly: a malformed item is caught, logged as `pncp.mapping_error`, and skipped, so it can't abort mapping for the rest of that cycle's batch — see `src/pncp/docs.md`.

### Things to Know

- `src/pipeline.ts` is mostly orchestration/I-O glue verified manually, but its digest-vs-individual-email decision is extracted into a pure, exported `shouldDigest(matchCount, threshold)` function and unit-tested in `tests/pipeline.test.ts` — the only unit test file for `src/pipeline.ts`. `src/logger.ts`, `src/email/sender.ts`, and `src/index.ts` remain entirely untested by design, verified instead via `scripts/send-test-email.ts` and by inspecting the log checkpoints during a manual run.
- `src/index.ts` attaches an `'error'` listener to the `ioredis` client so connection-level Redis errors are logged (`redis.connection_error`) through the same winston/`LOG_DIR` logs as everything else, rather than only reaching raw `console.error` or ioredis's default handling.
- Dedup happens before email confirmation: `runOnce` marks every filtered match as "seen" in Redis (`selectNewMatches`) before attempting to send any email. If a send later fails, `dispatchEmails` compensates by calling `seenStore.unmarkSeen()` on the affected match(es) so the next cron tick retries them, rather than losing the notification permanently — see `src/dedup/docs.md` and `src/email/docs.md`.
- `Config.pncpModalidadeCodes` is parsed from `PNCP_MODALIDADE_CODES` but is not currently passed through to `src/pncp/client.ts`'s requests from `src/pipeline.ts` — the client supports an optional `codigoModalidadeContratacao` query param, but the pipeline never sets it, so PNCP results are not filtered by modality before reaching the keyword/state filters.
- The cron expression's own hour range (e.g. `8-17` in the default `*/5 8-17 * * *`) and `isWithinBusinessHours`'s hardcoded 08:00–18:00 check are two independent guards against off-hours runs — changing one without the other can produce surprising results.

Created and maintained by Nori.
