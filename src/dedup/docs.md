# Noridoc: src/dedup

Path: @/src/dedup

### Overview

- A single class, `RedisSeenStore`, that answers "have we already emailed about this tender ID?" using Redis as the source of truth.
- Exists to prevent re-alerting on the same tender across poll runs, since PNCP's date-range query (`Config.pncpLookbackDays`) will naturally re-return recently published tenders on every poll.

### How it fits into the larger codebase

- Constructed once in `src/index.ts` (wrapping an `ioredis` client built from `Config.redisUrl`) and passed into `src/pipeline.ts` as `PipelineDeps.seenStore`.
- Called from `src/pipeline.ts`'s `selectNewMatches`, once per filtered `TenderMatch`, after `src/filters/` has narrowed the candidate list and before `src/email/` sends anything.
- Redis itself runs as a separate local process (see `docker-compose.yml`); this folder only depends on the minimal `set(...)` interface it needs (`SeenStoreRedisClient`), not the full `ioredis` API surface.

### Core Implementation

- `markIfNew(tenderId)` issues an atomic `SET pncp:seen:{tenderId} 1 EX {ttlSeconds} NX` and returns `true` only if Redis reports `OK` (meaning this call created the key — the tender is new) and `false` if the key already existed.
- The TTL (`Config.redisSeenTtlSeconds`, default 90 days / 7,776,000 seconds) means "seen" state expires on its own; there is no manual cleanup process.

### Things to Know

- **Redis errors are meant to fail loudly, not be swallowed.** If `markIfNew` can't reach Redis, the underlying `ioredis` call rejects and that rejection is not caught anywhere in `src/dedup/` or `src/pipeline.ts` — it propagates up into `src/index.ts`'s top-level `catch`, which logs `cycle.failed`, exits with code 1, and lets that run's emails be skipped entirely. This is intentional: silently treating tenders as "new" on Redis failure risks duplicate/missed dedup, so the safer failure mode is to abort and let the next scheduled GitHub Actions run (roughly 10 minutes later, see `.github/workflows/poll.yml`) retry.
- Dedup is committed *before* email delivery is confirmed: `src/pipeline.ts`'s `selectNewMatches` marks a tender as seen the moment `markIfNew` returns `true`, which happens before `src/email/sender.ts` has actually attempted to send anything. To avoid silently losing a tender if the send later fails, `unmarkSeen(tenderId)` deletes that key again; `src/pipeline.ts`'s `dispatchEmails` calls it on any send failure so the tender is treated as new again on the next run, at the cost of a possible duplicate email if the send actually succeeded despite throwing (e.g. a slow/ambiguous SMTP response) — an acceptable trade against losing the alert entirely.
- The `SeenStoreRedisClient` interface intentionally only declares the exact `set(...)`/`del(...)` signatures used, decoupling this module from `ioredis`'s full type surface and making it trivial to fake in tests (`tests/dedup/redisStore.test.ts`) without a real Redis connection.

Created and maintained by Nori.
