# Noridoc: PNCP Audiovisual Tender Monitor

Path: @/

### Overview

- A single-shot Node.js/TypeScript script, re-invoked on a schedule by GitHub Actions, that polls PNCP (Brazil's national public procurement portal) for audiovisual-production tenders in SC, PR, and RS, and emails alerts for new matches.
- There is no HTTP server, no web framework, no UI, and (as of the GitHub Actions migration) no in-process scheduler either — the whole system is fetch → filter → dedup → email, run once per invocation, with the "on a timer" part handled entirely outside the process.
- Chosen over a FastAPI/Celery-style architecture because there is no user-facing surface and only one scheduled task; a broker + worker + beat setup would add operational overhead with no corresponding benefit. GitHub Actions was chosen over an always-on server because nothing was ever actually deployed anywhere, and Actions' scheduled workflows are free/cheap for this workload.

### How it fits into the larger codebase

- `.github/workflows/poll.yml` is what actually drives execution in production: a `schedule: cron:` trigger fires a fresh checkout + build + `npm start` roughly every 10 minutes, matching business hours in UTC terms (plus a `workflow_dispatch` trigger for manual runs, and a `concurrency` group so a delayed run never overlaps a subsequent one).
- `src/index.ts` is the only process entrypoint: it loads config, builds the logger/Redis client/email transport, runs one cycle if `isWithinBusinessHours` (`src/scheduler.ts`) says it's in-window, then explicitly closes Redis and exits — see `src/docs.md` for the full lifecycle.
- External dependencies: the live PNCP HTTP API (`src/pncp/`), a Redis instance for dedup (`src/dedup/`; Upstash in production via `REDIS_URL=rediss://...`, local `docker-compose.yml` Redis for development), and Gmail SMTP for alerts (`src/email/`).
- `scripts/verify-api.ts` and `scripts/send-test-email.ts` are manual, human-run verification tools — they are not invoked by the automated pipeline, the GitHub Actions workflow, or the test suite.
- `tests/` mirrors `src/` and covers all pure business logic (filters, dedup, config, formatters, mapper, PNCP client, the business-hours check, and `src/pipeline.ts`'s extracted `shouldDigest` decision). The rest of the orchestration/I-O glue (`src/pipeline.ts`'s `runOnce`/`dispatchEmails`, `src/logger.ts`, `src/email/sender.ts`, `src/index.ts`) is deliberately left to manual/integration verification instead, per `README.md`.

### Core Implementation

- Each GitHub Actions run triggers `runOnce()` in `src/pipeline.ts` exactly once, which fetches PNCP results for every configured UF, maps them to the internal `TenderMatch` shape, filters by state + keyword, deduplicates against Redis, and dispatches email(s).
- `src/config.ts` (`loadConfig`) is the single source of runtime configuration: it fails fast, naming the offending variable, both for missing required env vars and for optional numeric vars that don't parse to a number, and applies defaults for everything else (see `.env.example` for the full list of knobs).
- State lives in two places only: Redis (which tenders have already triggered an email) and the rotating log files under `LOG_DIR` (`src/logger.ts`). The process itself is stateless between runs — each GitHub Actions invocation is a brand-new container with a fresh `npm ci`/`npm run build`.

### Things to Know

- **Task 0 is mandatory, not optional.** `src/pncp/types.ts` was reverse-engineered from secondary sources (an official manual PDF, blog posts, a GitHub gist) because the live PNCP API wasn't reachable during development. `npm run verify-api` (`scripts/verify-api.ts`) must be run against the live API and compared against `src/pncp/types.ts` before any of those field names/shapes are trusted.
- **`undici` is a direct dependency, not just a dev dependency, for a reason.** `src/pncp/client.ts` imports `fetch` explicitly from the `undici` package instead of using Node's global `fetch`. Node's global fetch is backed by an internal, unexported copy of undici that test-mocking tools (`MockAgent`/`setGlobalDispatcher`) cannot intercept. Any new HTTP code in this project must follow the same pattern or its tests will silently attempt real network calls.
- **Redis failures are meant to be loud.** `src/dedup/redisStore.ts` throws on any Redis error rather than guessing whether a tender is new or already seen. This exception is not caught anywhere in the pipeline — it propagates up to `src/index.ts`'s top-level `catch`, which logs `cycle.failed`, exits with code 1 (a failed GitHub Actions run), and the next scheduled run (roughly 10 minutes later) retries naturally.
- Keyword matching (`src/filters/keywordFilter.ts`) is plain, non-word-boundary substring matching on an accent-stripped, lowercased description. Coincidental substring matches are an accepted tradeoff for simplicity, not a bug.
- The email digest threshold (`EMAIL_DIGEST_THRESHOLD`, default 10) exists purely to avoid inbox flooding when a single poll cycle finds an unusually large batch of new matches.
- **The process must call `process.exit()` explicitly.** `ioredis` keeps a persistent, un-`unref()`'d TCP socket open, which alone keeps the Node.js event loop alive indefinitely. Without the explicit exit in `src/index.ts`, a GitHub Actions job would hang until GitHub's own multi-hour job timeout, burning the whole run's minutes on one stuck invocation instead of finishing in seconds.

Created and maintained by Nori.
