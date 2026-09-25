# Noridoc: PNCP Audiovisual Tender Monitor

Path: @/

### Overview

- A single-shot Node.js/TypeScript script, run as a GitHub Actions workflow that an external cron service (cron-job.org) dispatches on a schedule, that polls PNCP (Brazil's national public procurement portal) for audiovisual-production tenders in SC, PR, and RS, and emails alerts for new matches.
- There is no HTTP server, no web framework, no UI, and no in-process scheduler — the whole system is fetch → filter → dedup → email, run once per invocation, with the "on a timer" part handled entirely outside the process.
- Chosen over a FastAPI/Celery-style architecture because there is no user-facing surface and only one scheduled task; a broker + worker + beat setup would add operational overhead with no corresponding benefit. GitHub Actions was chosen over an always-on server because Actions minutes are free/cheap for this workload.

### How it fits into the larger codebase

- `.github/workflows/poll.yml` defines what a run is (fresh checkout + build + `npm start`, with a `concurrency` group so a run never overlaps a subsequent one), but it has only a `workflow_dispatch` trigger — no `schedule:`. The timer lives outside the repo:

```
cron-job.org (America/Sao_Paulo, 17 8,10,12,14,16 * * *)
  -> POST api.github.com/repos/GuiNardiSS/Automation-YUL/actions/workflows/<poll.yml id>/dispatches
     body {"ref":"master"}, Authorization: Bearer <fine-grained PAT>
  -> HTTP 204 -> GitHub Actions runs poll.yml on master
```

- GitHub's built-in `schedule:` trigger was abandoned because it was unreliable for this repo: only a few of the scheduled runs fired per day, and on some days none fired at all. The same `workflow_dispatch` trigger also serves manual "Run workflow" runs from the Actions tab.
- The cadence (08:17 through 16:17 America/Sao_Paulo, every 2 hours) is configured only in the cron-job.org job, so changing it never touches the repo. It is driven by run cost, not by how fresh alerts need to be. A run takes roughly 8 minutes because PNCP must be queried once per UF × modality, paced for PNCP's rate limit (see `src/pncp/docs.md`), and the private-repo free tier is 2,000 Actions minutes/month. Because every run looks back a full day (`PNCP_LOOKBACK_DAYS`), tenders published after the last run of the day are picked up the next morning.
- `src/index.ts` is the only process entrypoint: it loads config, builds the logger/Redis client/email transport, runs one cycle if `isWithinBusinessHours` (`src/scheduler.ts`) says it's in-window, then explicitly closes Redis and exits — see `src/docs.md` for the full lifecycle.
- External dependencies: the live PNCP HTTP API (`src/pncp/`), a Redis instance for dedup (`src/dedup/`; Upstash in production via `REDIS_URL=rediss://...`, local `docker-compose.yml` Redis for development), and Gmail SMTP for alerts (`src/email/`).
- `scripts/verify-api.ts` and `scripts/send-test-email.ts` are manual, human-run debugging tools — they are not invoked by the automated pipeline, the GitHub Actions workflow, or the test suite.
- `tests/` mirrors `src/`. Pure business logic (filters, dedup, config, formatters, mapper, PNCP client, business-hours check) has unit tests, and `tests/pipeline.test.ts` additionally runs the real `runOnce` end to end against an undici `MockAgent` standing in for PNCP, `ioredis-mock` for Redis, and a recording fake email transport. `src/logger.ts`, `src/email/sender.ts`, and `src/index.ts` are left to manual verification, per `README.md`.

### Core Implementation

- Each GitHub Actions run triggers `runOnce()` in `src/pipeline.ts` exactly once, which fetches PNCP results for every configured UF × modality, maps them to the internal `TenderMatch` shape, filters by state + keyword, deduplicates against Redis, and dispatches email(s).
- `src/config.ts` (`loadConfig`) is the single source of runtime configuration: it fails fast, naming the offending variable, both for missing required env vars and for optional numeric vars that don't parse to a number, and applies defaults for everything else (see `.env.example` for the full list of knobs).
- State lives in two places only: Redis (which tenders have already triggered an email) and the rotating log files under `LOG_DIR` (`src/logger.ts`). The process itself is stateless between runs — each GitHub Actions invocation is a brand-new container with a fresh `npm ci`/`npm run build`.

### Things to Know

- **A green run must mean the run actually worked.** The deployed automation originally never sent a single email while every Actions run showed green: PNCP rejected every request (a required query param was missing), and a wrong Redis password stayed invisible because Redis is only touched once a match exists. The system now fails the job (exit 1, red run, GitHub's failure email) when PNCP looks down — 3 consecutive failed queries, or every query in the run failed (`src/pipeline.ts`) or when Redis doesn't answer a `PING` at startup (`src/index.ts`). A day with simply no results is still a success.
- The PNCP response schema in `src/pncp/types.ts` has been verified against the live API; the live-API facts the client depends on (required `codigoModalidadeContratacao`, HTTP 204 for empty results, HTTP 429 rate limiting) are documented in `src/pncp/docs.md`.
- **`undici` is a direct dependency, not just a dev dependency, for a reason.** `src/pncp/client.ts` imports `fetch` explicitly from the `undici` package instead of using Node's global `fetch`. Node's global fetch is backed by an internal, unexported copy of undici that test-mocking tools (`MockAgent`/`setGlobalDispatcher`) cannot intercept. Any new HTTP code in this project must follow the same pattern or its tests will silently attempt real network calls.
- **Redis failures are meant to be loud.** `src/dedup/redisStore.ts` throws on any Redis error rather than guessing whether a tender is new or already seen. This exception is not caught anywhere in the pipeline — it propagates up to `src/index.ts`'s top-level `catch`, which logs `cycle.failed`, exits with code 1 (a failed GitHub Actions run), and the next scheduled run retries naturally.
- Keyword matching (`src/filters/keywordFilter.ts`) is plain, non-word-boundary substring matching on an accent-stripped, lowercased description. Coincidental substring matches are an accepted tradeoff for simplicity, not a bug.
- The email digest threshold (`EMAIL_DIGEST_THRESHOLD`, default 10) exists purely to avoid inbox flooding when a single poll cycle finds an unusually large batch of new matches.
- **The process must call `process.exit()` explicitly.** `ioredis` keeps a persistent, un-`unref()`'d TCP socket open, which alone keeps the Node.js event loop alive indefinitely. Without the explicit exit in `src/index.ts`, a GitHub Actions job would hang until the workflow's `timeout-minutes`, burning minutes on one stuck invocation.
- **The dispatch token expires, and its expiry is silent on the GitHub side.** The cron-job.org job authenticates with a fine-grained PAT scoped to this repo with only `Actions: Read and write`; it expires 2027-09-25 and must be regenerated and pasted into the job's `Authorization` header before then. Once it expires no run is created at all, so there is no red run or GitHub failure email — the only signal is cron-job.org's failed-execution email. The `X-GitHub-Api-Version: 2022-11-28` header has a GitHub sunset date of 2028-03-10. See `README.md` for the setup and renewal steps. (GitHub's 60-day inactivity auto-disable applies only to `schedule:`-triggered workflows, so it no longer affects this repo.)

Created and maintained by Nori.
