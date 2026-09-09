import { CacheDecodeError, CacheDependencyMissingError, CacheInvalidConfigError, CacheLockTimeoutError, CacheSerializationError, CacheUnsupportedOperationError, normalizeKey, parseTtl, resolveCodec, throwIfAborted } from './core.js';
import type { Cache, CacheCapabilities, CacheEntry, CacheHealth, CacheKey, CacheLoader, CacheWrite, ClearResult, Codec, CodecInput, DeleteResult, GetOptions, GetOrSetOptions, LockOptions, SetOptions, SetResult, TagInvalidationResult, Ttl } from './core.js';

/** Minimal cross-version surface used by CacheKit. A prebuilt node-redis client can be injected. */
export interface RedisClient {
  connect?(): Promise<void>;
  quit?(): Promise<void>;
  isOpen?: boolean;
  sendCommand(command: readonly string[]): Promise<string | null | number>;
}
export interface RedisSetOptions { NX?: boolean; XX?: boolean }
declare module './core.js' {
  interface NativeOptionsMap { redis: RedisSetOptions }
  interface NativeClientMap { redis: RedisClient }
}

interface RedisEnvelope { version: 1; value: string; createdAt: number; expiresAt?: number; staleAt?: number }
export interface RedisCacheOptions { type?: 'redis'; url?: string; client?: RedisClient; namespace?: string; defaultTtl?: Ttl; codec?: CodecInput; connect?: boolean }

/** Redis provider. It is compatible with Redis-protocol services such as ElastiCache, Memorystore, and Dragonfly. */
export class RedisCache implements Cache<'redis'> {
  readonly type = 'redis' as const;
  readonly capabilities: Readonly<CacheCapabilities> = Object.freeze({ ttl: 'native', atomicSetIfAbsent: 'native', compareAndDelete: 'native', tags: 'unsupported', getMany: 'emulated', clearNamespace: 'unsupported', distributedLocks: 'native', pubsubInvalidation: 'unsupported', persistence: 'remote' });
  private readonly codec: Codec;
  private readonly defaultTtl?: number;
  private readonly flights = new Map<string, Promise<unknown>>();
  private closed = false;
  private constructor(private readonly client: RedisClient, private readonly options: RedisCacheOptions) { this.codec = resolveCodec(options.codec); this.defaultTtl = options.defaultTtl === undefined ? undefined : parseTtl(options.defaultTtl, 'defaultTtl'); }

  static async create(options: RedisCacheOptions = {}): Promise<RedisCache> {
    if (!options.client && !options.url) throw new CacheInvalidConfigError('Redis requires either url or an injected client.', { provider: 'redis' });
    let client = options.client;
    if (!client) {
      try {
        const moduleName = 'redis'; const redis = await import(moduleName);
        client = redis.createClient({ url: options.url }) as unknown as RedisClient;
      } catch (cause) {
        throw new CacheDependencyMissingError('Redis support requires the optional dependency "redis". Install it with: npm install redis', { provider: 'redis', cause });
      }
    }
    if (options.connect !== false && !client.isOpen && client.connect) await client.connect();
    return new RedisCache(client, options);
  }

  async get<V = unknown>(key: CacheKey, options?: GetOptions<'redis'>): Promise<V | undefined> { return (await this.getEntry<V>(key, options))?.value; }
  async getEntry<V = unknown>(key: CacheKey, options: GetOptions<'redis'> = {}): Promise<CacheEntry<V> | undefined> {
    this.ensureOpen(); throwIfAborted(options.signal); const raw = await this.client.sendCommand(['GET', this.key(key)]); if (typeof raw !== 'string') return undefined;
    let envelope: RedisEnvelope;
    try { envelope = JSON.parse(raw) as RedisEnvelope; if (envelope.version !== 1 || typeof envelope.value !== 'string') throw new Error('bad envelope'); }
    catch (cause) { throw new CacheDecodeError('Redis value is not a CacheKit envelope.', { provider: this.type, operation: 'get', cause }); }
    const now = Date.now(); if (envelope.staleAt !== undefined && now >= envelope.staleAt) { await this.delete(key); return undefined; }
    const stale = envelope.expiresAt !== undefined && now >= envelope.expiresAt; if (stale && !options.allowStale) return undefined;
    try { const value = await this.codec.decode(fromBase64(envelope.value)) as V; return { value, createdAt: envelope.createdAt, expiresAt: envelope.expiresAt, staleAt: envelope.staleAt, isStale: stale, tags: [] }; }
    catch (cause) { throw new CacheDecodeError(`Could not decode cache value with codec "${this.codec.name}".`, { provider: this.type, operation: 'get', cause }); }
  }
  async getMany<V = unknown>(keys: readonly CacheKey[], options?: GetOptions<'redis'>): Promise<Map<string, V>> { const output = new Map<string, V>(); for (const key of keys) { const value = await this.get<V>(key, options); if (value !== undefined) output.set(String(key), value); } return output; }
  async set<V>(key: CacheKey, value: V, options: SetOptions<'redis'> = {}): Promise<SetResult> {
    this.ensureOpen(); throwIfAborted(options.signal); const now = Date.now(); const ttl = options.ttl === undefined ? this.defaultTtl : parseTtl(options.ttl); const stale = options.staleTtl === undefined ? undefined : parseTtl(options.staleTtl, 'staleTtl');
    let bytes: Uint8Array; try { bytes = await this.codec.encode(value); } catch (cause) { throw new CacheSerializationError(`Could not encode cache value with codec "${this.codec.name}".`, { provider: this.type, operation: 'set', cause }); }
    const expiresAt = ttl === undefined ? undefined : now + ttl; const staleAt = stale === undefined ? expiresAt : (expiresAt ?? now) + stale;
    const envelope: RedisEnvelope = { version: 1, value: toBase64(bytes), createdAt: now, expiresAt, staleAt };
    const command = ['SET', this.key(key), JSON.stringify(envelope)]; const lifetime = staleAt === undefined ? ttl : staleAt - now;
    if (lifetime !== undefined) command.push('PX', String(Math.ceil(lifetime)));
    if (options.native?.NX) command.push('NX'); else if (options.native?.XX) command.push('XX');
    const result = await this.client.sendCommand(command); if (result === null) return { stored: false, expiresAt };
    return { stored: true, expiresAt };
  }
  async setMany(entries: readonly CacheWrite<unknown, 'redis'>[], options?: SetOptions<'redis'>): Promise<void> { for (const item of entries) await this.set(item.key, item.value, { ...options, ...item.options }); }
  async has(key: CacheKey, options?: GetOptions<'redis'>): Promise<boolean> { return (await this.getEntry(key, options)) !== undefined; }
  async delete(key: CacheKey, options?: { signal?: AbortSignal }): Promise<DeleteResult> { this.ensureOpen(); throwIfAborted(options?.signal); return { deleted: Number(await this.client.sendCommand(['DEL', this.key(key)])) > 0 }; }
  async deleteMany(keys: readonly CacheKey[], options?: { signal?: AbortSignal }): Promise<number> { this.ensureOpen(); throwIfAborted(options?.signal); if (!keys.length) return 0; return Number(await this.client.sendCommand(['DEL', ...keys.map((key) => this.key(key))])); }
  async clear(): Promise<ClearResult> { throw new CacheUnsupportedOperationError('Redis cannot safely clear a namespace without a bounded scan. Delete known keys or use tags in an application index.', { provider: this.type, operation: 'clear' }); }
  async touch(key: CacheKey, ttl: Ttl, options?: { signal?: AbortSignal }): Promise<boolean> { this.ensureOpen(); throwIfAborted(options?.signal); return Number(await this.client.sendCommand(['PEXPIRE', this.key(key), String(parseTtl(ttl))])) === 1; }
  async getOrSet<V>(key: CacheKey, loader: CacheLoader<V>, options: GetOrSetOptions<'redis'> = {}): Promise<V> { const entry = await this.getEntry<V>(key, { signal: options.signal, allowStale: true }); if (entry && !entry.isStale) return entry.value; const physical = this.key(key); const run = async () => { const value = await loader({ signal: options.signal ?? new AbortController().signal }); await this.set(key, value, options); return value; }; const running = this.flights.get(physical) as Promise<V> | undefined; if (entry?.isStale && options.serveStale !== false) { if (!running) void this.singleflight(physical, run); return entry.value; } return running ?? this.singleflight(physical, run); }
  async invalidateTags(): Promise<TagInvalidationResult> { return { invalidated: 0, mode: 'unsupported' }; }
  async withLock<V>(key: CacheKey, fn: () => Promise<V> | V, options: LockOptions = {}): Promise<V> { throwIfAborted(options.signal); const token = crypto.randomUUID(); const lockKey = `${this.key(key)}\u001flock`; const lease = parseTtl(options.lease ?? '10s', 'lock.lease'); const wait = options.wait === undefined ? 0 : parseTtl(options.wait, 'lock.wait'); const deadline = Date.now() + wait; while (true) { const acquired = await this.client.sendCommand(['SET', lockKey, token, 'PX', String(lease), 'NX']); if (acquired !== null) break; if (Date.now() >= deadline) throw new CacheLockTimeoutError('Timed out acquiring Redis lock.', { provider: this.type, operation: 'withLock', retryable: true }); await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now())))); } try { return await fn(); } finally { await this.client.sendCommand(['EVAL', 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', '1', lockKey, token]); } }
  async health(options?: { signal?: AbortSignal }): Promise<CacheHealth> { this.ensureOpen(); throwIfAborted(options?.signal); const start = Date.now(); await this.client.sendCommand(['PING']); return { status: 'ok', provider: this.type, latency: Date.now() - start }; }
  native(): RedisClient { return this.client; }
  async nativeRequest<V>(fn: (client: RedisClient) => Promise<V> | V): Promise<V> { return fn(this.client); }
  async close(): Promise<void> { if (!this.closed && this.client.quit) await this.client.quit(); this.closed = true; }
  private ensureOpen(): void { if (this.closed) throw new CacheInvalidConfigError('Cache is closed.', { provider: this.type }); }
  private key(key: CacheKey): string { return normalizeKey(key, this.options.namespace); }
  private singleflight<V>(key: string, fn: () => Promise<V>): Promise<V> { const result = fn().finally(() => { if (this.flights.get(key) === result) this.flights.delete(key); }); this.flights.set(key, result); return result; }
}

export function createRedisCache(options?: RedisCacheOptions): Promise<RedisCache> { return RedisCache.create(options); }
function toBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
