import type {
  Cache, CacheCapabilities, CacheEntry, CacheHealth, CacheKey, CacheLoader,
  CacheWrite, ClearResult, DeleteResult, GetOptions, GetOrSetOptions, LockOptions,
  NativeClientFor, SetOptions, SetResult, TagInvalidationResult, Ttl,
} from './core.js';
import { createRedisCache } from './redis.js';
import type { RedisCacheOptions, RedisClient } from './redis.js';

/** Providers that expose Redis's wire protocol and can use the optional `redis` client. */
export type RedisCompatibleType = 'redis' | 'valkey' | 'dragonfly' | 'elasticache' | 'memorystore' | 'azure-redis';
export interface RedisCompatibleCacheOptions<T extends RedisCompatibleType = RedisCompatibleType> extends Omit<RedisCacheOptions, 'type'> {
  type?: T;
  /** Service/profile metadata only; it is never sent to Redis or included in errors. */
  endpointName?: string;
}

/** Keeps provider identity and native type information while sharing the Redis-protocol implementation. */
export class RedisCompatibleCache<T extends RedisCompatibleType> implements Cache<T> {
  readonly capabilities: Readonly<CacheCapabilities>;
  constructor(readonly type: T, private readonly base: Cache<'redis'>) { this.capabilities = base.capabilities; }
  get<V = unknown>(key: CacheKey, options?: GetOptions<T>): Promise<V | undefined> { return this.base.get<V>(key, options as GetOptions<'redis'>); }
  getEntry<V = unknown>(key: CacheKey, options?: GetOptions<T>): Promise<CacheEntry<V> | undefined> { return this.base.getEntry<V>(key, options as GetOptions<'redis'>); }
  getMany<V = unknown>(keys: readonly CacheKey[], options?: GetOptions<T>): Promise<Map<string, V>> { return this.base.getMany<V>(keys, options as GetOptions<'redis'>); }
  set<V>(key: CacheKey, value: V, options?: SetOptions<T>): Promise<SetResult> { return this.base.set(key, value, options as SetOptions<'redis'>); }
  setMany(entries: readonly CacheWrite<unknown, T>[], options?: SetOptions<T>): Promise<void> { return this.base.setMany(entries as readonly CacheWrite<unknown, 'redis'>[], options as SetOptions<'redis'>); }
  has(key: CacheKey, options?: GetOptions<T>): Promise<boolean> { return this.base.has(key, options as GetOptions<'redis'>); }
  delete(key: CacheKey, options?: { signal?: AbortSignal }): Promise<DeleteResult> { return this.base.delete(key, options); }
  deleteMany(keys: readonly CacheKey[], options?: { signal?: AbortSignal }): Promise<number> { return this.base.deleteMany(keys, options); }
  clear(options?: { signal?: AbortSignal }): Promise<ClearResult> { return this.base.clear(options); }
  touch(key: CacheKey, ttl: Ttl, options?: { signal?: AbortSignal }): Promise<boolean> { return this.base.touch(key, ttl, options); }
  getOrSet<V>(key: CacheKey, loader: CacheLoader<V>, options?: GetOrSetOptions<T>): Promise<V> { return this.base.getOrSet(key, loader, options as GetOrSetOptions<'redis'>); }
  invalidateTags(tags: readonly string[], options?: { signal?: AbortSignal }): Promise<TagInvalidationResult> { return this.base.invalidateTags(tags, options); }
  withLock<V>(key: CacheKey, fn: () => Promise<V> | V, options?: LockOptions): Promise<V> { return this.base.withLock(key, fn, options); }
  health(options?: { signal?: AbortSignal }): Promise<CacheHealth> { return this.base.health(options); }
  native(): NativeClientFor<T> { return this.base.native() as NativeClientFor<T>; }
  nativeRequest<V>(fn: (client: NativeClientFor<T>) => Promise<V> | V): Promise<V> { return this.base.nativeRequest((client) => fn(client as NativeClientFor<T>)); }
  close(): Promise<void> { return this.base.close(); }
}

export async function createRedisCompatibleCache<T extends RedisCompatibleType>(type: T, options: RedisCompatibleCacheOptions<T>): Promise<RedisCompatibleCache<T>> {
  const base = await createRedisCache({ ...options, type: undefined });
  return new RedisCompatibleCache(type, base);
}

export interface ValkeyCacheOptions extends RedisCompatibleCacheOptions<'valkey'> {}
export interface DragonflyCacheOptions extends RedisCompatibleCacheOptions<'dragonfly'> {}
export interface ElastiCacheOptions extends RedisCompatibleCacheOptions<'elasticache'> {}
export interface MemorystoreCacheOptions extends RedisCompatibleCacheOptions<'memorystore'> {}
export interface AzureRedisCacheOptions extends RedisCompatibleCacheOptions<'azure-redis'> { tenantId?: string; clientId?: string }
export const createValkeyCache = (options: ValkeyCacheOptions): Promise<RedisCompatibleCache<'valkey'>> => createRedisCompatibleCache('valkey', options);
export const createDragonflyCache = (options: DragonflyCacheOptions): Promise<RedisCompatibleCache<'dragonfly'>> => createRedisCompatibleCache('dragonfly', options);
export const createElastiCache = (options: ElastiCacheOptions): Promise<RedisCompatibleCache<'elasticache'>> => createRedisCompatibleCache('elasticache', options);
export const createMemorystoreCache = (options: MemorystoreCacheOptions): Promise<RedisCompatibleCache<'memorystore'>> => createRedisCompatibleCache('memorystore', options);
export const createAzureRedisCache = (options: AzureRedisCacheOptions): Promise<RedisCompatibleCache<'azure-redis'>> => createRedisCompatibleCache('azure-redis', options);

declare module './core.js' {
  interface NativeClientMap {
    valkey: RedisClient;
    dragonfly: RedisClient;
    elasticache: RedisClient;
    memorystore: RedisClient;
    'azure-redis': RedisClient;
  }
}
