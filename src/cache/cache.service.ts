import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Config } from '../config/configuration';
import { CACHE_STORE, CacheNamespace } from './cache.constants';
import type { CacheStore } from './cache-store';

function sortKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) return value.map(sortKeys);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => [k, sortKeys(record[k])]),
  );
}

// Stable key for a query object: same fields => same key, whatever order.
export function hashKey(value: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(sortKeys(value)))
    .digest('base64url');
}

/**
 * Read-through cache for public, anonymous data (never per-user data).
 *
 * Keys live in namespaces with a version counter: `invalidate(ns)` bumps the
 * version, so every key of the namespace is abandoned in O(1) (old entries
 * then expire on their own TTL), with no SCAN/KEYS on Redis.
 *
 * The cache fails open: if the store is down, reads go straight to the
 * loader and errors are only logged, so Redis is never a single point of
 * failure. Values go through JSON (Dates become ISO strings), exactly like
 * an HTTP response, so cached and fresh responses are identical.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtlMs: number;
  // Loads in flight, so concurrent misses on one key share a single query.
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(CACHE_STORE) private readonly store: CacheStore,
    config: ConfigService<Config, true>,
  ) {
    this.defaultTtlMs =
      config.get('cache', { infer: true }).defaultTtlSeconds * 1000;
  }

  async getOrSet<T>(
    ns: CacheNamespace,
    key: string,
    loader: () => Promise<T>,
    ttlMs = this.defaultTtlMs,
  ): Promise<T> {
    const fullKey = await this.key(ns, key);
    if (fullKey) {
      const cached = await this.safe(() => this.store.get(fullKey), null);
      if (cached !== null) return JSON.parse(cached) as T;
    }

    const shareKey = fullKey ?? `${ns}:nocache:${key}`;
    const pending = this.inflight.get(shareKey) as Promise<T> | undefined;
    if (pending) return pending;

    const load = (async () => {
      const json = JSON.stringify(await loader()) ?? 'null';
      if (fullKey) {
        await this.safe(() => this.store.set(fullKey, json, ttlMs), undefined);
      }
      return JSON.parse(json) as T;
    })();
    this.inflight.set(shareKey, load);
    try {
      return await load;
    } finally {
      this.inflight.delete(shareKey);
    }
  }

  async invalidate(ns: CacheNamespace): Promise<void> {
    await this.safe(() => this.store.incr(this.versionKey(ns)), 0);
  }

  // Atomic "first time" check (dedup); true if the key was absent. Fails
  // open (true) so a cache outage never blocks the caller.
  claim(key: string, ttlMs: number): Promise<boolean> {
    return this.safe(() => this.store.setIfAbsent(key, '1', ttlMs), true);
  }

  ping(): Promise<boolean> {
    return this.safe(() => this.store.ping(), false);
  }

  private async key(ns: CacheNamespace, key: string): Promise<string | null> {
    const version = await this.safe(
      () => this.store.get(this.versionKey(ns)),
      undefined,
    );
    // Unknown version (store down): skip the cache rather than risk writing
    // under a stale version.
    if (version === undefined) return null;
    return `${ns}:v${version ?? 0}:${key}`;
  }

  private versionKey(ns: CacheNamespace): string {
    return `${ns}:version`;
  }

  private async safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await op();
    } catch (err) {
      this.logger.warn(
        `Cache unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }
}
