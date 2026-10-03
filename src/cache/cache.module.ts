import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Config } from '../config/configuration';
import { CACHE_STORE, REDIS_CLIENT } from './cache.constants';
import { CacheService } from './cache.service';
import {
  type CacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from './cache-store';

export function createRedisClient(config: Config['cache']): Redis | null {
  if (!config.redisUrl) return null;
  const logger = new Logger('Redis');
  const client = new Redis(config.redisUrl, {
    keyPrefix: config.keyPrefix,
    // Fail fast instead of queueing commands while Redis is down: the cache
    // then falls back to the database.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  client.on('ready', () => logger.log('Redis connected'));
  client.on('error', (err: Error) =>
    logger.warn(`Redis error: ${err.message}`),
  );
  return client;
}

/**
 * Shared cache. With REDIS_URL the store is Redis (shared by every
 * instance, also used for rate limiting); without it, an in-process store.
 * Global, so content modules (and their tests) share one instance.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Config, true>) =>
        createRedisClient(config.get('cache', { infer: true })),
    },
    {
      provide: CACHE_STORE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis | null): CacheStore =>
        redis ? new RedisCacheStore(redis) : new MemoryCacheStore(),
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class AppCacheModule implements OnApplicationShutdown {
  constructor(@Inject(CACHE_STORE) private readonly store: CacheStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close().catch(() => undefined);
  }
}
