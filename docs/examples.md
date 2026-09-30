# End-to-end examples

Complete, runnable applications built with CacheKit. Each example is a single
file — install, paste, run.

## 1. Read-through product API with tag invalidation (Express)

The classic cache-aside setup: `getOrSet` protects the database, tags let one
write invalidate every cached view that depends on it.

```sh
mkdir catalog && cd catalog && npm init -y
npm install @mohamedhabibwork/cachekit express
node --run dev # or: node server.mjs
```

```ts
// server.mjs — node >= 20
import express from "express";
import { createCache } from "@mohamedhabibwork/cachekit";

const app = express();
app.use(express.json());

// No extra SDK needed for the memory provider. For a shared cache:
//   npm install redis
//   const cache = await createCache({ type: "redis", url: process.env.REDIS_URL });
const cache = await createCache({ type: "memory", namespace: "catalog:v1", defaultTtl: "5m" });

app.get("/products/:id", async (req, res) => {
  const product = await cache.getOrSet(
    `product:${req.params.id}`,
    async () => {
      console.log("DB hit for", req.params.id); // proves caching works
      return { id: req.params.id, name: `Product ${req.params.id}`, price: 990 };
    },
    { tags: [`product:${req.params.id}`, "products"] },
  );
  res.json(product);
});

app.put("/products/:id", async (req, res) => {
  // ...persist the change, then invalidate every view of this product...
  await cache.invalidateTags([`product:${req.params.id}`, "products"]);
  res.status(204).end();
});

app.listen(3000, () => console.log("http://localhost:3000/products/42"));
```

Try it: `curl localhost:3000/products/42` twice — the second response is a
cache hit. `PUT /products/42`, then `GET` again: a fresh DB hit.

## 2. Two-tier cache: L1 memory in front of L2 Redis

Keep hot reads in-process and let Redis absorb the rest of the fleet. The L1
loader falls through to L2, which falls through to the database.

```sh
npm install @mohamedhabibwork/cachekit redis
```

```ts
// tiers.mjs
import { createCache } from "@mohamedhabibwork/cachekit";

const l1 = await createCache({ type: "memory", namespace: "l1", defaultTtl: "30s" });
const l2 = await createCache({
  type: "redis",
  url: process.env.REDIS_URL,
  namespace: "l2",
  defaultTtl: "10m",
});

export function tiered(key, loader) {
  return l1.getOrSet(key, () => l2.getOrSet(key, loader), { ttl: "30s" });
}

// tiered("product:42", () => db.products.find(42));
```

Swap `redis` for any Redis-protocol provider (`valkey`, `dragonfly`,
`elasticache`, `memorystore`) — the contract is identical.

## 3. Deterministic TTL tests (Vitest)

The fake clock makes TTL logic testable without real waiting.

```sh
npm install -D vitest
```

```ts
// cache.test.ts
import { expect, it } from "vitest";
import { createMemoryCache } from "@mohamedhabibwork/cachekit";
import { createFakeClock } from "@mohamedhabibwork/cachekit/testing";

it("expires after ttl and serves stale on demand", async () => {
  const clock = createFakeClock();
  const cache = await createMemoryCache({ clock: clock.now });
  await cache.set("key", "value", { ttl: "1s", staleTtl: "2s" });

  clock.advance(1_000);
  expect(await cache.get("key")).toBeUndefined(); // fresh window over
  expect(await cache.get("key", { allowStale: true })).toBe("value"); // still stale-usable

  clock.advance(2_000);
  expect(await cache.get("key", { allowStale: true })).toBeUndefined(); // stale window over
});
```

Run: `npx vitest`.

## Where to next

- [Caching patterns](caching-patterns.md) — SWR, stampede protection, codecs.
- [Framework integration](frameworks.md) — Express, Fastify, NestJS, Hono, Next.js, Elysia recipes.
- [Custom providers](custom-providers.md) — register your own provider.
- [Operations](operations.md) and [security](security.md) — production checklist.
