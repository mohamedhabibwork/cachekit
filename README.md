# CacheKit

Provider-first, runtime-portable TypeScript caching for Node.js 20+, Bun, and Deno.

CacheKit gives applications one deliberate cache contract without hiding provider differences. Core imports have no provider SDK dependencies; provider entrypoints load their SDK only when you use them.

## Install

```sh
npm install @mohamedhabibwork/cachekit
```

## Quick start

```ts
import { createCache } from '@mohamedhabibwork/cachekit';

const cache = await createCache({
  type: 'memory',
  namespace: 'catalog:v1',
  defaultTtl: '10m',
});

await cache.set('product:42', { id: 42, name: 'Keyboard' }, {
  ttl: '5m',
  tags: ['products', 'product:42'],
});

const product = await cache.get<{ id: number; name: string }>('product:42');
```

## Supported in 0.1

| Provider | Import | Status |
| --- | --- | --- |
| Memory | `@mohamedhabibwork/cachekit` or `/memory` | Complete in-process provider: TTL, SWR, tags, local locks, codecs. |
| Redis protocol | `@mohamedhabibwork/cachekit/redis` | Optional `redis` peer dependency; works with Redis-compatible endpoints. Tags and namespace clear deliberately report unsupported. |
| Custom | `@mohamedhabibwork/cachekit` | Register an application provider with the public contract. |

The architecture plan tracks planned profiles and embedded drivers. They are not published as empty entrypoints: importing a package path always means a usable implementation exists.

## Redis

```sh
npm install @mohamedhabibwork/cachekit redis
```

```ts
import { createRedisCache } from '@mohamedhabibwork/cachekit/redis';

const cache = await createRedisCache({
  url: process.env.REDIS_URL,
  namespace: 'catalog:v1',
  defaultTtl: '10m',
});

await cache.set('product:42', { id: 42 }, { ttl: '5m', native: { NX: true } });
```

The generic factory also supports Redis directly: `createCache({ type: 'redis', url: process.env.REDIS_URL })`. The optional SDK is still loaded only when that provider is created.

You may inject a compatible client with `sendCommand()` instead of letting CacheKit create one. If `redis` is missing, the provider throws `CacheDependencyMissingError` with its installation command.

## Semantics

- A cache miss is `undefined`; `null` is cacheable.
- `ttl` is the fresh period; `staleTtl` is an additional stale window. `get()` returns fresh values only; `get(..., { allowStale: true })` can return in-window stale data.
- `getOrSet()` deduplicates concurrent loads within a process. With a stale entry it returns the stale value while one local caller refreshes it, unless `serveStale: false`.
- Built-in codecs are `json` (default), `text`, and `bytes`. Custom codecs must have a `name`, `encode`, and `decode`.
- Keys and tags reject control characters. Namespaces use an unambiguous internal separator.
- Inspect `cache.capabilities` before relying on a non-portable operation such as distributed locks or tags.

## Development

```sh
npm ci
npm run check
```

`npm run check` lints, typechecks, tests, and produces dual ESM/CJS output. The CI workflow covers Node 20/22/24 plus Bun and Deno smoke tests. Pushing a `v*` tag runs the provenance-enabled publish workflow; see [publishing](docs/publishing.md).

## Guides

- [Caching patterns](docs/caching-patterns.md)
- [Custom providers](docs/custom-providers.md)
- [Operations](docs/operations.md)
- [Security](docs/security.md)
- [Publishing](docs/publishing.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
