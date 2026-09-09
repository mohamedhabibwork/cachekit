import {
  CacheClosedError, CacheDecodeError, CacheInvalidConfigError, CacheLockTimeoutError,
  CacheSerializationError, CacheUnsupportedOperationError, hasControlCharacters, normalizeKey, parseTtl,
  resolveCodec, throwIfAborted,
} from './core.js';
import type {
  Cache, CacheCapabilities, CacheEntry, CacheHealth, CacheKey, CacheLoader, CacheWrite,
  ClearResult, Codec, CodecInput, DeleteResult, GetOptions, GetOrSetOptions, LockOptions,
  SetOptions, SetResult, TagInvalidationResult, Ttl,
} from './core.js';

interface StoredEntry { value: Uint8Array; createdAt: number; expiresAt?: number; staleAt?: number; tags: readonly string[] }
export interface MemoryCacheOptions { namespace?: string; defaultTtl?: Ttl; codec?: CodecInput; maxEntries?: number; clock?: () => number }

/** A deterministic, encoded in-process cache intended for development, tests, and L1 tiers. */
export class MemoryCache implements Cache<'memory'> {
  readonly type = 'memory' as const;
  readonly capabilities: Readonly<CacheCapabilities> = Object.freeze({
    ttl: 'native', atomicSetIfAbsent: 'emulated', compareAndDelete: 'emulated', tags: 'native',
    getMany: 'native', clearNamespace: 'native', distributedLocks: 'unsupported',
    pubsubInvalidation: 'unsupported', persistence: 'memory',
  });
  private readonly records = new Map<string, StoredEntry>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly flights = new Map<string, Promise<unknown>>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly codec: Codec;
  private readonly defaultTtl?: number;
  private readonly clock: () => number;
  private closed = false;

  constructor(private readonly options: MemoryCacheOptions = {}) {
    if (options.maxEntries !== undefined && (!Number.isInteger(options.maxEntries) || options.maxEntries < 1)) {
      throw new CacheInvalidConfigError('maxEntries must be a positive integer.');
    }
    this.codec = resolveCodec(options.codec);
    this.defaultTtl = options.defaultTtl === undefined ? undefined : parseTtl(options.defaultTtl, 'defaultTtl');
    this.clock = options.clock ?? Date.now;
  }

  async get<V = unknown>(key: CacheKey, options?: GetOptions<'memory'>): Promise<V | undefined> {
    return (await this.getEntry<V>(key, options))?.value;
  }

  async getEntry<V = unknown>(key: CacheKey, options: GetOptions<'memory'> = {}): Promise<CacheEntry<V> | undefined> {
    this.ensureOpen(); throwIfAborted(options.signal);
    const physicalKey = this.key(key); const stored = this.records.get(physicalKey);
    if (!stored) return undefined;
    const now = this.clock();
    if (stored.staleAt !== undefined && now >= stored.staleAt) { this.remove(physicalKey, stored); return undefined; }
    const stale = stored.expiresAt !== undefined && now >= stored.expiresAt;
    if (stale && !options.allowStale) return undefined;
    try {
      const value = await this.codec.decode(stored.value.slice()) as V;
      return { value, createdAt: stored.createdAt, expiresAt: stored.expiresAt, staleAt: stored.staleAt, isStale: stale, tags: stored.tags };
    } catch (cause) { throw new CacheDecodeError(`Could not decode cache value with codec "${this.codec.name}".`, { provider: this.type, operation: 'get', cause }); }
  }

  async getMany<V = unknown>(keys: readonly CacheKey[], options?: GetOptions<'memory'>): Promise<Map<string, V>> {
    const result = new Map<string, V>();
    for (const key of keys) { const value = await this.get<V>(key, options); if (value !== undefined) result.set(String(key), value); }
    return result;
  }

  async set<V>(key: CacheKey, value: V, options: SetOptions<'memory'> = {}): Promise<SetResult> {
    this.ensureOpen(); throwIfAborted(options.signal);
    const physicalKey = this.key(key); const now = this.clock();
    const ttl = options.ttl === undefined ? this.defaultTtl : parseTtl(options.ttl);
    const staleTtl = options.staleTtl === undefined ? undefined : parseTtl(options.staleTtl, 'staleTtl');
    const tags = this.validateTags(options.tags);
    let bytes: Uint8Array;
    try { bytes = (await this.codec.encode(value)).slice(); }
    catch (cause) { throw new CacheSerializationError(`Could not encode cache value with codec "${this.codec.name}".`, { provider: this.type, operation: 'set', cause }); }
    const previous = this.records.get(physicalKey); if (previous) this.remove(physicalKey, previous);
    this.evictIfNeeded();
    const expiresAt = ttl === undefined ? undefined : now + ttl;
    const stored: StoredEntry = { value: bytes, createdAt: now, expiresAt, staleAt: staleTtl === undefined ? expiresAt : (expiresAt ?? now) + staleTtl, tags };
    this.records.set(physicalKey, stored);
    for (const tag of tags) (this.tagIndex.get(tag) ?? this.newTag(tag)).add(physicalKey);
    return { stored: true, expiresAt };
  }

  async setMany(entries: readonly CacheWrite<unknown, 'memory'>[], options?: SetOptions<'memory'>): Promise<void> { for (const entry of entries) await this.set(entry.key, entry.value, { ...options, ...entry.options }); }
  async has(key: CacheKey, options?: GetOptions<'memory'>): Promise<boolean> { return (await this.getEntry(key, options)) !== undefined; }
  async delete(key: CacheKey, options?: { signal?: AbortSignal }): Promise<DeleteResult> { this.ensureOpen(); throwIfAborted(options?.signal); const physical = this.key(key); const value = this.records.get(physical); if (!value) return { deleted: false }; this.remove(physical, value); return { deleted: true }; }
  async deleteMany(keys: readonly CacheKey[], options?: { signal?: AbortSignal }): Promise<number> { let deleted = 0; for (const key of keys) if ((await this.delete(key, options)).deleted) deleted++; return deleted; }
  async clear(options?: { signal?: AbortSignal }): Promise<ClearResult> { this.ensureOpen(); throwIfAborted(options?.signal); const deleted = this.records.size; this.records.clear(); this.tagIndex.clear(); return { deleted }; }
  async touch(key: CacheKey, ttl: Ttl, options?: { signal?: AbortSignal }): Promise<boolean> { this.ensureOpen(); throwIfAborted(options?.signal); const stored = this.records.get(this.key(key)); if (!stored) return false; const ms = parseTtl(ttl); stored.expiresAt = this.clock() + ms; stored.staleAt = stored.expiresAt; return true; }

  async getOrSet<V>(key: CacheKey, loader: CacheLoader<V>, options: GetOrSetOptions<'memory'> = {}): Promise<V> {
    const current = await this.getEntry<V>(key, { signal: options.signal, allowStale: true });
    if (current && !current.isStale) return current.value;
    const physical = this.key(key);
    const load = async (): Promise<V> => {
      const controller = new AbortController();
      const value = await loader({ signal: controller.signal });
      await this.set(key, value, options);
      return value;
    };
    const running = this.flights.get(physical) as Promise<V> | undefined;
    if (current?.isStale && options.serveStale !== false) { if (!running) void this.singleflight(physical, load); return current.value; }
    return running ?? this.singleflight(physical, load);
  }

  async invalidateTags(tags: readonly string[], options?: { signal?: AbortSignal }): Promise<TagInvalidationResult> {
    this.ensureOpen(); throwIfAborted(options?.signal); let invalidated = 0;
    for (const tag of this.validateTags(tags)) { const keys = this.tagIndex.get(tag); if (!keys) continue; for (const key of [...keys]) { const value = this.records.get(key); if (value) { this.remove(key, value); invalidated++; } } }
    return { invalidated, mode: 'delete' };
  }

  async withLock<V>(key: CacheKey, fn: () => Promise<V> | V, options: LockOptions = {}): Promise<V> {
    this.ensureOpen(); throwIfAborted(options.signal); const physical = this.key(key); const predecessor = this.locks.get(physical);
    if (predecessor) { const wait = options.wait === undefined ? undefined : parseTtl(options.wait, 'lock.wait'); await this.waitFor(predecessor, wait, options.signal); }
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); this.locks.set(physical, gate);
    try { return await fn(); } finally { release(); if (this.locks.get(physical) === gate) this.locks.delete(physical); }
  }

  async health(options?: { signal?: AbortSignal }): Promise<CacheHealth> { this.ensureOpen(); throwIfAborted(options?.signal); const start = this.clock(); return { status: 'ok', provider: this.type, latency: Math.max(0, this.clock() - start), details: { entries: this.records.size } }; }
  native(): never { throw new CacheUnsupportedOperationError('The memory provider has no native client.', { provider: this.type }); }
  async nativeRequest<V>(_fn: (client: never) => Promise<V> | V): Promise<V> { return this.native(); }
  async close(): Promise<void> { this.records.clear(); this.tagIndex.clear(); this.closed = true; }

  private key(key: CacheKey): string { return normalizeKey(key, this.options.namespace); }
  private ensureOpen(): void { if (this.closed) throw new CacheClosedError('Cache is closed.', { provider: this.type }); }
  private newTag(tag: string): Set<string> { const set = new Set<string>(); this.tagIndex.set(tag, set); return set; }
  private validateTags(tags: readonly string[] | undefined): readonly string[] { if (!tags) return []; if (tags.length > 32) throw new CacheInvalidConfigError('An entry may have at most 32 tags.'); return [...new Set(tags.map((tag) => { if (!tag || tag.length > 256 || hasControlCharacters(tag)) throw new CacheInvalidConfigError('Tags must be non-empty, at most 256 characters, and contain no control characters.'); return tag; }))]; }
  private remove(key: string, stored: StoredEntry): void { this.records.delete(key); for (const tag of stored.tags) { const keys = this.tagIndex.get(tag); keys?.delete(key); if (keys?.size === 0) this.tagIndex.delete(tag); } }
  private evictIfNeeded(): void { if (this.options.maxEntries !== undefined && this.records.size >= this.options.maxEntries) { const first = this.records.entries().next().value as [string, StoredEntry] | undefined; if (first) this.remove(first[0], first[1]); } }
  private singleflight<V>(key: string, load: () => Promise<V>): Promise<V> { const promise = load().finally(() => { if (this.flights.get(key) === promise) this.flights.delete(key); }); this.flights.set(key, promise); return promise; }
  private async waitFor(promise: Promise<void>, timeout: number | undefined, signal?: AbortSignal): Promise<void> { if (timeout === undefined) { await promise; throwIfAborted(signal); return; } await Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new CacheLockTimeoutError('Timed out waiting for cache lock.', { provider: this.type, operation: 'withLock' })), timeout))]); throwIfAborted(signal); }
}

export function createMemoryCache(options?: MemoryCacheOptions): MemoryCache { return new MemoryCache(options); }
