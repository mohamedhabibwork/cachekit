/** Provider-agnostic helpers built only on the public `Cache` contract. */
import { CacheInvalidConfigError } from "./core.js";
import type { Cache, CacheKey, LockOptions, SetOptions, Ttl } from "./core.js";

export interface CounterOptions {
  /** Step to add; defaults to 1. Must be a finite number. */
  by?: number;
  /** TTL applied only when the counter is created (fixed window). */
  ttl?: Ttl;
  /** Lock options used to serialise the read-modify-write. */
  lock?: LockOptions;
  /** Clock used to compute the remaining window; must match the provider clock. */
  clock?: () => number;
}

/**
 * Atomically (per the provider's `withLock` scope) add `by` to a numeric
 * value, starting from 0. The TTL is set when the counter is first created and
 * is not extended by later increments, which makes it a fixed-window counter.
 */
export async function increment(
  cache: Cache,
  key: CacheKey,
  options: CounterOptions = {},
): Promise<number> {
  const by = options.by ?? 1;
  if (!Number.isFinite(by)) throw new CacheInvalidConfigError("by must be a finite number.");
  return cache.withLock(
    `counter:${String(key)}`,
    async () => {
      const entry = await cache.getEntry<unknown>(key);
      if (entry !== undefined && typeof entry.value !== "number")
        throw new CacheInvalidConfigError(`Cache value at "${String(key)}" is not a number.`);
      const next = ((entry?.value as number | undefined) ?? 0) + by;
      const now = (options.clock ?? Date.now)();
      const remaining =
        entry?.expiresAt === undefined ? undefined : Math.max(1, entry.expiresAt - now);
      const ttl = entry ? remaining : options.ttl;
      await cache.set(key, next, {
        ...(ttl === undefined ? {} : { ttl }),
        ...(entry?.tags.length ? { tags: entry.tags } : {}),
      });
      return next;
    },
    options.lock,
  );
}

/** `increment` with a negated step. */
export function decrement(
  cache: Cache,
  key: CacheKey,
  options: CounterOptions = {},
): Promise<number> {
  return increment(cache, key, { ...options, by: -(options.by ?? 1) });
}

/** Store `value` only if `key` has no fresh entry. Returns whether it was stored. */
export async function addIfAbsent<V>(
  cache: Cache,
  key: CacheKey,
  value: V,
  options: SetOptions & { lock?: LockOptions } = {},
): Promise<boolean> {
  const { lock, ...setOptions } = options;
  return cache.withLock(
    `add:${String(key)}`,
    async () => {
      if (await cache.has(key)) return false;
      await cache.set(key, value, setOptions);
      return true;
    },
    lock,
  );
}

/** Read a value and delete it (one-time tokens, flash messages). */
export async function pull<V = unknown>(cache: Cache, key: CacheKey): Promise<V | undefined> {
  const value = await cache.get<V>(key);
  if (value !== undefined) await cache.delete(key);
  return value;
}

export interface MemoizeOptions<A extends unknown[]> extends Omit<SetOptions, "tags"> {
  /** Builds the cache key from the call arguments. */
  key: (...args: A) => CacheKey;
  /** Optional tags derived from the call arguments. */
  tags?: (...args: A) => readonly string[];
  serveStale?: boolean;
}

/** Wrap an async function so results are cached via `getOrSet` (with stampede protection). */
export function memoize<A extends unknown[], R>(
  cache: Cache,
  fn: (...args: A) => Promise<R> | R,
  options: MemoizeOptions<A>,
): (...args: A) => Promise<R> {
  if (typeof options?.key !== "function")
    throw new CacheInvalidConfigError("memoize requires a key(...args) function.");
  const { key, tags, ...rest } = options;
  return (...args: A) =>
    cache.getOrSet(key(...args), () => fn(...args), {
      ...rest,
      ...(tags ? { tags: tags(...args) } : {}),
    });
}
