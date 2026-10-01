/** A key-prefixed view over an existing cache (per-tenant / per-feature scoping). */
import {
  CacheInvalidConfigError,
  CacheUnsupportedOperationError,
  hasControlCharacters,
} from "./core.js";
import type { Cache, CacheKey, CacheWrite } from "./core.js";

/**
 * Share one connection between scopes: every key is stored as `${prefix}:${key}`.
 * Tags are not prefixed (they stay global), and `clear()` is refused because
 * a scoped clear cannot be done portably; `close()` is a no-op so the parent
 * cache keeps running.
 */
export function namespaced(cache: Cache, prefix: string): Cache {
  if (!prefix || hasControlCharacters(prefix))
    throw new CacheInvalidConfigError("prefix must be non-empty with no control characters.");
  const k = (key: CacheKey) => `${prefix}:${String(key)}`;
  return {
    type: cache.type,
    capabilities: cache.capabilities,
    get: (key, o) => cache.get(k(key), o),
    getEntry: (key, o) => cache.getEntry(k(key), o),
    getMany: async <V>(keys: readonly CacheKey[], o?: Parameters<Cache["getMany"]>[1]) => {
      const found = await cache.getMany<V>(keys.map(k), o);
      const result = new Map<string, V>();
      for (const key of keys) {
        const physical = k(key);
        if (found.has(physical)) result.set(String(key), found.get(physical) as V);
      }
      return result;
    },
    set: (key, value, o) => cache.set(k(key), value, o),
    setMany: (entries: readonly CacheWrite[], o) =>
      cache.setMany(
        entries.map((e) => ({ ...e, key: k(e.key) })),
        o,
      ),
    has: (key, o) => cache.has(k(key), o),
    delete: (key, o) => cache.delete(k(key), o),
    deleteMany: (keys, o) => cache.deleteMany(keys.map(k), o),
    clear: async () => {
      throw new CacheUnsupportedOperationError(
        "A namespaced view cannot clear its scope portably. Use tags or delete known keys.",
        { provider: cache.type, operation: "clear" },
      );
    },
    touch: (key, ttl, o) => cache.touch(k(key), ttl, o),
    getOrSet: (key, loader, o) => cache.getOrSet(k(key), loader, o),
    invalidateTags: (tags, o) => cache.invalidateTags(tags, o),
    withLock: (key, fn, o) => cache.withLock(k(key), fn, o),
    health: (o) => cache.health(o),
    native: () => cache.native(),
    nativeRequest: (fn) => cache.nativeRequest(fn),
    close: async () => {},
  };
}
