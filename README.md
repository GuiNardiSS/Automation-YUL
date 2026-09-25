# PNCP Audiovisual Tender Monitor

Checks PNCP (Portal Nacional de Contratações Públicas) every 2 hours during business hours
(08:17, 10:17, 12:17, 14:17, 16:17 America/Sao_Paulo) for tenders in SC, PR, and RS matching
audiovisual-related keywords, and emails alerts for new matches. Each run looks back a full day,
so tenders published after the last run of the day are picked up the next morning.

Production runs as a **single-shot script executed by GitHub Actions**
(`.github/workflows/poll.yml`), not as an always-on server — each run does one check and exits.
The workflow has no `schedule:` trigger: a free [cron-job.org](https://cron-job.org) job starts it
at the times above through GitHub's REST API, because GitHub's own scheduler silently skipped most
runs (on some days none fired at all).
Redis (for deduplication) is a free hosted database on [Upstash](https://upstash.com) in
production; locally, `docker-compose.yml` gives you a plain Redis for development.

## Production setup (GitHub Actions + Upstash + cron-job.org)

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
4. **Confirm the workflow runs**: in the Actions tab, use "Run workflow" on "Poll PNCP for
   audiovisual tenders" to trigger one manually and check that it goes green.
5. **Create a GitHub token for the external trigger**: `Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token`, with repository access
   limited to this repo only and a single permission, `Actions: Read and write` (GitHub adds the
   mandatory `Metadata: Read-only`). Note the expiration date (see step 8).
6. **Create the cron-job.org job** (free account) that dispatches the workflow:
   - URL: `https://api.github.com/repos/GuiNardiSS/Automation-YUL/actions/workflows/363786285/dispatches`
     (`363786285` is the numeric ID of `poll.yml`)
   - Method `POST`, body `{"ref":"master"}`
   - Headers: `Authorization: Bearer <token from step 5>`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
   - Schedule: timezone `America/Sao_Paulo`, crontab `17 8,10,12,14,16 * * *`
   - Enable email notification on failed executions.

   A successful dispatch returns HTTP 204 with no body; use the job's test run to confirm, then
   check that a new run appeared in the Actions tab.
7. **Watch your GitHub Actions usage** (`Settings → Billing → Actions`) for the first few days.
   A run takes about 8 minutes: PNCP requires one query per state × modality (plus extra pages
   for busy ones), paced 6 seconds apart because PNCP rate-limits rapid requests. Five runs a day was sized to fit
   GitHub's 2,000 free minutes/month for a private repo. To change the cadence, edit the job's
   schedule in cron-job.org (not the workflow file), keep it inside 08:00–18:00 America/Sao_Paulo
   (a run dispatched outside that window exits immediately without checking PNCP), and keep the
   workflow's `timeout-minutes` comfortably above the real run time.
8. **Renew the token before it expires.** The current token expires on 2027-09-25. Before then,
   use "Regenerate token" on the token's GitHub page and paste the new value into the job's
   `Authorization` header in cron-job.org. An expired token means dispatches are rejected and no
   run happens at all — GitHub never sees a failed run, so the only signal is cron-job.org's
   failed-execution email. Separately, the `X-GitHub-Api-Version: 2022-11-28` header has a GitHub
   sunset date of 2028-03-10 and must be moved to a supported version before then.

## Debugging the PNCP API (optional)

The PNCP response schema in `src/pncp/types.ts` has been verified against the live API. If PNCP
changes something and runs start failing, this prints raw responses for SC with and without a
modality code. Any manual request must include `codigoModalidadeContratacao` (PNCP answers
HTTP 400 without it); a query with no results returns HTTP 204 with an empty body.

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
and check the logs for the checkpoints: `pncp.request`/`pncp.response`, `filter.summary`,
`email.draft`, `email.sent`. A run fails (red in the Actions tab, and GitHub emails you) if Redis
rejects the connection at startup (e.g. a wrong password in `REDIS_URL`) or if PNCP looks down
(3 consecutive failed queries, or every query in the run failed); a day with no matching
tenders is still a green run. Individual failed PNCP
queries appear as `pncp.error` lines tagged with `uf` and `modalidade`. Locally these also land in `./logs/app-*.log`; on GitHub Actions,
each run's logs live in that run's page under the Actions tab (no persistent log file, since the
runner is discarded after each run).
