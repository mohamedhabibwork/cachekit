export * from "./core.js";
export { MemoryCache, createMemoryCache } from "./memory.js";
export type { MemoryCacheOptions } from "./memory.js";
export {
  createAzureRedisCache,
  createDragonflyCache,
  createElastiCache,
  createMemorystoreCache,
  createRedisCompatibleCache,
  createValkeyCache,
} from "./redis-compatible.js";
export type {
  AzureRedisCacheOptions,
  DragonflyCacheOptions,
  ElastiCacheOptions,
  MemorystoreCacheOptions,
  RedisCompatibleCacheOptions,
  RedisCompatibleType,
  ValkeyCacheOptions,
} from "./redis-compatible.js";

import { CacheInvalidConfigError } from "./core.js";
import type { Cache, CacheType } from "./core.js";
import { createMemoryCache } from "./memory.js";
import { createRedisCache } from "./redis.js";
import {
  createAzureRedisCache,
  createDragonflyCache,
  createElastiCache,
  createMemorystoreCache,
  createValkeyCache,
} from "./redis-compatible.js";

export interface CacheProvider<T extends CacheType = CacheType, Config = unknown> {
  readonly type: T;
  create(config: Config): Promise<Cache<T>> | Cache<T>;
}
export interface MemoryCacheConfig {
  type: "memory";
  namespace?: string;
  defaultTtl?: import("./core.js").Ttl;
  codec?: import("./core.js").CodecInput;
  maxEntries?: number;
}
export interface CustomCacheConfig {
  type: string;
  [key: string]: unknown;
}
export type CacheConfig = MemoryCacheConfig | CustomCacheConfig;
const providers = new Map<string, CacheProvider>();

export function defineCacheProvider<T extends CacheType, Config>(
  provider: CacheProvider<T, Config>,
): CacheProvider<T, Config> {
  if (!provider.type || typeof provider.create !== "function")
    throw new CacheInvalidConfigError("A provider needs a non-empty type and create function.");
  return provider;
}
export function registerCacheProvider<T extends CacheType, Config>(
  provider: CacheProvider<T, Config>,
): void {
  providers.set(provider.type, defineCacheProvider(provider));
}
export { createCacheManager } from "./manager.js";
export { addIfAbsent, decrement, increment, memoize, pull } from "./helpers.js";
export type { CounterOptions, MemoizeOptions } from "./helpers.js";
export { createLayeredCache } from "./layered.js";
export type { LayeredCacheOptions } from "./layered.js";
export { namespaced } from "./namespaced.js";
export { noopLogger, type KitLogger } from "./logger.js";
export type { CacheManager } from "./manager.js";

export async function createCache(config: MemoryCacheConfig): Promise<Cache<"memory">>;
export async function createCache<T extends CacheType>(
  config: { type: T } & Record<string, unknown>,
): Promise<Cache<T>>;
export async function createCache(config: any): Promise<Cache> {
  if (!config || typeof config.type !== "string" || !config.type)
    throw new CacheInvalidConfigError("config.type must be a non-empty provider type.");
  if (config.type === "memory") return createMemoryCache(config) as Cache;
  if (config.type === "redis") return createRedisCache(config) as Promise<Cache>;
  if (config.type === "valkey") return createValkeyCache(config) as Promise<Cache>;
  if (config.type === "dragonfly") return createDragonflyCache(config) as Promise<Cache>;
  if (config.type === "elasticache") return createElastiCache(config) as Promise<Cache>;
  if (config.type === "memorystore") return createMemorystoreCache(config) as Promise<Cache>;
  if (config.type === "azure-redis") return createAzureRedisCache(config) as Promise<Cache>;
  const provider = providers.get(config.type);
  if (!provider)
    throw new CacheInvalidConfigError(
      `Unknown cache provider "${config.type}". Import its entrypoint before calling createCache, or register a custom provider.`,
      { provider: config.type },
    );
  return provider.create(config) as Promise<Cache>;
}
