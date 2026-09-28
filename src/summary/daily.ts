import type winston from 'winston';
import type { Config } from '../config.js';
import { createTransport, sendEmail } from '../email/sender.js';
import type { RunResult } from '../pipeline.js';
import { formatDailySummaryEmail, type RecordedRun } from './formatter.js';

export type RunOutcome = { ok: true; result: RunResult } | { ok: false; error: string };

interface DailySummaryRedisClient {
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, exFlag: 'EX', ttlSeconds: number, nxFlag: 'NX'): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface FinishRunDeps {
  config: Config;
  logger: winston.Logger;
  redis: DailySummaryRedisClient;
  emailTransport: ReturnType<typeof createTransport>;
  now: Date;
  outcome: RunOutcome;
}

const RETENTION_SECONDS = 7 * 24 * 60 * 60;

function localDayAndHour(date: Date, timezone: string): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Each run is a fresh process, so the day's history lives in Redis: every run
// appends its outcome, and the first run at or after the summary hour sends
// the day's summary. A SET NX flag keeps later runs that day from resending.
export async function finishRun(deps: FinishRunDeps): Promise<void> {
  const { config, logger, redis, now, outcome } = deps;
  const { day, hour } = localDayAndHour(now, config.pollTimezone);
  const runsKey = `pncp:daily:${day}:runs`;

  const record: RecordedRun = { at: now.toISOString(), ...outcome };
  await redis.rpush(runsKey, JSON.stringify(record));
  await redis.expire(runsKey, RETENTION_SECONDS);

  if (!config.dailySummaryEmail || hour < config.dailySummaryHour) {
    return;
  }

  const sentFlagKey = `pncp:daily:${day}:summary-sent`;
  if ((await redis.set(sentFlagKey, '1', 'EX', RETENTION_SECONDS, 'NX')) !== 'OK') {
    return;
  }

  try {
    const runs = (await redis.lrange(runsKey, 0, -1)).map((raw) => JSON.parse(raw) as RecordedRun);
    const content = formatDailySummaryEmail(day, runs, config.pollTimezone);
    await sendEmail(deps.emailTransport, config, content, logger, { kind: 'daily_summary', day }, [config.dailySummaryEmail]);
  } catch (error) {
    // Release the flag so a later run today can retry, mirroring how alert
    // emails are unmarked on send failure; covers read/format errors too, so
    // the flag never stays claimed without a summary having gone out.
    await redis.del(sentFlagKey);
    logger.error('daily_summary.failed', { day, error: error instanceof Error ? error.message : String(error) });
  }
}
