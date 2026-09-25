# Noridoc: src

Path: @/src

### Overview

- The application's source code, organized by concern: PNCP API integration, filtering, dedup, email, plus the shared config/logger/scheduler/pipeline glue that ties them together.
- `src/index.ts` is the only process entrypoint; everything else is either pure business logic (unit tested), orchestration (integration tested via `runOnce`), or thin I/O wiring (verified manually).
- The process is single-shot: one invocation of `node dist/index.js` (`npm start`) runs at most one poll cycle and then exits. Repeated invocation is handled entirely outside this folder, by `.github/workflows/poll.yml`'s GitHub Actions schedule — see the root `docs.md`.

### How it fits into the larger codebase

- `src/domain/tender.ts` defines `TenderMatch`, the normalized shape used everywhere downstream of `src/pncp/mapper.ts` — filters, dedup, and email formatting all consume `TenderMatch`, never PNCP's raw API shape directly.
- `src/pipeline.ts` (`runOnce`) is the orchestrator: it calls out to `src/pncp/` (fetch + map), `src/filters/` (state + keyword filter), `src/dedup/` (seen-check), and `src/email/` (format + send), in that order.
- `src/scheduler.ts` contains only `isWithinBusinessHours(date, timezone)`, a pure function `src/index.ts` calls as a defensive guard (business hours are 08:00–18:00 in the configured timezone). The actual recurring trigger is external, driven by `.github/workflows/poll.yml`'s `schedule: cron:` entry; since GitHub Actions delays/misfires are possible, this guard prevents a late-firing run from sending alerts outside the intended window.
- `src/config.ts` is read once at startup by `src/index.ts` and threaded through every other module as a plain `Config` object — there is no runtime config reloading.

### Core Implementation

- `loadConfig(env)` in `src/config.ts` is a pure function: it fails fast, by variable name, both for missing required vars (`SMTP_USER`, `SMTP_APP_PASSWORD`, `RECIPIENT_EMAILS`, `REDIS_URL`) and for optional numeric vars that don't parse to a number (e.g. `PNCP_PAGE_SIZE=fifty`), instead of letting `NaN` silently propagate into query strings/timers; everything else falls back to a default (see `.env.example`). Comma-separated list vars (`RECIPIENT_EMAILS`, `PNCP_UFS`, `PNCP_MODALIDADE_CODES`) go through a shared `splitList` helper that trims entries and drops empty ones.
- `src/index.ts`'s `main()` runs the whole lifecycle for one invocation:

```
load config -> build logger
  -> isWithinBusinessHours? no -> log scheduler.skipped, exit 0
  -> build Redis client / seen store / email transport
  -> redis.ping()          (bad credentials fail here)
  -> runOnce()
  -> closeRedis()          (quit(), falling back to disconnect() after 5s)
  -> process.exit(0) on success, or log cycle.failed + process.exit(1)
```

- **The Redis `PING` before `runOnce` is a health check, not a functional requirement.** Redis is otherwise only touched once a filtered match exists, so a broken `REDIS_URL` (e.g. a `WRONGPASS` from a wrong password in the GitHub secret) stayed invisible on every day with no audiovisual tenders. Pinging first makes bad credentials fail the run immediately (red job, GitHub failure email).
- `fetchAllRawItems` in `src/pipeline.ts` queries PNCP once per `Config.pncpUfs` × `Config.pncpModalidadeCodes` combination (default: all 13 modality codes), because PNCP rejects the endpoint with HTTP 400 unless `codigoModalidadeContratacao` is sent. It sleeps `Config.pncpRequestDelayMs` between every query (not before the first); `src/pncp/client.ts` separately applies the same delay between pages within one query. The default delay (6000 ms) is sized for PNCP's rate limit, which is why a full run takes several minutes.
- **Failure policy for PNCP queries:** a failing UF × modality query is caught and logged as `pncp.error` (tagged with `uf` and `modalidade`) without aborting the cycle, so results from the other queries still get filtered and emailed. The run is aborted (throwing, which propagates to `src/index.ts` and fails the job) in two cases: 3 consecutive failed queries (`MAX_CONSECUTIVE_PNCP_FAILURES`, i.e. PNCP looks down; stopping early keeps an outage from running past the workflow timeout), or every attempted query failed. A query that returns no results (PNCP's HTTP 204) counts as a success, so a quiet day does not fail the run.
- `runOnce()` logs checkpoints per cycle (`pncp.request`/`pncp.response`, `filter.summary`, `email.draft`, `email.sent`) via the winston logger from `src/logger.ts`, which are the primary way to debug a run (see `README.md`, and the workflow run's logs in production).
- `runOnce` maps raw PNCP items via `toTenderMatchesSafely` (`src/pncp/mapper.ts`) rather than mapping directly: a malformed item is caught, logged as `pncp.mapping_error`, and skipped, so it can't abort mapping for the rest of the batch — see `src/pncp/docs.md`.

### Things to Know

- `tests/pipeline.test.ts` unit-tests the pure `shouldDigest(matchCount, threshold)` decision and also runs the real `runOnce` against an undici `MockAgent` (PNCP), `ioredis-mock` (passed into the real `RedisSeenStore`), and a recording fake email transport, covering the all-queries-failed, partial-failure, and all-empty cases. `ioredis-mock` instances share one in-memory store, so those tests flush it between cases. `src/logger.ts`, `src/email/sender.ts`, and `src/index.ts` remain untested by design, verified via `scripts/send-test-email.ts` and by inspecting log checkpoints during a manual run.
- `src/index.ts` attaches an `'error'` listener to the `ioredis` client so connection-level Redis errors are logged (`redis.connection_error`) through the same winston logs as everything else. The `Redis` client is also constructed with a bounded `connectTimeout`, `maxRetriesPerRequest`, and `retryStrategy` rather than ioredis's default of retrying an unreachable server forever — necessary because each run is a billed-by-the-minute GitHub Actions job.
- The business-hours check happens before the Redis client is constructed, so a late-firing run that gets skipped never touches Redis or SMTP.
- **`process.exit()` at the end of `src/index.ts` is required, not stylistic.** `ioredis` holds a persistent, non-`unref()`'d TCP socket open, which alone keeps the Node.js event loop alive forever. Without the explicit exit, a run would hang until the workflow's timeout.
- `closeRedis` failures in the `finally` block are caught and logged separately (`redis.close_failed`) so they can't replace the original error thrown by `runOnce`/`ping`.
- Dedup happens before email confirmation: `runOnce` marks every filtered match as "seen" in Redis (`selectNewMatches`) before attempting to send any email. If a send later fails, `dispatchEmails` compensates by calling `seenStore.unmarkSeen()` on the affected match(es) so the next scheduled run retries them — see `src/dedup/docs.md` and `src/email/docs.md`.
- The GitHub Actions cron trigger's own hour range (`.github/workflows/poll.yml`, in UTC) and `isWithinBusinessHours`'s hardcoded 08:00–18:00 check (in `Config.pollTimezone`) are two independent guards against off-hours runs — changing one without the other can produce surprising results. There is no cron-expression config var; the schedule lives only in the workflow YAML.
- The workflow's `timeout-minutes` must leave room for a full run (every UF × modality query, paced, plus possible rate-limit backoffs); lowering `PNCP_REQUEST_DELAY_MS` shortens runs but makes PNCP's HTTP 429 more likely.

Created and maintained by Nori.
