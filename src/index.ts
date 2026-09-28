import 'dotenv/config';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { RedisSeenStore } from './dedup/redisStore.js';
import { createTransport } from './email/sender.js';
import { createLogger } from './logger.js';
import { runOnce } from './pipeline.js';
import { isWithinBusinessHours } from './scheduler.js';
import { finishRun, type RunOutcome } from './summary/daily.js';

const REDIS_QUIT_TIMEOUT_MS = 5000;

async function closeRedis(redis: Redis): Promise<void> {
  let timeoutHandle: NodeJS.Timeout;
  const forceDisconnect = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      redis.disconnect();
      resolve();
    }, REDIS_QUIT_TIMEOUT_MS);
  });

  await Promise.race([redis.quit().then(() => {}), forceDisconnect]);
  clearTimeout(timeoutHandle!);
}

const config = loadConfig(process.env);
const logger = createLogger(config.logDir, config.logLevel);

async function main(): Promise<void> {
  // Checked before touching Redis/SMTP at all, so a run dispatched outside
  // business hours (a misconfigured external trigger or a manual run) costs
  // nothing beyond a clock check.
  if (!isWithinBusinessHours(new Date(), config.pollTimezone)) {
    logger.info('scheduler.skipped', { reason: 'outside_business_hours' });
    return;
  }

  // Bounded connect/retry settings: this now runs inside a billed-by-the-minute
  // GitHub Actions job, not an always-on process, so an unreachable Redis
  // (bad secret, Upstash outage) must fail fast rather than retrying forever
  // and burning the job's minutes budget until CI's own multi-hour timeout.
  const redis = new Redis(config.redisUrl, {
    connectTimeout: 10000,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3000)),
  });
  redis.on('error', (error) => logger.error('redis.connection_error', { error: error.message }));
  const seenStore = new RedisSeenStore(redis, config.redisSeenTtlSeconds);
  const emailTransport = createTransport(config);

  try {
    // Fails the run up front on bad credentials (e.g. WRONGPASS). Without it,
    // Redis is only touched once a match exists, so a broken REDIS_URL stays
    // invisible on days with no audiovisual tenders.
    await redis.ping();

    let outcome: RunOutcome;
    let runError: unknown;
    try {
      outcome = { ok: true, result: await runOnce({ config, logger, seenStore, emailTransport }) };
    } catch (error) {
      runError = error;
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    // Recorded even when the run failed, so the daily summary reports it. A
    // summary problem is logged and never replaces the run's own outcome.
    await finishRun({ config, logger, redis, emailTransport, now: new Date(), outcome }).catch((error) => {
      logger.error('daily_summary.failed', { error: error instanceof Error ? error.message : String(error) });
    });

    if (!outcome.ok) {
      throw runError;
    }
  } finally {
    // Deliberately not `await`ed into the same try — if runOnce() above threw
    // (the documented main failure mode, e.g. Redis unreachable), a `finally`
    // block that itself throws would silently replace that original error per
    // normal JS semantics. Logging any close failure separately keeps the
    // real root cause visible in the run's logs instead of being masked.
    await closeRedis(redis).catch((error) => {
      logger.error('redis.close_failed', { error: error instanceof Error ? error.message : String(error) });
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('cycle.failed', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
