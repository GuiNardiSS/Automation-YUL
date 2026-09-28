# Noridoc: src/summary

Path: @/src/summary

### Overview

- Produces a once-a-day "proof of life" email to the owner (`Config.dailySummaryEmail`) summarizing every run of the day: how many runs happened, how many failed and why, how many tenders the latest successful run analyzed, and which alerts were actually delivered.
- Exists because a run that finds no new audiovisual tenders sends nothing, which looks exactly like a broken system (e.g. the cron-job.org trigger stopped firing, or its GitHub token expired and no run is created at all). The summary's *absence* after the summary hour is the signal that something is wrong.
- Split into `src/summary/daily.ts` (Redis-backed run history + send decision) and `src/summary/formatter.ts` (pure subject/text/HTML rendering), mirroring the formatter/sender split in `src/email/`.

### How it fits into the larger codebase

```
src/index.ts main()
  -> redis.ping()                      (if this fails: nothing recorded, no summary)
  -> runOnce()  -> RunResult | error   (src/pipeline.ts)
  -> finishRun({ outcome, ... })       (src/summary/daily.ts)
       -> RPUSH pncp:daily:<day>:runs
       -> at/after summary hour: SET pncp:daily:<day>:summary-sent NX
            -> formatDailySummaryEmail (src/summary/formatter.ts)
            -> sendEmail(..., [dailySummaryEmail])   (src/email/sender.ts)
  -> rethrow run error, if any (run still exits 1)
```

- `src/index.ts` is the only caller of `finishRun`. It calls it for both successful and failed runs, wraps it in a `.catch` that logs `daily_summary.failed`, and rethrows the run's own error afterwards — a summary problem never changes whether the run is green or red.
- Consumes `RunResult` from `src/pipeline.ts` (`totalFetched`, `matched`, `alertsSent`, `failedQueries`). `alertsSent` contains only matches whose alert email send succeeded; a send that failed (and was unmarked for retry) is not reported as sent.
- Reuses `sendEmail` and the per-run `createTransport` from `src/email/sender.ts`, passing an explicit recipient list so the summary goes only to `DAILY_SUMMARY_EMAIL`, never to `RECIPIENT_EMAILS`. The HTML variant reuses `escapeHtml` exported from `src/email/formatter.ts`.
- Shares the same Redis (Upstash in production) as `src/dedup/`, under a separate `pncp:daily:` key prefix. `daily.ts` depends only on a minimal `DailySummaryRedisClient` interface (`rpush`/`lrange`/`expire`/`set`/`del`), so tests pass an `ioredis-mock` instance.
- Config comes from `src/config.ts`: `dailySummaryEmail` (unset or empty string disables sending) and `dailySummaryHour` (default 16). The day and hour are computed in `Config.pollTimezone` (America/Sao_Paulo by default), not UTC.

### Core Implementation

- **State lives in Redis because each run is a fresh process.** Every run appends a JSON `RecordedRun` (`at` as a UTC ISO timestamp plus either `{ ok: true, result }` or `{ ok: false, error }`) to the list `pncp:daily:<YYYY-MM-DD>:runs`, and refreshes a 7-day TTL on it. Recording happens before any enabled/hour check, so runs are recorded even when the summary is disabled.
- **Send decision:** if `dailySummaryEmail` is set and the local hour is `>= dailySummaryHour`, the run tries `SET pncp:daily:<day>:summary-sent 1 EX <7 days> NX`. Only the run that wins the flag reads the whole list and sends; every later run that day sees the flag and does nothing. With the default schedule and hour, this is the 16:17 run, and the summary includes that run itself.
- **Send failure:** `sendEmail` logs `email.failed` and throws; `finishRun` catches it and deletes the flag so the next run of the same day can retry — the same compensation idea as alert emails being unmarked in `src/dedup/` on send failure. `finishRun` does not rethrow in this case; only Redis errors escape it (and are logged by `src/index.ts` as `daily_summary.failed`).
- **Formatter:** subject is `[PNCP] Resumo diário DD/MM — N novo(s) alerta(s)` or `... — nenhum alerta novo`. The body lists runs today and how many failed, tenders analyzed, the delivered alerts (title + link) from all successful runs, and each failure with its local `HH:MM` time and error message. Text and HTML versions carry the same content.

### Things to Know

- **"Tenders analyzed" is the last successful run's `totalFetched`, not a sum.** Every run re-fetches the whole lookback window (`PNCP_LOOKBACK_DAYS`), so summing across runs would count the same tenders several times. If no run succeeded that day, it shows `—`.
- The day key is the local date in `Config.pollTimezone`, so a run in the Sao Paulo evening (already the next day in UTC) still belongs to the correct day and cannot trigger a second summary.
- Runs that never reach `finishRun` are invisible to the summary: runs skipped by the business-hours guard (`src/scheduler.ts`), runs where the Redis `PING` fails, and dispatches that never create a run (expired cron-job.org token). A Redis outage still fails the run red as before; the other cases show up only as a missing or short summary.
- The summary hour interacts with the business-hours guard: runs only execute 08:00–18:00 local, so `loadConfig` rejects a `DAILY_SUMMARY_HOUR` outside 8–17 at startup (it would otherwise silently never send). With the default cadence, 16:17 is the last scheduled run of the day, so a flag released after a failed summary send is only retried by a later run on the same day (e.g. a manual "Run workflow" before 18:00).
- `DAILY_SUMMARY_EMAIL` treats an empty string as unset because GitHub Actions injects a missing repository secret as `""`.

Created and maintained by Nori.
