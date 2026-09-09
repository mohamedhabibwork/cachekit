# CacheKit Architecture Plan

> A provider-first, runtime-portable TypeScript cache package for Node.js, Bun, and Deno—modelled after StorageKit’s design rule: common cache operations share one API; provider-specific behaviour stays available through strongly typed `native` options and native clients.

## 1. Goals and design rules

`@mohamedhabibwork/cachekit` provides a consistent cache API without reducing Redis, Momento, SQLite, and other backends to an artificial lowest-common-denominator.

- **Portable core:** `get`, `set`, `delete`, `has`, `getOrSet`, `clear`, TTL, tags, serialization, locking, and health have stable semantics.
- **Provider-native power:** each operation accepts `native`, whose type is selected by the configured provider. Native options are merged last and can override equivalent normalized defaults.
- **Optional dependencies:** the core never imports a provider SDK. Provider entrypoints declare optional peer dependencies and emit a clear `CacheInvalidConfigError` with the package-install command if the dependency is missing.
- **Capabilities over assumptions:** drivers disclose what they can actually do. Higher-level features can use a native implementation, compose one safely, or fail explicitly.
- **Runtime portability:** runtime-neutral APIs use Web Platform primitives (`Uint8Array`, `ReadableStream`, `AbortSignal`, `crypto`); Node-only capabilities are isolated behind entrypoints.
- **No hidden data policy:** cache key normalization, prefixing, codec, tag strategy, stale policy, and lock safety are explicit configuration.

## 2. Scope and support matrix

| Runtime | Support | Notes |
| --- | --- | --- |
| Node.js 20+ | Full | Primary target; CI on current LTS releases. |
| Bun 1.1+ | Full | Native npm compatibility; runtime smoke tests. |
| Deno 2+ | Full | npm compatibility; avoid unguarded Node built-ins in core. |
| TypeScript 5.9, 6.x, 7.x | Supported | Declaration/type-test matrix for all three compiler lines. |
| Browsers | Not a core target | Some HTTP-capable providers may work through a future browser entrypoint, but credentials and embedded drivers are server concerns. |

## 3. Provider catalogue

| Family | Provider types | Entrypoint | Suggested optional peer dependency |
| --- | --- | --- | --- |
| Distributed | `redis` | `cachekit/redis` | `redis` |
| Distributed | `valkey` | `cachekit/valkey` | `@valkey/valkey-glide` or compatible selected client |
| Distributed | `memcached` | `cachekit/memcached` | `memjs` (portable) or a documented Node-only alternative |
| Distributed | `dragonfly` | `cachekit/dragonfly` | `redis` (Redis protocol) |
| AWS managed | `elasticache` | `cachekit/elasticache` | `redis` or `memjs`; uses the selected ElastiCache engine and endpoint |
| GCP managed | `memorystore` | `cachekit/memorystore` | `redis` or `memjs`; uses the selected Memorystore engine and endpoint |
| Azure managed | `azure-redis` | `cachekit/azure-redis` | `redis`; supports TLS, Entra token integration where supported by the client |
| Serverless managed | `momento` | `cachekit/momento` | `@gomomento/sdk` |
| Embedded/file | `sqlite` | `cachekit/sqlite` | adapter-specific SQLite package; Node/Bun/Deno variants are documented separately |
| Embedded/file | `rocksdb` | `cachekit/rocksdb` | implementation-specific optional binding; Node-focused |
| Embedded/file | `leveldb` | `cachekit/leveldb` | `classic-level` / compatible LevelDB implementation |
| Embedded/file | `lmdb` | `cachekit/lmdb` | `lmdb`; Node/Bun support according to upstream bindings |
| Development/test | `memory` | `cachekit/memory` | none |
| Extensibility | `custom` | `cachekit` | supplied by the application |

Managed services are connection profiles rather than a false separate protocol: ElastiCache, Memorystore, Azure Cache for Redis, Dragonfly, and Valkey retain the semantics of their actual engine. The dedicated entrypoints provide validation, secure defaults, discovery hooks where applicable, and provider-specific configuration types.

## 4. Package layout

```text
@mohamedhabibwork/cachekit
├── index.ts                    # core types, factory, errors, manager
├── core/                       # keying, codecs, policies, capabilities
├── providers/
│   ├── memory/                 # deterministic test/development driver
│   ├── redis/ valkey/ memcached/ dragonfly/
│   ├── elasticache/ memorystore/ azure-redis/ momento/
│   └── sqlite/ rocksdb/ leveldb/ lmdb/
├── middleware/                 # metrics, tracing, logging, namespaces
├── strategies/                 # tiered cache, locks, SWR, stampede control
├── testing/                    # contract suite, fake clock, test helpers
└── adapters/                   # framework integrations kept optional
```

Published entrypoints: `cachekit`, `cachekit/redis`, `cachekit/valkey`, `cachekit/memcached`, `cachekit/dragonfly`, `cachekit/elasticache`, `cachekit/memorystore`, `cachekit/azure-redis`, `cachekit/momento`, `cachekit/sqlite`, `cachekit/rocksdb`, `cachekit/leveldb`, `cachekit/lmdb`, `cachekit/memory`, `cachekit/testing`, and `cachekit/middleware/*`.

The package ships dual ESM/CJS where the runtime and provider binding permit it; Deno receives ESM-compatible exports. Conditional exports ensure loading `cachekit` does not load native bindings or cloud SDKs.

## 5. Public API

```ts
import { createCache } from '@mohamedhabibwork/cachekit';

const cache = await createCache({
  type: 'redis',
  url: process.env.REDIS_URL,
  namespace: 'catalog:v1',
  codec: 'json',
  defaultTtl: '10m',
});

await cache.set('product:42', { id: 42, name: 'Keyboard' }, {
  ttl: '5m',
  tags: ['products', 'product:42'],
  // Autocompleted as Redis SET options—not accepted by other drivers.
  native: { NX: true },
});

const product = await cache.get<Product>('product:42');
const fresh = await cache.getOrSet('product:42', loadProduct, {
  ttl: '5m',
  staleTtl: '30s',
  tags: ['products', 'product:42'],
  lock: { wait: '2s', lease: '10s' },
});
```

### Core contracts

```ts
export interface Cache<TType extends CacheType = CacheType> {
  readonly type: TType;
  readonly capabilities: CacheCapabilities;

  get<T = unknown>(key: CacheKey, options?: GetOptions<TType>): Promise<T | undefined>;
  getEntry<T = unknown>(key: CacheKey, options?: GetOptions<TType>): Promise<CacheEntry<T> | undefined>;
  getMany<T = unknown>(keys: readonly CacheKey[], options?: GetOptions<TType>): Promise<Map<string, T>>;
  set<T>(key: CacheKey, value: T, options?: SetOptions<TType>): Promise<SetResult>;
  setMany(entries: readonly CacheWrite[], options?: SetManyOptions<TType>): Promise<SetManyResult>;
  has(key: CacheKey, options?: HasOptions<TType>): Promise<boolean>;
  delete(key: CacheKey, options?: DeleteOptions<TType>): Promise<DeleteResult>;
  deleteMany(keys: readonly CacheKey[], options?: DeleteManyOptions<TType>): Promise<DeleteManyResult>;
  clear(options?: ClearOptions<TType>): Promise<ClearResult>;
  touch(key: CacheKey, ttl: Ttl, options?: TouchOptions<TType>): Promise<boolean>;
  getOrSet<T>(key: CacheKey, loader: CacheLoader<T>, options?: GetOrSetOptions<TType>): Promise<T>;
  invalidateTags(tags: readonly string[], options?: TagInvalidationOptions<TType>): Promise<TagInvalidationResult>;
  withLock<T>(key: CacheKey, fn: () => Promise<T>, options?: LockOptions<TType>): Promise<T>;
  health(options?: HealthOptions<TType>): Promise<CacheHealth>;
  native(): NativeClientFor<TType>;
  nativeRequest<T>(fn: (client: NativeClientFor<TType>) => Promise<T> | T): Promise<T>;
  close(): Promise<void>;
}
```

`CacheEntry<T>` includes `value`, `createdAt`, `expiresAt`, `staleAt`, `isStale`, `tags`, and provider metadata. `undefined` is always a miss; caching `null` is supported. `Ttl` accepts a positive millisecond number or ergonomic duration strings such as `'250ms'`, `'5m'`, and `'1h'`.

### Strong native typing

```ts
type SetOptions<T extends CacheType> = CommonSetOptions & {
  native?: NativeSetOptionsFor<T>;
};

// Redis: SetOptions<'redis'>['native'] is the package's typed Redis SET options.
// Momento: SetOptions<'momento'>['native'] exposes Momento TTL/collection options.
// SQLite: SetOptions<'sqlite'>['native'] exposes transaction/busy-timeout options.
```

The factory discriminates on `type`; therefore `createCache({ type: 'momento', ... })` returns `Cache<'momento'>`. A `native` value for an unrelated provider fails at compile time. `native` is deliberately an escape hatch, not a dumping ground: normalized fields remain documented with their cross-provider guarantees.

## 6. Configuration and factory

```ts
const cache = await createCache({
  type: 'momento',
  authToken: process.env.MOMENTO_AUTH_TOKEN!,
  cacheName: 'catalog',
  defaultTtl: '10m',
  requestTimeout: '750ms',
});

const local = await createCache({
  type: 'sqlite',
  filename: './var/cache.sqlite',
  table: 'cache_entries',
  wal: true,
  codec: { type: 'json', schema: ProductSchema },
});
```

All config errors are normalized to `CacheInvalidConfigError` and identify the invalid field, provider, and missing optional dependency. Secrets are redacted from errors, logs, traces, and `diagnostics()` output. Drivers may accept an injected prebuilt `client` for dependency injection and testability.

## 7. Data model, serialization, and key safety

Every driver stores a versioned envelope when it needs metadata beyond the provider’s native value model:

```ts
interface CacheEnvelope {
  version: 1;
  value: Uint8Array;
  codec: string;
  createdAt: number;
  expiresAt?: number;
  staleAt?: number;
  tags?: string[];
}
```

- Built-in codecs: `json` (default), `text`, `bytes`, and `structured-clone` where runtime support permits.
- Custom codecs implement `{ name, encode(value), decode(bytes) }`; schema-aware codecs validate on read and report `CacheDecodeError` without silently returning corrupt data.
- `namespace` is prepended with an unambiguous separator. Key length and unsafe control characters are validated according to driver limits.
- Serialization errors never write a partial entry. Values are copied before asynchronous persistence to avoid mutable-reference surprises in memory caches.
- Codec/envelope versions allow safe migrations using read-old/write-new policy middleware.

## 8. TTL, stale-while-revalidate, and stampede protection

`ttl` defines fresh lifetime. `staleTtl` opens a bounded stale window after fresh expiry; outside that window the item is a miss.

```ts
await cache.getOrSet('home:summary', renderSummary, {
  ttl: '30s',
  staleTtl: '2m',
  jitter: 0.1,
  lock: { wait: '500ms', lease: '15s', onTimeout: 'serve-stale' },
});
```

The algorithm is: return fresh → one caller obtains a lease and refreshes → concurrent callers may receive stale data during its permitted window → callers outside the stale window wait, retry, or fail according to explicit policy. In-process singleflight deduplicates local concurrent loads even when a provider lacks distributed locking. TTL jitter reduces synchronized expiry spikes.

Locks require an atomic compare-and-delete release token. Redis/Valkey/Dragonfly use native atomic primitives; Memcached uses its safe available subset with documented limitations; embedded stores use transactional locks. Drivers that cannot offer safe distributed leases declare `locks: 'unsupported'`; `withLock` then throws `CacheUnsupportedOperationError` unless the caller selects in-process scope.

## 9. Tag invalidation

Tags are an optional, capability-gated secondary index. An entry can belong to multiple tags, and invalidation is idempotent.

```ts
await cache.set('product:42', product, { tags: ['products', 'product:42'] });
await cache.invalidateTags(['products']);
```

Tag implementation is selected per driver:

- Redis-compatible stores use transaction/Lua or functions to atomically update tag sets and entries, with bounded fan-out and cleanup.
- SQLite, RocksDB/LevelDB, and LMDB use transactional or batch-written tag indexes.
- Momento and Memcached may use a **tag-version strategy**: reads include each tag’s generation in the derived physical key; invalidation increments generations. This avoids key scans but makes old values expire naturally by TTL.

The API reports whether invalidation is immediate deletion, versioned invalidation, partial, or unsupported. Tags should be bounded in number and size; wildcard scan/delete is excluded from the safe core API.

## 10. Multi-tier cache

```ts
import { createTieredCache } from '@mohamedhabibwork/cachekit';

const cache = await createTieredCache({
  tiers: [
    { name: 'l1', cache: { type: 'memory', maxEntries: 5_000 }, maxTtl: '30s' },
    { name: 'l2', cache: { type: 'redis', url: process.env.REDIS_URL! } },
  ],
  write: 'through',       // or 'back' with durable queue integration
  promoteOnRead: true,
  coherence: 'best-effort',
});
```

The tiered driver checks L1 then L2, promotes valid L2 results, and writes/invalidate tiers in a deterministic order. It does not promise distributed coherence it cannot guarantee; optional invalidation buses (Redis Pub/Sub, Momento topics, or app-provided broadcaster) coordinate L1 eviction across processes. Write-back is opt-in and requires a durable outbox/queue adapter; otherwise write-through is the safe default.

## 11. Manager, namespaces, and routing

```ts
import { createCacheManager } from '@mohamedhabibwork/cachekit';

const caches = await createCacheManager({
  default: 'application',
  caches: {
    application: { type: 'redis', url: process.env.REDIS_URL! },
    sessions: { type: 'momento', authToken: process.env.MOMENTO_AUTH_TOKEN!, cacheName: 'sessions' },
    local: { type: 'sqlite', filename: './var/cache.sqlite' },
  },
});

await caches.cache('application').set('settings', settings, { ttl: '1h' });
```

`cache(name)` preserves its exact provider type for statically declared managers. Manager middleware may route by key prefix, tenant, workload class, or read/write policy; fallback is explicit and only activated for configured retryable error classes. Failure policies must never turn authentication/configuration errors into silent cache misses.

## 12. Middleware and integrations

Middleware is framework-agnostic and composes around operations:

```ts
const cache = withMiddleware(base, [
  metrics({ meter }),
  tracing({ tracer, includeKey: false }),
  logging({ logger, redactKeys: true }),
  keyNamespace(({ tenantId }) => `tenant:${tenantId}`),
]);
```

Built-ins include namespace/key policy, metrics, OpenTelemetry tracing, structured logging, request-scoped cache, retry/circuit breaker, codec migration, and cache-control helpers. Framework adapters (Express, Fastify, Hono, NestJS, Next.js) remain separate optional entrypoints and must not force framework dependencies into the core package.

## 13. Capabilities, health, and observability

```ts
interface CacheCapabilities {
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
```

`CapabilityStatus` is `'native' | 'emulated' | 'unsupported'`. `health()` returns status, latency, provider name, safe endpoint metadata, and optional capacity diagnostics; it never exposes credentials or cached values. Metrics include hit/miss/stale-hit rate, operation latency, serialization failures, lock contention, loader duration, invalidation count, tier source, and provider errors. Trace spans include cache system, operation, provider, namespace hash, outcome, and a key hash—not raw keys by default.

## 14. Custom provider API

```ts
import { defineCacheProvider, registerCacheProvider } from '@mohamedhabibwork/cachekit';

const acme = defineCacheProvider({
  type: 'acme-cache',
  validate(config) { /* return validated config */ },
  async create(config, context) {
    return {
      type: 'acme-cache',
      capabilities: { /* truthful capability map */ },
      get: async (key, options) => { /* ... */ },
      set: async (key, value, options) => { /* ... */ },
      delete: async (key) => { /* ... */ },
      health: async () => ({ status: 'ok' }),
      native: () => client,
      close: async () => client.close(),
    };
  },
});

registerCacheProvider(acme);
```

Custom providers receive normalized encoded entries and a driver context containing clock, key encoder, logger, abort handling, and error constructors. A provider may implement the minimal key-value contract then declare unsupported capabilities, or implement optional extensions for batch, tags, locking, and invalidation buses. `cachekit/testing` exports a reusable contract suite so providers can prove TTL, codec, error, abort, cleanup, and concurrency semantics.

## 15. Error model

All public errors extend `CacheError` and carry `provider`, `operation`, retryability, and safe metadata:

- `CacheInvalidConfigError`
- `CacheDependencyMissingError`
- `CacheConnectionError`
- `CacheTimeoutError`
- `CacheSerializationError` / `CacheDecodeError`
- `CacheLockTimeoutError`
- `CacheUnsupportedOperationError`
- `CacheTagInvalidationError`
- `CacheClosedError`

Provider SDK errors are preserved as `cause` but normalized so applications can make stable retry and fallback decisions.

## 16. Testing and CI

- Unit tests: key normalization, duration parsing, codecs, envelopes, TTL boundaries, jitter, tag indexes, stale policy, lock tokens, and middleware order using a fake clock.
- Contract tests: run against memory and every installed provider; test `AbortSignal`, cleanup, `null` values, binary payloads, concurrent `getOrSet`, and native-option type acceptance/rejection.
- Integration tests: Docker services for Redis, Valkey, Memcached, Dragonfly, and optional local emulators; ephemeral files for SQLite/LevelDB/LMDB/RocksDB.
- Managed-driver tests: configuration/connection contracts and opt-in credentialed CI only—no secrets in pull-request workflows.
- Runtime matrix: Node 20/22/current, Bun, and Deno. Type matrix: TypeScript 5.9, 6.x, and 7.x against emitted declarations.
- Package tests: assert each provider SDK stays optional, each subpath is loadable without unrelated SDKs, and ESM/CJS export maps remain valid.

## 17. Delivery sequence

1. **Foundation:** public types, errors, key/codec/envelope layer, memory provider, factory, contract test kit.
2. **Core policies:** TTL, `getOrSet`, singleflight, stale-while-revalidate, capabilities, health, middleware and observability.
3. **Distributed drivers:** Redis first, then Valkey, Dragonfly, and Memcached, including locks and tag strategies matched to their capabilities.
4. **Managed profiles:** ElastiCache, Memorystore, Azure Cache for Redis, and Momento with secure auth and connection validation.
5. **Embedded drivers:** SQLite first (portable, transactional), then LevelDB, LMDB, and RocksDB with clearly stated runtime support.
6. **Advanced composition:** tiered cache, invalidation buses, routing/fallback, framework adapters, and operational guides.
7. **Hardening:** load/performance testing, chaos/failure tests, documentation, examples, and compatibility guarantees.

## 18. Documentation deliverables

- `README.md`: design rule, quick start, provider table, runtime matrix, and optional-dependency behaviour.
- One guide per provider: installation, auth, TLS, connection tuning, supported capabilities, native client/options, local test recipe, and production caveats.
- `docs/custom-providers.md`: full contract and compliance checklist.
- `docs/caching-patterns.md`: cache-aside, write-through, SWR, negative caching, tag invalidation, and tiered cache trade-offs.
- `docs/operations.md`: timeout/retry limits, metrics, tracing, health probes, eviction, memory sizing, and incident guidance.
- `docs/security.md`: credential handling, TLS, key privacy, tenant isolation, unsafe serialization, and cache-poisoning prevention.

## 19. Explicit non-goals for the initial release

- Claiming transactional semantics across unrelated remote providers.
- Pretending managed Redis/Valkey offerings differ from their actual protocol/engine semantics.
- Automatic global key scans or unbounded tag fan-out.
- Silently emulating critical features (especially distributed locks) without exposing that downgrade through capabilities.
- Loading all SDKs, native bindings, or cloud clients from the core import.

This plan keeps CacheKit simple at the application boundary while retaining the operational and provider-specific controls production caching needs.
