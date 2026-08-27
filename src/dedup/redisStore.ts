interface SeenStoreRedisClient {
  set(key: string, value: string, exFlag: 'EX', ttlSeconds: number, nxFlag: 'NX'): Promise<string | null>;
  del(key: string): Promise<number>;
}

export class RedisSeenStore {
  constructor(
    private readonly redis: SeenStoreRedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async markIfNew(tenderId: string): Promise<boolean> {
    const result = await this.redis.set(`pncp:seen:${tenderId}`, '1', 'EX', this.ttlSeconds, 'NX');
    return result === 'OK';
  }

  async unmarkSeen(tenderId: string): Promise<void> {
    await this.redis.del(`pncp:seen:${tenderId}`);
  }
}
