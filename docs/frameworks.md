# Framework integration

CacheKit is framework-agnostic — it is a plain async library with no runtime dependencies, so it
works anywhere TypeScript runs. The recipes below cover the frameworks we test the patterns
against; the same three calls (`getOrSet`, `set`, `invalidateTags`) apply everywhere.

| Framework            | Pattern used below                        |
| -------------------- | ----------------------------------------- |
| Express 4/5          | cache-aside helper for expensive handlers |
| Fastify 4/5          | plugin with a decorated cache             |
| NestJS 10+           | injectable `CacheService` module          |
| Hono 4               | middleware-style shared instance          |
| Next.js (App Router) | server-side caching in route handlers     |
| Elysia (Bun)         | shared async instance                     |
| Elysia (Bun)         | shared async instance                     |

The `memory` provider needs **no additional install**. For the `redis` provider add the optional
peer once: `npm install redis` (or inject your own client).

## Express

```ts
import express from "express";
import { createCache } from "@mohamedhabibwork/cachekit";

const app = express();
const cache = await createCache({ type: "memory", namespace: "catalog:v1", defaultTtl: "5m" });

app.get("/products/:id", async (req, res) => {
  const product = await cache.getOrSet(`product:${req.params.id}`, async () => {
    return expensiveDatabaseLookup(req.params.id);
  });
  res.json(product);
});

// Writes invalidate by tag so every list view stays coherent.
app.put("/products/:id", async (req, res) => {
  await saveProduct(req.params.id, req.body);
  await cache.invalidateTags([`product:${req.params.id}`, "products"]);
  res.status(204).end();
});
```

## Fastify

```ts
import Fastify from "fastify";
import { createCache, type Cache } from "@mohamedhabibwork/cachekit";

const app = Fastify();

app.decorate("cache", await createCache({ type: "memory", defaultTtl: "5m" }));

app.get("/products/:id", async (request, reply) => {
  return app.cache.getOrSet(`product:${request.params.id}`, () =>
    expensiveLookup(request.params.id),
  );
});

await app.ready();
```

Declare the decoration type under `fastify.d.ts` if you use strict TypeScript.

## NestJS

```ts
import { Global, Module, Injectable, OnModuleInit } from "@nestjs/common";
import { createCache, type Cache } from "@mohamedhabibwork/cachekit";

@Injectable()
export class CacheService implements OnModuleInit {
  private cache!: Cache;
  async onModuleInit() {
    this.cache = await createCache({ type: "memory", namespace: "app:v1", defaultTtl: "5m" });
  }
  getOrSet<V>(key: string, loader: () => Promise<V>) {
    return this.cache.getOrSet(key, loader);
  }
}

@Global()
@Module({ providers: [CacheService], exports: [CacheService] })
export class CacheModule {}
```

## Hono

```ts
import { Hono } from "hono";
import { createCache } from "@mohamedhabibwork/cachekit";

const cache = await createCache({ type: "memory", defaultTtl: "5m" });
const app = new Hono();

app.get("/products/:id", async (c) => {
  const product = await cache.getOrSet(`product:${c.req.param("id")}`, () => expensiveLookup());
  return c.json(product);
});

export default app;
```

## Next.js (App Router)

```ts
// app/api/products/[id]/route.ts — runs server-side only.
import { createCache } from "@mohamedhabibwork/cachekit";

const cache = await createCache({ type: "memory", defaultTtl: "5m" });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await cache.getOrSet(`product:${id}`, () => expensiveLookup(id));
  return Response.json(product);
}
```

Use the `redis` provider when the route is served by more than one instance; the `memory`
provider is per-process by design.

## Elysia (Bun)

Elysia is Bun-native; CacheKit runs on Bun unchanged. Create the cache once at
module scope and use cache-aside in handlers.

```ts
import { Elysia } from "elysia";
import { createCache } from "@mohamedhabibwork/cachekit";

const cache = await createCache({ type: "memory", defaultTtl: "5m" });

new Elysia()
  .get("/products/:id", async ({ params }) => {
    return cache.getOrSet(`product:${params.id}`, () => expensiveLookup(params.id));
  })
  .listen(3000);
```

Use the `redis` provider when multiple Bun instances share the workload.

## See also

- [Caching patterns](caching-patterns.md) — SWR, stampede protection, tag invalidation.
- [Architecture](architecture.md) — layer map and how the optional `redis` peer is loaded.
