import cron from 'node-cron';
import type winston from 'winston';

export function isWithinBusinessHours(date: Date, timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date),
  );
  return hour >= 8 && hour < 18;
}

export function registerPollSchedule(
  cronExpression: string,
  timezone: string,
  logger: winston.Logger,
  handler: () => Promise<void>,
): void {
  cron.schedule(
    cronExpression,
    () => {
      if (!isWithinBusinessHours(new Date(), timezone)) {
        logger.info('scheduler.skipped', { reason: 'outside_business_hours' });
        return;
      }
      handler().catch((error) => {
        logger.error('cycle.failed', { error: error instanceof Error ? error.message : String(error) });
      });
    },
    { timezone },
  );
}
