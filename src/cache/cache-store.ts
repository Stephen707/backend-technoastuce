// Minimal key/value contract shared by the Redis and in-memory stores.
// Values are JSON strings; TTLs are in milliseconds.
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  // Sets the key only if it doesn't exist; true when it was set.
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
  // Atomic counter (created at 1); never expires.
  incr(key: string): Promise<number>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

interface Entry {
  value: string;
  expiresAt: number; // Infinity for counters
}

/**
 * Per-process store for development, tests and single-instance deploys.
 * Bounded: once `maxEntries` is reached the oldest inserted key is evicted
 * (Map keeps insertion order), and expired keys are dropped on read.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.read(key)?.value ?? null);
  }

  set(key: string, value: string, ttlMs: number): Promise<void> {
    this.write(key, { value, expiresAt: this.now() + ttlMs });
    return Promise.resolve();
  }

  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.read(key)) return Promise.resolve(false);
    this.write(key, { value, expiresAt: this.now() + ttlMs });
    return Promise.resolve(true);
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  incr(key: string): Promise<number> {
    const next = Number(this.read(key)?.value ?? 0) + 1;
    this.write(key, { value: String(next), expiresAt: Infinity });
    return Promise.resolve(next);
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }

  private read(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private write(key: string, entry: Entry): void {
    this.entries.delete(key); // re-insert at the end (newest)
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, entry);
  }
}

// The subset of ioredis used here, so tests can pass a fake.
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: 'PX', ttlMs: number): Promise<unknown>;
  set(
    key: string,
    value: string,
    px: 'PX',
    ttlMs: number,
    nx: 'NX',
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

const ttlArg = (ttlMs: number) => Math.max(1, Math.round(ttlMs));

export class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: RedisLike) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, 'PX', ttlArg(ttlMs));
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlMs: number,
  ): Promise<boolean> {
    const res = await this.redis.set(key, value, 'PX', ttlArg(ttlMs), 'NX');
    return res === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === 'PONG';
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
