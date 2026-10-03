import { ConfigService } from '@nestjs/config';
import { Config } from '../config/configuration';
import { CacheNamespace } from './cache.constants';
import { CacheService, hashKey } from './cache.service';
import {
  CacheStore,
  MemoryCacheStore,
  RedisCacheStore,
  RedisLike,
} from './cache-store';
import { RedisThrottlerStorage } from './redis-throttler.storage';

const config = {
  get: () => ({ defaultTtlSeconds: 60 }),
} as unknown as ConfigService<Config, true>;

describe('MemoryCacheStore', () => {
  it('expires values after their TTL', async () => {
    let now = 1_000;
    const store = new MemoryCacheStore(100, () => now);
    await store.set('k', 'v', 500);
    await expect(store.get('k')).resolves.toBe('v');
    now += 500;
    await expect(store.get('k')).resolves.toBeNull();
  });

  it('setIfAbsent only sets missing (or expired) keys', async () => {
    let now = 0;
    const store = new MemoryCacheStore(100, () => now);
    await expect(store.setIfAbsent('k', '1', 100)).resolves.toBe(true);
    await expect(store.setIfAbsent('k', '2', 100)).resolves.toBe(false);
    now = 100;
    await expect(store.setIfAbsent('k', '3', 100)).resolves.toBe(true);
    await expect(store.get('k')).resolves.toBe('3');
  });

  it('counts with incr, and evicts the oldest key when full', async () => {
    const store = new MemoryCacheStore(2);
    await expect(store.incr('n')).resolves.toBe(1);
    await expect(store.incr('n')).resolves.toBe(2);
    await store.set('a', '1', 1000);
    await store.set('b', '2', 1000); // evicts "n"
    expect(store.size).toBe(2);
    await expect(store.get('n')).resolves.toBeNull();
    await expect(store.get('b')).resolves.toBe('2');
  });
});

describe('RedisCacheStore', () => {
  it('maps the contract onto Redis commands', async () => {
    const calls: unknown[][] = [];
    const redis = {
      get: jest.fn().mockResolvedValue('v'),
      set: jest.fn((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(args.includes('NX') ? null : 'OK');
      }),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(3),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
    } as unknown as RedisLike;
    const store = new RedisCacheStore(redis);

    await store.set('k', 'v', 1500.4);
    await expect(store.setIfAbsent('k', 'v', 0)).resolves.toBe(false);
    expect(calls).toEqual([
      ['k', 'v', 'PX', 1500],
      ['k', 'v', 'PX', 1, 'NX'], // a TTL is never 0
    ]);
    await expect(store.incr('n')).resolves.toBe(3);
    await expect(store.ping()).resolves.toBe(true);
  });
});

describe('hashKey', () => {
  it('ignores key order and undefined fields', () => {
    expect(hashKey({ a: 1, b: [1, 2], c: undefined })).toBe(
      hashKey({ b: [1, 2], a: 1 }),
    );
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });
});

describe('CacheService', () => {
  const ns = CacheNamespace.ARTICLES;

  it('caches loader results until the namespace is invalidated', async () => {
    const cache = new CacheService(new MemoryCacheStore(), config);
    const loader = jest.fn().mockResolvedValue({ n: 1 });
    await cache.getOrSet(ns, 'k', loader);
    await cache.getOrSet(ns, 'k', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await cache.invalidate(ns);
    await cache.getOrSet(ns, 'k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
    // Other namespaces are untouched.
    const other = jest.fn().mockResolvedValue(1);
    await cache.getOrSet(CacheNamespace.VIDEOS, 'k', other);
    await cache.invalidate(ns);
    await cache.getOrSet(CacheNamespace.VIDEOS, 'k', other);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('returns the same JSON shape whether the value was cached or not', async () => {
    const cache = new CacheService(new MemoryCacheStore(), config);
    const date = new Date('2026-01-01T00:00:00Z');
    const fresh = await cache.getOrSet(ns, 'd', () =>
      Promise.resolve({ date, missing: undefined }),
    );
    const cached = await cache.getOrSet(ns, 'd', () =>
      Promise.resolve({ date: new Date(0) }),
    );
    expect(fresh).toEqual({ date: '2026-01-01T00:00:00.000Z' });
    expect(cached).toEqual(fresh);
  });

  it('shares one load between concurrent misses', async () => {
    const cache = new CacheService(new MemoryCacheStore(), config);
    let resolve!: (v: number) => void;
    const loader = jest.fn(
      () => new Promise<number>((r) => (resolve = r)),
    );
    const a = cache.getOrSet(ns, 'k', loader);
    const b = cache.getOrSet(ns, 'k', loader);
    await new Promise((r) => setImmediate(r));
    resolve(42);
    await expect(Promise.all([a, b])).resolves.toEqual([42, 42]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('fails open when the store is down', async () => {
    const down = new Error('ECONNREFUSED');
    const broken: CacheStore = {
      get: () => Promise.reject(down),
      set: () => Promise.reject(down),
      setIfAbsent: () => Promise.reject(down),
      del: () => Promise.reject(down),
      incr: () => Promise.reject(down),
      ping: () => Promise.reject(down),
      close: () => Promise.resolve(),
    };
    const cache = new CacheService(broken, config);
    jest.spyOn(cache['logger'], 'warn').mockImplementation(() => undefined);
    await expect(
      cache.getOrSet(ns, 'k', () => Promise.resolve('fresh')),
    ).resolves.toBe('fresh');
    await expect(cache.invalidate(ns)).resolves.toBeUndefined();
    await expect(cache.claim('x', 1000)).resolves.toBe(true);
    await expect(cache.ping()).resolves.toBe(false);
  });

  it('claim is true only the first time', async () => {
    const cache = new CacheService(new MemoryCacheStore(), config);
    await expect(cache.claim('seen', 1000)).resolves.toBe(true);
    await expect(cache.claim('seen', 1000)).resolves.toBe(false);
  });
});

describe('RedisThrottlerStorage', () => {
  it('converts the script result to a throttler record (seconds)', async () => {
    const evalFn = jest
      .fn()
      .mockResolvedValueOnce([3, 59_001, 0, 0])
      .mockResolvedValueOnce([6, 30_000, 1, 60_000]);
    const storage = new RedisThrottlerStorage({ eval: evalFn });

    await expect(
      storage.increment('ip', 60_000, 5, 0, 'default'),
    ).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // blockDuration 0 falls back to the window length.
    expect(evalFn).toHaveBeenLastCalledWith(
      expect.any(String),
      2,
      'throttle:default:ip',
      'throttle:default:ip:blocked',
      60_000,
      5,
      60_000,
    );
    await expect(
      storage.increment('ip', 60_000, 5, 60_000, 'default'),
    ).resolves.toMatchObject({ isBlocked: true, timeToBlockExpire: 60 });
  });
});
