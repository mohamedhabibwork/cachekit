# Caching patterns

## Cache-aside

Use `getOrSet` for the common read-through cache-aside shape. It prevents duplicate loads within a process.

```ts
const user = await cache.getOrSet(`user:${id}`, () => users.find(id), { ttl: "5m" });
```

## Stale while revalidate

Give volatile, expensive values a bounded stale window. CacheKit returns fresh data first; after fresh expiry, `getOrSet` can return stale data while one local loader refreshes it.

```ts
await cache.getOrSet("home", renderHome, { ttl: "30s", staleTtl: "2m" });
```

This is availability-oriented. Use `serveStale: false` where the caller must wait for fresh data.

## Tags

Tags model bounded secondary indexes. They are ideal for invalidating an entity and its collection view together.

```ts
await cache.set("product:42", product, { tags: ["products", "product:42"] });
await cache.invalidateTags(["products"]);
```

Only use tags when `cache.capabilities.tags` is not `unsupported`. Avoid user-controlled or unbounded tag cardinality.

## Negative caching

Cache a known absence as `null`, not `undefined`, and keep its TTL short:

```ts
const user = await cache.getOrSet(`user:${id}`, async () => (await findUser(id)) ?? null, {
  ttl: "30s",
});
```

## Tiering

Use memory as an explicit L1 in front of a remote provider with `createLayeredCache` (see [use cases](use-cases.md#16-layered-l1l2-caching--createlayeredcache)). Keep `l1Ttl` short: CacheKit does not claim cross-process coherence for an in-process cache.

```ts
const cache = createLayeredCache({
  l1: createMemoryCache({ maxEntries: 1_000 }),
  l2: redis,
  l1Ttl: "30s",
});
```
