# PNCP Audiovisual Tender Monitor

Checks PNCP (Portal Nacional de Contratações Públicas) roughly every 10 minutes during business
hours (08:00–18:00, America/Sao_Paulo) for tenders in SC, PR, and RS matching audiovisual-related
keywords, and emails alerts for new matches.

Production runs as a **single-shot script triggered repeatedly by GitHub Actions**
(`.github/workflows/poll.yml`), not as an always-on server — each run does one check and exits.
Redis (for deduplication) is a free hosted database on [Upstash](https://upstash.com) in
production; locally, `docker-compose.yml` gives you a plain Redis for development.

## Production setup (GitHub Actions + Upstash)

1. **Create a free Redis database on Upstash** (upstash.com, no credit card required) and copy
   its connection string — it looks like `rediss://default:TOKEN@endpoint:port` (note the double
   "s": TLS is mandatory on Upstash, and `ioredis` picks that up automatically from the URL).
2. **Get a Gmail App Password** (myaccount.google.com/apppasswords — requires 2-Step
   Verification enabled first) for the account that will send the alert emails.
3. **Add 4 repository secrets** on GitHub (`Settings → Secrets and variables → Actions →
   New repository secret`):
   - `SMTP_USER` — the Gmail address sending alerts
   - `SMTP_APP_PASSWORD` — the App Password from step 2
   - `RECIPIENT_EMAILS` — who receives alerts (comma-separated for multiple)
   - `REDIS_URL` — the Upstash connection string from step 1
4. **Enable the workflow**: the Actions tab should show "Poll PNCP for audiovisual tenders"
   already scheduled. Use "Run workflow" there to trigger one manually and confirm it works
   before waiting on the schedule.
5. **Watch your GitHub Actions usage** (`Settings → Billing → Actions`) for the first few days.
   The 10-minute cadence was sized to fit GitHub's free-tier minutes for a private repo, but if
   real per-run time runs higher than estimated, widen the interval in
   `.github/workflows/poll.yml` (`cron: '*/10 11-20 * * *'` → e.g. `*/15`).
6. **Keep the repository active.** GitHub automatically disables `schedule`-triggered workflows
   after 60 days with no commits to the repo (documented for public repos; unconfirmed but
   possible for private ones too). If alerts silently stop arriving, check the Actions tab first —
   the workflow may need to be manually re-enabled ("Enable workflow" button). A trivial periodic
   commit (or re-enabling it every couple of months) avoids this entirely.

## Task 0 — verify the PNCP API before trusting this codebase's assumptions

`src/pncp/types.ts` and `src/pncp/client.ts` were written from secondary sources (the official
PNCP API manual PDF, blog writeups, a GitHub gist) because live API calls weren't reachable
during development. Run this first and compare the real response against `src/pncp/types.ts`:

```bash
npm run verify-api
```

## Local development

```bash
npm install
cp .env.example .env   # fill in SMTP_USER, SMTP_APP_PASSWORD, RECIPIENT_EMAILS
docker-compose up -d   # local Redis (production uses Upstash instead, see above)

npm test          # run the test suite
npm run build      # compile TypeScript
npm start          # run one cycle locally, then exit (same as a single GitHub Actions run)
```

## Manual verification before go-live

```bash
npm run send-test-email   # confirm real Gmail SMTP credentials work
```

Then trigger a run — locally via `npm start`, or on GitHub via the Actions tab's "Run workflow" —
and check the logs for the four checkpoints: `pncp.request`/`pncp.response`, `filter.summary`,
`email.draft`, `email.sent`. Locally these also land in `./logs/app-*.log`; on GitHub Actions,
each run's logs live in that run's page under the Actions tab (no persistent log file, since the
runner is discarded after each run).
