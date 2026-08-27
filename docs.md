# Noridoc: PNCP Audiovisual Tender Monitor

Path: @/

### Overview

- A single long-running Node.js/TypeScript process that polls PNCP (Brazil's national public procurement portal) for audiovisual-production tenders in SC, PR, and RS, and emails alerts for new matches.
- Runs entirely as an in-process cron job (`node-cron`) — there is no HTTP server, no web framework, and no UI. The whole system is fetch → filter → dedup → email on a timer.
- Chosen over a FastAPI/Celery-style architecture because there is no user-facing surface and only one scheduled task; a broker + worker + beat setup would add operational overhead with no corresponding benefit.

### How it fits into the larger codebase

- `src/index.ts` is the only process entrypoint: it loads config, builds the logger/Redis client/email transport, and registers the poll schedule.
- External dependencies: the live PNCP HTTP API (`src/pncp/`), a Redis instance for dedup (`src/dedup/`, provisioned locally via `docker-compose.yml`), and Gmail SMTP for alerts (`src/email/`).
- `scripts/verify-api.ts` and `scripts/send-test-email.ts` are manual, human-run verification tools — they are not invoked by the automated pipeline or test suite.
- `tests/` mirrors `src/` and covers all pure business logic (filters, dedup, config, formatters, mapper, PNCP client, the business-hours check, and `src/pipeline.ts`'s extracted `shouldDigest` decision). The rest of the orchestration/I-O glue (`src/pipeline.ts`'s `runOnce`/`dispatchEmails`, `src/logger.ts`, `src/email/sender.ts`, `src/index.ts`) is deliberately left to manual/integration verification instead, per `README.md`.

### Core Implementation

- One 5-minute cron tick (default `*/5 8-17 * * *`, `America/Sao_Paulo`) triggers `runOnce()` in `src/pipeline.ts`, which fetches PNCP results for every configured UF, maps them to the internal `TenderMatch` shape, filters by state + keyword, deduplicates against Redis, and dispatches email(s).
- `src/config.ts` (`loadConfig`) is the single source of runtime configuration: it fails fast, naming the offending variable, both for missing required env vars and for optional numeric vars that don't parse to a number, and applies defaults for everything else (see `.env.example` for the full list of knobs).
- State lives in two places only: Redis (which tenders have already triggered an email) and the rotating log files under `LOG_DIR` (`src/logger.ts`). The process itself is stateless between cron ticks.

### Things to Know

- **Task 0 is mandatory, not optional.** `src/pncp/types.ts` was reverse-engineered from secondary sources (an official manual PDF, blog posts, a GitHub gist) because the live PNCP API wasn't reachable during development. `npm run verify-api` (`scripts/verify-api.ts`) must be run against the live API and compared against `src/pncp/types.ts` before any of those field names/shapes are trusted.
- **`undici` is a direct dependency, not just a dev dependency, for a reason.** `src/pncp/client.ts` imports `fetch` explicitly from the `undici` package instead of using Node's global `fetch`. Node's global fetch is backed by an internal, unexported copy of undici that test-mocking tools (`MockAgent`/`setGlobalDispatcher`) cannot intercept. Any new HTTP code in this project must follow the same pattern or its tests will silently attempt real network calls.
- **Redis failures are meant to be loud.** `src/dedup/redisStore.ts` throws on any Redis error rather than guessing whether a tender is new or already seen. This exception is not caught anywhere in the pipeline — it propagates up to `src/scheduler.ts`'s handler, aborts that cycle's emails, and the next 5-minute tick retries naturally.
- Keyword matching (`src/filters/keywordFilter.ts`) is plain, non-word-boundary substring matching on an accent-stripped, lowercased description. Coincidental substring matches are an accepted tradeoff for simplicity, not a bug.
- The email digest threshold (`EMAIL_DIGEST_THRESHOLD`, default 10) exists purely to avoid inbox flooding when a single poll cycle finds an unusually large batch of new matches.

Created and maintained by Nori.
