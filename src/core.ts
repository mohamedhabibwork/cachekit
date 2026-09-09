/** Shared public types and small runtime-neutral utilities. */
export type CacheType = 'memory' | 'redis' | (string & {});
export type CacheKey = string | number;
export type Ttl = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;
export type CapabilityStatus = 'native' | 'emulated' | 'unsupported';

export interface CacheCapabilities {
  ttl: CapabilityStatus;
  atomicSetIfAbsent: CapabilityStatus;
  compareAndDelete: CapabilityStatus;
  tags: CapabilityStatus;
  getMany: CapabilityStatus;
  clearNamespace: CapabilityStatus;
  distributedLocks: CapabilityStatus;
  pubsubInvalidation: CapabilityStatus;
  persistence: 'memory' | 'disk' | 'remote';
}

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt?: number;
  staleAt?: number;
  isStale: boolean;
  tags: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface CacheHealth {
  status: 'ok' | 'degraded' | 'error';
  provider: string;
  latency: number;
  details?: Readonly<Record<string, unknown>>;
}

export interface Codec<T = unknown> {
  readonly name: string;
  encode(value: T): Uint8Array | Promise<Uint8Array>;
  decode(bytes: Uint8Array): T | Promise<T>;
}

export type CodecInput = 'json' | 'text' | 'bytes' | Codec;

export interface NativeOptionsMap {}
export interface NativeClientMap {}
export type NativeOptionsFor<T extends CacheType> = T extends keyof NativeOptionsMap
  ? NativeOptionsMap[T]
  : Record<string, never>;
export type NativeClientFor<T extends CacheType> = T extends keyof NativeClientMap
  ? NativeClientMap[T]
  : unknown;

interface BaseOptions<T extends CacheType> { signal?: AbortSignal; native?: NativeOptionsFor<T> }
export interface GetOptions<T extends CacheType = CacheType> extends BaseOptions<T> { allowStale?: boolean }
export interface SetOptions<T extends CacheType = CacheType> extends BaseOptions<T> {
  ttl?: Ttl;
  staleTtl?: Ttl;
  tags?: readonly string[];
}
export interface GetOrSetOptions<T extends CacheType = CacheType> extends SetOptions<T> {
  /** Allows callers that cannot wait for a refresh to receive an in-window stale value. */
  serveStale?: boolean;
}
export interface LockOptions { wait?: Ttl; lease?: Ttl; signal?: AbortSignal }
export interface CacheWrite<V = unknown, T extends CacheType = CacheType> { key: CacheKey; value: V; options?: SetOptions<T> }
export interface SetResult { stored: boolean; expiresAt?: number }
export interface DeleteResult { deleted: boolean }
export interface ClearResult { deleted: number }
export interface TagInvalidationResult { invalidated: number; mode: 'delete' | 'versioned' | 'unsupported' }
export type CacheLoader<T> = (context: { signal: AbortSignal }) => Promise<T> | T;

export interface Cache<T extends CacheType = CacheType> {
  readonly type: T;
  readonly capabilities: Readonly<CacheCapabilities>;
  get<V = unknown>(key: CacheKey, options?: GetOptions<T>): Promise<V | undefined>;
  getEntry<V = unknown>(key: CacheKey, options?: GetOptions<T>): Promise<CacheEntry<V> | undefined>;
  getMany<V = unknown>(keys: readonly CacheKey[], options?: GetOptions<T>): Promise<Map<string, V>>;
  set<V>(key: CacheKey, value: V, options?: SetOptions<T>): Promise<SetResult>;
  setMany(entries: readonly CacheWrite<unknown, T>[], options?: SetOptions<T>): Promise<void>;
  has(key: CacheKey, options?: GetOptions<T>): Promise<boolean>;
  delete(key: CacheKey, options?: BaseOptions<T>): Promise<DeleteResult>;
  deleteMany(keys: readonly CacheKey[], options?: BaseOptions<T>): Promise<number>;
  clear(options?: BaseOptions<T>): Promise<ClearResult>;
  touch(key: CacheKey, ttl: Ttl, options?: BaseOptions<T>): Promise<boolean>;
  getOrSet<V>(key: CacheKey, loader: CacheLoader<V>, options?: GetOrSetOptions<T>): Promise<V>;
  invalidateTags(tags: readonly string[], options?: BaseOptions<T>): Promise<TagInvalidationResult>;
  withLock<V>(key: CacheKey, fn: () => Promise<V> | V, options?: LockOptions): Promise<V>;
  health(options?: { signal?: AbortSignal }): Promise<CacheHealth>;
  native(): NativeClientFor<T>;
  nativeRequest<V>(fn: (client: NativeClientFor<T>) => Promise<V> | V): Promise<V>;
  close(): Promise<void>;
}

export class CacheError extends Error {
  readonly provider?: string;
  readonly operation?: string;
  readonly retryable: boolean;
  constructor(message: string, options: { provider?: string; operation?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.provider = options.provider;
    this.operation = options.operation;
    this.retryable = options.retryable ?? false;
  }
}
export class CacheInvalidConfigError extends CacheError {}
export class CacheDependencyMissingError extends CacheError {}
export class CacheSerializationError extends CacheError {}
export class CacheDecodeError extends CacheError {}
export class CacheUnsupportedOperationError extends CacheError {}
export class CacheClosedError extends CacheError {}
export class CacheLockTimeoutError extends CacheError {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const codecs = {
  json: {
    name: 'json',
    encode(value: unknown) { return encoder.encode(JSON.stringify(value)); },
    decode(bytes: Uint8Array) { return JSON.parse(decoder.decode(bytes)); },
  } satisfies Codec,
  text: {
    name: 'text',
    encode(value: string) { return encoder.encode(value); },
    decode(bytes: Uint8Array) { return decoder.decode(bytes); },
  } satisfies Codec<string>,
  bytes: {
    name: 'bytes',
    encode(value: Uint8Array) { return value.slice(); },
    decode(bytes: Uint8Array) { return bytes.slice(); },
  } satisfies Codec<Uint8Array>,
};

export function resolveCodec(input: CodecInput | undefined): Codec {
  if (!input || input === 'json') return codecs.json;
  if (input === 'text') return codecs.text;
  if (input === 'bytes') return codecs.bytes;
  if (typeof input.encode !== 'function' || typeof input.decode !== 'function' || !input.name) {
    throw new CacheInvalidConfigError('codec must be a built-in codec name or an object with name, encode, and decode.');
  }
  return input;
}

export function parseTtl(value: Ttl, field = 'ttl'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw new CacheInvalidConfigError(`${field} must be a positive finite number of milliseconds.`);
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new CacheInvalidConfigError(`${field} must be a positive duration such as "250ms", "5m", or "1h".`);
  const amount = Number(match[1]);
  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const milliseconds = amount * units[match[2]!]!;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new CacheInvalidConfigError(`${field} is out of range.`);
  return milliseconds;
}

export function normalizeKey(key: CacheKey, namespace?: string): string {
  const raw = String(key);
  if (!raw || hasControlCharacters(raw)) throw new CacheInvalidConfigError('key must be non-empty and must not contain control characters.');
  if (raw.length > 1024) throw new CacheInvalidConfigError('key must not be longer than 1024 characters.');
  return namespace ? `${namespace}\u001f${raw}` : raw;
}

export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
