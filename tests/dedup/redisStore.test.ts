import RedisMock from 'ioredis-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { RedisSeenStore } from '../../src/dedup/redisStore.js';

describe('RedisSeenStore', () => {
  let redis: RedisMock;
  let store: RedisSeenStore;

  beforeEach(() => {
    redis = new RedisMock();
    store = new RedisSeenStore(redis as any, 7776000);
  });

  it('reports a tender as new the first time it is marked', async () => {
    await expect(store.markIfNew('12345')).resolves.toBe(true);
  });

  it('reports the same tender as already seen on a second call', async () => {
    await store.markIfNew('12345');
    await expect(store.markIfNew('12345')).resolves.toBe(false);
  });

  it('treats different tender ids independently', async () => {
    await store.markIfNew('12345');
    await expect(store.markIfNew('67890')).resolves.toBe(true);
  });

  it('sets an expiry on the seen marker so state does not grow unbounded', async () => {
    await store.markIfNew('12345');
    const ttl = await redis.ttl('pncp:seen:12345');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(7776000);
  });

  it('propagates a Redis failure instead of silently treating it as not-seen', async () => {
    const failingRedis = {
      set: async () => {
        throw new Error('connection lost');
      },
    };
    const failingStore = new RedisSeenStore(failingRedis as any, 7776000);

    await expect(failingStore.markIfNew('12345')).rejects.toThrow('connection lost');
  });

  it('allows a tender to be marked as new again after unmarking it', async () => {
    await store.markIfNew('12345');
    await store.unmarkSeen('12345');
    await expect(store.markIfNew('12345')).resolves.toBe(true);
  });

  it('propagates a Redis failure from unmarking instead of silently succeeding', async () => {
    const failingRedis = {
      del: async () => {
        throw new Error('connection lost');
      },
    };
    const failingStore = new RedisSeenStore(failingRedis as any, 7776000);

    await expect(failingStore.unmarkSeen('12345')).rejects.toThrow('connection lost');
  });
});
