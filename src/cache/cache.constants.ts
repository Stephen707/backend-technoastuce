export const CACHE_STORE = Symbol('CACHE_STORE');
// The raw ioredis client, or null when running without Redis.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// Cache namespaces, each invalidated as a whole when its content changes.
export const CacheNamespace = {
  ARTICLES: 'articles',
  VIDEOS: 'videos',
  ANALYTICS: 'analytics',
} as const;
export type CacheNamespace =
  (typeof CacheNamespace)[keyof typeof CacheNamespace];
