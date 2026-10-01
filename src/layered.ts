/** Two-tier (L1 in-process + L2 shared) cache built on the public contract. */
import { parseTtl } from "./core.js";
import type {
  Cache,
  CacheEntry,
  CacheHealth,
  CacheKey,
  CacheLoader,
  CacheWrite,
  ClearResult,
  DeleteResult,
  GetOptions,
  GetOrSetOptions,
  LockOptions,
  SetOptions,
  SetResult,
  TagInvalidationResult,
  Ttl,
} from "./core.js";

export interface LayeredCacheOptions {
  /** Fast, usually in-process tier (e.g. a memory cache). */
  l1: Cache;
  /** Shared source-of-truth tier (e.g. Redis). Capabilities and locks come from here. */
  l2: Cache;
  /** Upper bound on how long a value lives in L1; keeps cross-process staleness bounded. */
  l1Ttl?: Ttl;
  /** Close both tiers on `close()`. Defaults to true. */
  closeLayers?: boolean;
}

type Signal = { signal?: AbortSignal };

/**
 * Read L1 then L2 (backfilling L1), write and invalidate both tiers. L1 is not
 * coherent across processes: other instances keep their L1 copy for up to
 * `l1Ttl`, so keep that short or broadcast invalidations yourself.
 */
export function createLayeredCache(options: LayeredCacheOptions): Cache {
  const { l1, l2 } = options;
  const l1Ttl = options.l1Ttl === undefined ? undefined : parseTtl(options.l1Ttl, "l1Ttl");

  const l1Options = (entry: Pick<CacheEntry<unknown>, "expiresAt" | "tags">): SetOptions => {
    const remaining = entry.expiresAt === undefined ? undefined : entry.expiresAt - Date.now();
    const candidates = [remaining, l1Ttl].filter((v): v is number => v !== undefined && v > 0);
    const ttl = candidates.length ? Math.min(...candidates) : undefined;
    return { ...(ttl === undefined ? {} : { ttl }), tags: entry.tags };
  };
  const l1SetOptions = (requestedOptions: SetOptions = {}): SetOptions => {
    if (l1Ttl === undefined) return requestedOptions;
    const requested = requestedOptions.ttl === undefined ? l1Ttl : parseTtl(requestedOptions.ttl);
    return {
      ...requestedOptions,
      native: undefined,
      staleTtl: undefined,
      ttl: Math.min(requested, l1Ttl),
    };
  };

  const getEntry = async <V>(key: CacheKey, opts?: GetOptions) => {
    const hit = await l1.getEntry<V>(key, opts);
    if (hit) return hit;
    const entry = await l2.getEntry<V>(key, opts);
    if (entry && !entry.isStale) await l1.set(key, entry.value, l1Options(entry));
    return entry;
  };

  return {
    type: l2.type,
    capabilities: l2.capabilities,
    getEntry,
    get: async <V>(key: CacheKey, opts?: GetOptions) => (await getEntry<V>(key, opts))?.value,
    getMany: async <V>(keys: readonly CacheKey[], opts?: GetOptions) => {
      const found = await l1.getMany<V>(keys, opts);
      const missing = keys.filter((key) => !found.has(String(key)));
      const entries = await Promise.all(missing.map((key) => getEntry<V>(key, opts)));
      const merged = new Map(found);
      missing.forEach((key, i) => {
        const entry = entries[i];
        if (entry) merged.set(String(key), entry.value);
      });
      return merged;
    },
    set: async <V>(key: CacheKey, value: V, opts?: SetOptions): Promise<SetResult> => {
      const result = await l2.set(key, value, opts);
      if (result.stored) await l1.set(key, value, l1SetOptions(opts));
      else await l1.delete(key);
      return result;
    },
    setMany: async (entries: readonly CacheWrite[], opts?: SetOptions) => {
      await l2.setMany(entries, opts);
      await l1.setMany(
        entries.map((e) => ({ ...e, options: l1SetOptions({ ...opts, ...e.options }) })),
      );
    },
    has: async (key: CacheKey, opts?: GetOptions) => (await getEntry(key, opts)) !== undefined,
    delete: async (key: CacheKey, opts?: Signal): Promise<DeleteResult> => {
      await l1.delete(key, opts);
      return l2.delete(key, opts);
    },
    deleteMany: async (keys: readonly CacheKey[], opts?: Signal) => {
      await l1.deleteMany(keys, opts);
      return l2.deleteMany(keys, opts);
    },
    clear: async (opts?: Signal): Promise<ClearResult> => {
      const result = await l2.clear(opts);
      await l1.clear(opts);
      return result;
    },
    touch: async (key: CacheKey, ttl: Ttl, opts?: Signal) => {
      await l1.delete(key, opts);
      return l2.touch(key, ttl, opts);
    },
    getOrSet: async <V>(key: CacheKey, loader: CacheLoader<V>, opts?: GetOrSetOptions) => {
      const hit = await l1.getEntry<V>(key, { signal: opts?.signal });
      if (hit) return hit.value;
      const value = await l2.getOrSet(key, loader, opts);
      await l1.set(key, value, l1SetOptions(opts));
      return value;
    },
    invalidateTags: async (tags: readonly string[], opts?: Signal) => {
      await l1.invalidateTags(tags, opts);
      return l2.invalidateTags(tags, opts) as Promise<TagInvalidationResult>;
    },
    withLock: <V>(key: CacheKey, fn: () => Promise<V> | V, opts?: LockOptions) =>
      l2.withLock(key, fn, opts),
    health: async (opts?: Signal): Promise<CacheHealth> => {
      const [first, second] = await Promise.all([l1.health(opts), l2.health(opts)]);
      const status =
        second.status === "error"
          ? "error"
          : first.status === "ok" && second.status === "ok"
            ? "ok"
            : "degraded";
      return {
        status,
        provider: "layered",
        latency: first.latency + second.latency,
        details: { l1: first, l2: second },
      };
    },
    native: () => l2.native(),
    nativeRequest: (fn) => l2.nativeRequest(fn),
    close: async () => {
      if (options.closeLayers === false) return;
      await Promise.all([l1.close(), l2.close()]);
    },
  };
}
