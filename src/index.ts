import 'dotenv/config';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { RedisSeenStore } from './dedup/redisStore.js';
import { createTransport } from './email/sender.js';
import { createLogger } from './logger.js';
import { runOnce } from './pipeline.js';
import { registerPollSchedule } from './scheduler.js';

const config = loadConfig(process.env);
const logger = createLogger(config.logDir, config.logLevel);
const redis = new Redis(config.redisUrl);
redis.on('error', (error) => logger.error('redis.connection_error', { error: error.message }));
const seenStore = new RedisSeenStore(redis, config.redisSeenTtlSeconds);
const emailTransport = createTransport(config);

logger.info('startup', { pollCronExpression: config.pollCronExpression, pollTimezone: config.pollTimezone });

registerPollSchedule(config.pollCronExpression, config.pollTimezone, logger, () =>
  runOnce({ config, logger, seenStore, emailTransport }),
);
