# Noridoc: src

Path: @/src

### Overview

- The application's source code, organized by concern: PNCP API integration, filtering, dedup, email, plus the shared config/logger/scheduler/pipeline glue that ties them together.
- `src/index.ts` is the only process entrypoint; everything else is either pure business logic (tested) or thin I/O wiring (not unit tested, verified manually instead).
- The process is single-shot: one invocation of `node dist/index.js` (`npm start`) runs at most one poll cycle and then exits. Repeated invocation is handled entirely outside this folder, by `.github/workflows/poll.yml`'s GitHub Actions schedule — see the root `docs.md`.

### How it fits into the larger codebase

- `src/domain/tender.ts` defines `TenderMatch`, the normalized shape used everywhere downstream of `src/pncp/mapper.ts` — filters, dedup, and email formatting all consume `TenderMatch`, never PNCP's raw API shape directly.
- `src/pipeline.ts` (`runOnce`) is the orchestrator: it calls out to `src/pncp/` (fetch + map), `src/filters/` (state + keyword filter), `src/dedup/` (seen-check), and `src/email/` (format + send), in that order.
- `src/scheduler.ts` contains only `isWithinBusinessHours(date, timezone)`, a pure function `src/index.ts` calls as a defensive guard (business hours are 08:00–18:00 in the configured timezone). It no longer schedules anything itself — the actual recurring trigger is external, driven by `.github/workflows/poll.yml`'s `schedule: cron:` entry, since GitHub Actions delays/misfires are possible and this guard prevents a late-firing run from sending alerts outside the intended window.
- `src/config.ts` is read once at startup by `src/index.ts` and threaded through every other module as a plain `Config` object — there is no runtime config reloading.

### Core Implementation

- `loadConfig(env)` in `src/config.ts` is a pure function: it fails fast, by variable name, both for missing required vars (`SMTP_USER`, `SMTP_APP_PASSWORD`, `RECIPIENT_EMAILS`, `REDIS_URL`) and for optional numeric vars that don't parse to a number (e.g. `PNCP_PAGE_SIZE=fifty`), instead of letting `NaN` silently propagate into query strings/timers; everything else falls back to a default (see `.env.example`). Comma-separated list vars (`RECIPIENT_EMAILS`, `PNCP_UFS`, `PNCP_MODALIDADE_CODES`) go through a shared `splitList` helper that trims entries and drops empty ones, so a trailing comma doesn't produce a spurious empty-string entry.
- `src/index.ts`'s `main()` runs the whole lifecycle for one invocation: load config → build logger/Redis client/email transport → check `isWithinBusinessHours` (skip the cycle if outside the window) → `runOnce()` → close Redis (`redis.quit()`, racing a 5-second timeout that falls back to `redis.disconnect()` if `quit()` hangs) → `process.exit(0)` on success or `process.exit(1)` on any thrown error.
- `isWithinBusinessHours(date, timezone)` in `src/scheduler.ts` is a pure, independently-tested function using `Intl.DateTimeFormat` for timezone-aware hour extraction.
- `runOnce()` in `src/pipeline.ts` logs four checkpoints per cycle (`pncp.request`/`pncp.response`, `filter.summary`, `email.draft`, `email.sent`) via the winston logger from `src/logger.ts`, which are the primary way to debug a run (see `README.md`'s "Manual verification before go-live" section, and the workflow run's logs in production).
- Per-UF PNCP fetch failures inside `runOnce` are caught and logged (`pncp.error`) without aborting the whole cycle, so one state's API failure doesn't prevent alerts for the others.
- `runOnce` maps raw PNCP items via `toTenderMatchesSafely` (`src/pncp/mapper.ts`) rather than mapping directly: a malformed item is caught, logged as `pncp.mapping_error`, and skipped, so it can't abort mapping for the rest of that cycle's batch — see `src/pncp/docs.md`.

### Things to Know

- `src/pipeline.ts` is mostly orchestration/I-O glue verified manually, but its digest-vs-individual-email decision is extracted into a pure, exported `shouldDigest(matchCount, threshold)` function and unit-tested in `tests/pipeline.test.ts` — the only unit test file for `src/pipeline.ts`. `src/logger.ts`, `src/email/sender.ts`, and `src/index.ts` remain entirely untested by design, verified instead via `scripts/send-test-email.ts` and by inspecting the log checkpoints during a manual run.
- `src/index.ts` attaches an `'error'` listener to the `ioredis` client so connection-level Redis errors are logged (`redis.connection_error`) through the same winston/`LOG_DIR` logs as everything else, rather than only reaching raw `console.error` or ioredis's default handling. The `Redis` client is also constructed with a bounded `connectTimeout`, `maxRetriesPerRequest`, and `retryStrategy` (capped retries) rather than ioredis's default of retrying an unreachable server forever — necessary now that each run is a billed-by-the-minute GitHub Actions job rather than an always-on process that could afford to wait out a transient outage.
- **`process.exit()` at the end of `src/index.ts` is required, not stylistic.** `ioredis` holds a persistent, non-`unref()`'d TCP socket open, which alone keeps the Node.js event loop alive forever. Without the explicit exit, a GitHub Actions run would hang until GitHub's own multi-hour job timeout instead of finishing in seconds, burning through the free-tier minutes budget.
- Dedup happens before email confirmation: `runOnce` marks every filtered match as "seen" in Redis (`selectNewMatches`) before attempting to send any email. If a send later fails, `dispatchEmails` compensates by calling `seenStore.unmarkSeen()` on the affected match(es) so the next scheduled run retries them, rather than losing the notification permanently — see `src/dedup/docs.md` and `src/email/docs.md`.
- `Config.pncpModalidadeCodes` is parsed from `PNCP_MODALIDADE_CODES` but is not currently passed through to `src/pncp/client.ts`'s requests from `src/pipeline.ts` — the client supports an optional `codigoModalidadeContratacao` query param, but the pipeline never sets it, so PNCP results are not filtered by modality before reaching the keyword/state filters.
- The GitHub Actions cron trigger's own hour range (`.github/workflows/poll.yml`, in UTC) and `isWithinBusinessHours`'s hardcoded 08:00–18:00 check (in `Config.pollTimezone`) are two independent guards against off-hours runs — changing one without the other can produce surprising results. There is no `Config.pollCronExpression`/`POLL_CRON_EXPRESSION` anymore; the schedule lives only in the workflow YAML.

Created and maintained by Nori.
