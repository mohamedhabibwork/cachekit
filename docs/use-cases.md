# Use cases

Every use case CacheKit covers, each with a short, runnable example. All
examples use the public API from `@mohamedhabibwork/cachekit` (plus
`/redis` or `/testing` where noted) and run on Node 20+, Bun, and Deno.

```ts
import { createCache } from "@mohamedhabibwork/cachekit";
const cache = await createCache({ type: "memory", namespace: "app:v1", defaultTtl: "10m" });
```

## 1. Get / set / delete

A miss is `undefined`; `null` is a real, cacheable value.

```ts
await cache.set("greeting", "hello");
await cache.get<string>("greeting"); // "hello"
await cache.has("greeting"); // true
await cache.delete("greeting"); // { deleted: true }
```

## 2. Expiration (TTL) and sliding expiry

TTLs accept milliseconds or `"250ms" | "30s" | "5m" | "1h" | "1d"`. `touch` resets the TTL of an existing entry, which gives sliding sessions.

```ts
await cache.set("session:abc", { userId: 1 }, { ttl: "30m" });
await cache.touch("session:abc", "30m"); // extend on activity
```

## 3. Cache-aside / remember (`getOrSet`)

Load on a miss, store, and return. Concurrent callers in one process share a single load (stampede protection).

```ts
const user = await cache.getOrSet(`user:${id}`, ({ signal }) => db.users.find(id, { signal }), {
  ttl: "5m",
});
```

## 4. Stale-while-revalidate

`staleTtl` adds a window after expiry in which `getOrSet` returns the stale value immediately and refreshes it once in the background.

```ts
const home = await cache.getOrSet("page:home", renderHome, { ttl: "30s", staleTtl: "5m" });
const strict = await cache.getOrSet("price:42", loadPrice, { ttl: "30s", serveStale: false });
const maybeStale = await cache.get("page:home", { allowStale: true });
```

## 5. Entry metadata

```ts
const entry = await cache.getEntry<string>("page:home", { allowStale: true });
entry?.isStale; // true inside the stale window
entry?.expiresAt; // epoch ms
entry?.tags; // ["pages"]
```

## 6. Negative caching

Cache a known absence as `null` with a short TTL so missing rows do not hammer the database.

```ts
const user = await cache.getOrSet(`user:${id}`, async () => (await db.users.find(id)) ?? null, {
  ttl: "30s",
});
```

## 7. Batch reads and writes

```ts
await cache.setMany(
  [
    { key: "product:1", value: { id: 1 } },
    { key: "product:2", value: { id: 2 }, options: { ttl: "1m" } },
  ],
  { ttl: "5m" },
);
const found = await cache.getMany<{ id: number }>(["product:1", "product:2", "product:3"]);
found.get("product:1"); // { id: 1 } (misses are simply absent)
await cache.deleteMany(["product:1", "product:2"]); // 2
```

## 8. Tag-based invalidation

Group entries under bounded tags and invalidate them together. Check `cache.capabilities.tags` first; Redis-protocol providers report `unsupported`.

```ts
await cache.set("product:42", product, { tags: ["products", "product:42"] });
await cache.set("products:page:1", page, { tags: ["products"] });
await cache.invalidateTags(["products"]); // { invalidated: 2, mode: "delete" }
```

## 9. Namespaces and key versioning

The provider `namespace` isolates applications and lets you "invalidate everything" by bumping a version.

```ts
const v2 = await createCache({ type: "memory", namespace: "catalog:v2" });
```

## 10. Scoped views (per tenant / per feature) — `namespaced`

Share one cache/connection between scopes. Keys are stored as `prefix:key`; tags stay global and `clear()` is refused on a view.

```ts
import { namespaced } from "@mohamedhabibwork/cachekit";

const tenant = namespaced(cache, `tenant:${tenantId}`);
await tenant.set("settings", settings);
await tenant.get("settings");
```

## 11. Counters and fixed-window rate limiting — `increment` / `decrement`

Read-modify-write under the provider's `withLock`. The TTL is set when the counter is created and not extended, giving a fixed window. Locks are per-process for memory and distributed for Redis.

```ts
import { increment, decrement } from "@mohamedhabibwork/cachekit";

const hits = await increment(cache, `rate:${ip}`, { ttl: "1m" });
if (hits > 100) throw new Error("Too many requests");

await increment(cache, "stock:42", { by: 10 });
await decrement(cache, "stock:42"); // 9
```

## 12. Set-if-absent — `addIfAbsent`

```ts
import { addIfAbsent } from "@mohamedhabibwork/cachekit";

const first = await addIfAbsent(cache, `idempotency:${requestId}`, "processing", { ttl: "1h" });
if (!first) return; // duplicate request
```

With Redis you can also use the native flag: `cache.set(key, value, { native: { NX: true } })`.

## 13. One-time values — `pull`

Read and delete in one call (flash messages, one-time tokens).

```ts
import { pull } from "@mohamedhabibwork/cachekit";

await cache.set("flash:user:1", "Saved!", { ttl: "1m" });
await pull<string>(cache, "flash:user:1"); // "Saved!"
await pull(cache, "flash:user:1"); // undefined
```

## 14. Function memoization — `memoize`

Wrap any async function; results are cached through `getOrSet`, so concurrent calls are deduplicated.

```ts
import { memoize } from "@mohamedhabibwork/cachekit";

const getUser = memoize(cache, (id: string) => db.users.find(id), {
  key: (id) => `user:${id}`,
  tags: (id) => [`user:${id}`],
  ttl: "5m",
});
await getUser("42");
await cache.invalidateTags(["user:42"]);
```

## 15. Locks / critical sections

`withLock` serializes work on a key: local for memory, distributed (`SET NX PX` + token-checked release) for Redis.

```ts
await cache.withLock("job:nightly-report", () => runReport(), { wait: "2s", lease: "30s" });
```

`CacheLockTimeoutError` is thrown when `wait` elapses.

## 16. Layered L1/L2 caching — `createLayeredCache`

Read the in-process tier first, fall back to the shared tier and backfill L1. Writes, deletes, and tag invalidations go to both tiers. `l1Ttl` bounds how stale another process's L1 copy can get.

```ts
import { createCache, createLayeredCache, createMemoryCache } from "@mohamedhabibwork/cachekit";

const cache = createLayeredCache({
  l1: createMemoryCache({ maxEntries: 10_000 }),
  l2: await createCache({ type: "redis", url: process.env.REDIS_URL }),
  l1Ttl: "30s",
});
await cache.getOrSet("config", loadConfig, { ttl: "10m" });
```

## 17. Bounded memory (LRU eviction)

`maxEntries` caps the memory provider; the least recently read or written entry is evicted first.

```ts
import { createMemoryCache } from "@mohamedhabibwork/cachekit";
const l1 = createMemoryCache({ maxEntries: 1_000, defaultTtl: "1m" });
```

## 18. Serialization (codecs)

`json` (default), `text`, `bytes`, or a custom codec.

```ts
const blobs = await createCache({ type: "memory", codec: "bytes" });
await blobs.set("thumb:1", new Uint8Array([1, 2, 3]));

const dates = await createCache({
  type: "memory",
  codec: {
    name: "date",
    encode: (d: Date) => new TextEncoder().encode(d.toISOString()),
    decode: (b) => new Date(new TextDecoder().decode(b)),
  },
});
```

## 19. Redis and Redis-compatible services

```ts
import { createRedisCache } from "@mohamedhabibwork/cachekit/redis";
import { createValkeyCache } from "@mohamedhabibwork/cachekit/valkey";

const redis = await createRedisCache({ url: process.env.REDIS_URL, namespace: "app" });
const valkey = await createValkeyCache({ url: process.env.VALKEY_URL });
```

Entry points also exist for `/dragonfly`, `/elasticache`, `/memorystore`, and `/azure-redis`.

## 20. Native escape hatch

```ts
const ttl = await redis.nativeRequest((client) => client.sendCommand(["PTTL", "app\u001fkey"]));
```

## 21. Capability detection

```ts
if (cache.capabilities.tags !== "unsupported") await cache.invalidateTags(["products"]);
```

## 22. Cancellation

Every operation accepts an `AbortSignal`; loaders receive one too.

```ts
const controller = new AbortController();
await cache.get("key", { signal: controller.signal });
```

## 23. Named caches — `createCacheManager`

```ts
import { createCacheManager } from "@mohamedhabibwork/cachekit";

const caches = createCacheManager({
  default: "catalog",
  caches: {
    catalog: { type: "memory", namespace: "catalog:v1", defaultTtl: "5m" },
    sessions: { type: "redis", url: process.env.REDIS_URL, defaultTtl: "1d" },
  },
});
const catalog = await caches.cache("catalog");
```

## 24. Health checks and shutdown

```ts
const health = await cache.health(); // { status: "ok", provider: "memory", latency: 0, ... }
const all = await caches.health(); // per named cache
process.on("SIGTERM", () => void caches.close());
```

## 25. Custom providers

```ts
import {
  createCache,
  defineCacheProvider,
  registerCacheProvider,
} from "@mohamedhabibwork/cachekit";

registerCacheProvider(
  defineCacheProvider({ type: "my-store", create: (config) => new MyStoreCache(config) }),
);
const mine = await createCache({ type: "my-store", endpoint: "..." });
```

See [custom providers](custom-providers.md) for the full contract.

## 26. Testing

```ts
import {
  createFakeClock,
  createMemoryCache,
  runCacheContract,
} from "@mohamedhabibwork/cachekit/testing";

const clock = createFakeClock();
const cache = createMemoryCache({ clock: clock.now });
await cache.set("k", "v", { ttl: "1s" });
clock.advance(1_000);
await cache.get("k"); // undefined

await runCacheContract(() => new MyStoreCache({})); // provider authors
```

## 27. Logging

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";
const caches = createCacheManager({
  default: "a",
  caches: { a: { type: "memory" } },
  logger: createLogger({ name: "cache" }),
});
```

## Deliberately not covered

- **Cross-process L1 coherence** (pub/sub invalidation): `createLayeredCache` bounds staleness with `l1Ttl` instead; broadcast invalidations yourself if you need strict coherence.
- **Atomic native counters** (`INCRBY`): counters use the portable `withLock` path; call `nativeRequest` for raw Redis `INCRBY` if you need it.
- **Tags on Redis-protocol providers**: reported `unsupported` rather than emulated with unbounded index sets.
