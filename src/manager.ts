import type { Cache, CacheHealth } from "./core.js";
import { CacheInvalidConfigError } from "./core.js";
import { createCache, type CacheConfig } from "./index.js";
import { noopLogger, toError, type KitLogger } from "./logger.js";

/**
 * Multi-cache manager for applications using several caches (an L1 session
 * store, a catalog cache, a rate-limit counter, ...). Caches are created
 * lazily from their config on first use, health-checked individually, and
 * closed together.
 *
 * ```ts
 * const caches = createCacheManager({
 *   default: "catalog",
 *   caches: {
 *     catalog: { type: "memory", namespace: "catalog:v1", defaultTtl: "5m" },
 *     sessions: { type: "redis", url: process.env.REDIS_URL, defaultTtl: "1d" },
 *   },
 * });
 *
 * const catalog = await caches.cache("catalog");
 * await caches.close(); // closes only the caches that were created
 * ```
 */
export interface CacheManager<TCaches extends Record<string, CacheConfig>> {
  /** Get (and lazily create) a named cache. */
  cache<TKey extends keyof TCaches & string>(name: TKey): Promise<Cache<TCaches[TKey]["type"]>>;
  /** The default cache. */
  default(): Promise<Cache<TCaches[keyof TCaches & string]["type"]>>;
  /** Names of the configured caches. */
  cacheNames(): Array<keyof TCaches & string>;
  /** The default cache name. */
  defaultName(): keyof TCaches & string;
  /** Create every configured cache up front. */
  warmup(): Promise<void>;
  /** Health of every configured cache, by name. */
  health(): Promise<{ [TKey in keyof TCaches & string]: CacheHealth }>;
  /** Close every created cache and forget the instances. */
  close(): Promise<void>;
}

export function createCacheManager<const TCaches extends Record<string, CacheConfig>>(options: {
  caches: TCaches;
  default: keyof TCaches & string;
  /** Optional logger (e.g. a loggerkit `Logger`) for lifecycle events. */
  logger?: KitLogger;
}): CacheManager<TCaches> {
  if (!options || !options.caches || typeof options.caches !== "object") {
    throw new CacheInvalidConfigError("createCacheManager requires a `caches` map.");
  }
  if (!(options.default in options.caches)) {
    throw new CacheInvalidConfigError(
      `Default cache "${String(options.default)}" is not present in the caches map.`,
    );
  }

  const logger = options.logger ?? noopLogger;
  const instances = new Map<string, Promise<Cache>>();

  const get = (name: keyof TCaches & string): Promise<Cache> => {
    const existing = instances.get(name);
    if (existing) return existing;
    const config = options.caches[name];
    if (!config) {
      return Promise.reject(
        new CacheInvalidConfigError(
          `Unknown cache "${String(name)}". Configured caches: ${Object.keys(options.caches).join(", ")}.`,
        ),
      );
    }
    // createCache validates synchronously, so defer to keep every failure a
    // rejection; a failed creation is evicted so the next call retries.
    const promise = Promise.resolve()
      .then(
        () => createCache(config as { type: string } & Record<string, unknown>) as Promise<Cache>,
      )
      .then((cache) => {
        logger.debug("cachekit: cache created", { cache: name, type: config.type });
        return cache;
      })
      .catch((error: unknown) => {
        instances.delete(name);
        logger.error(`cachekit: failed to create cache "${name}"`, toError(error));
        throw error;
      });
    instances.set(name, promise);
    return promise;
  };

  return {
    cache: get as CacheManager<TCaches>["cache"],
    default: () => get(options.default) as ReturnType<CacheManager<TCaches>["default"]>,
    cacheNames: () => Object.keys(options.caches) as Array<keyof TCaches & string>,
    defaultName: () => options.default,
    warmup: async () => {
      await Promise.all((Object.keys(options.caches) as Array<keyof TCaches & string>).map(get));
    },
    health: async () => {
      const names = Object.keys(options.caches) as Array<keyof TCaches & string>;
      const entries = await Promise.all(
        names.map(async (name) => {
          const startedAt = Date.now();
          try {
            return [name, await (await get(name)).health()] as const;
          } catch (cause) {
            return [
              name,
              {
                status: "error",
                provider: String((options.caches[name] as { type?: string })?.type ?? name),
                latency: Date.now() - startedAt,
                details: { error: cause instanceof Error ? cause.message : String(cause) },
              },
            ] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as { [TKey in keyof TCaches & string]: CacheHealth };
    },
    close: async () => {
      await Promise.all([...instances.values()].map(async (instance) => (await instance).close()));
      instances.clear();
      logger.debug("cachekit: manager closed");
    },
  };
}
