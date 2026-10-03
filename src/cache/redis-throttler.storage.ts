import type { ThrottlerStorage } from '@nestjs/throttler';

// Same shape as @nestjs/throttler's ThrottlerStorageRecord (times in s).
export interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Fixed window per key, shared by every API instance. Returns
// [hits, msUntilWindowEnds, blocked (0/1), msUntilUnblocked].
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then return {hits, ttl, 1, blockTtl} end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

export interface RedisEvalLike {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * Rate-limit counters in Redis, so limits hold across several instances
 * (the default storage is per process). Used only when REDIS_URL is set.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisEvalLike,
    private readonly prefix = 'throttle:',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    const [hits, ttlMs, blocked, blockMs] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      base,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    )) as [number, number, number, number];
    return {
      totalHits: hits,
      timeToExpire: toSeconds(ttlMs),
      isBlocked: blocked === 1,
      timeToBlockExpire: blocked === 1 ? toSeconds(blockMs) : 0,
    };
  }
}
