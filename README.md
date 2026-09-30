# CacheKit

[![npm version](https://img.shields.io/npm/v/@mohamedhabibwork/cachekit)](https://www.npmjs.com/package/@mohamedhabibwork/cachekit)
[![npm downloads](https://img.shields.io/npm/dm/@mohamedhabibwork/cachekit)](https://www.npmjs.com/package/@mohamedhabibwork/cachekit)
[![Latest Release](https://img.shields.io/github/v/release/mohamedhabibwork/cachekit)](https://github.com/mohamedhabibwork/cachekit/releases/latest)
[![License: MIT](https://img.shields.io/npm/l/@mohamedhabibwork/cachekit)](LICENSE)
[![GitHub: @mohamedhabibwork](https://img.shields.io/badge/GitHub-@mohamedhabibwork-181717?logo=github&logoColor=white)](https://github.com/mohamedhabibwork)
[![Node.js >= 20](https://img.shields.io/node/v/@mohamedhabibwork/cachekit)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CI](https://github.com/mohamedhabibwork/cachekit/actions/workflows/ci.yml/badge.svg)](https://github.com/mohamedhabibwork/cachekit/actions/workflows/ci.yml)
[![Release notes](https://github.com/mohamedhabibwork/cachekit/actions/workflows/release-notes.yml/badge.svg)](https://github.com/mohamedhabibwork/cachekit/actions/workflows/release-notes.yml)
[![Socket](https://badge.socket.dev/npm/package/@mohamedhabibwork/cachekit)](https://socket.dev/npm/package/@mohamedhabibwork/cachekit)

Provider-first, runtime-portable TypeScript caching for Node.js 20+, Bun, and Deno.

CacheKit gives applications one deliberate cache contract without hiding provider differences. Core imports have no provider SDK dependencies; provider entrypoints load their SDK only when you use them.

## Install

```sh
npm install @mohamedhabibwork/cachekit
```

## Quick start

```ts
import { createCache } from "@mohamedhabibwork/cachekit";

const cache = await createCache({
  type: "memory",
  namespace: "catalog:v1",
  defaultTtl: "10m",
});

await cache.set(
  "product:42",
  { id: 42, name: "Keyboard" },
  {
    ttl: "5m",
    tags: ["products", "product:42"],
  },
);

const product = await cache.get<{ id: number; name: string }>("product:42");
```

## Supported in 0.1

| Provider       | Import                                    | Status                                                                                                                             |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Memory         | `@mohamedhabibwork/cachekit` or `/memory` | Complete in-process provider: TTL, SWR, tags, local locks, codecs.                                                                 |
| Redis protocol | `@mohamedhabibwork/cachekit/redis`        | Optional `redis` peer dependency; works with Redis-compatible endpoints. Tags and namespace clear deliberately report unsupported. |
| Custom         | `@mohamedhabibwork/cachekit`              | Register an application provider with the public contract.                                                                         |

The architecture plan tracks planned profiles and embedded drivers. They are not published as empty entrypoints: importing a package path always means a usable implementation exists.

## Redis

```sh
npm install @mohamedhabibwork/cachekit redis
```

```ts
import { createRedisCache } from "@mohamedhabibwork/cachekit/redis";

const cache = await createRedisCache({
  url: process.env.REDIS_URL,
  namespace: "catalog:v1",
  defaultTtl: "10m",
});

await cache.set("product:42", { id: 42 }, { ttl: "5m", native: { NX: true } });
```

The generic factory also supports Redis directly: `createCache({ type: 'redis', url: process.env.REDIS_URL })`. The optional SDK is still loaded only when that provider is created.

You may inject a compatible client with `sendCommand()` instead of letting CacheKit create one. If `redis` is missing, the provider throws `CacheDependencyMissingError` with its installation command.

## Manager (named caches)

Applications that juggle several caches (catalog, sessions, rate limits) get
one control surface: lazy creation from config, warmup, per-cache health, and
a single close.

```ts
import { createCacheManager } from "@mohamedhabibwork/cachekit";

const caches = createCacheManager({
  default: "catalog",
  caches: {
    catalog: { type: "memory", namespace: "catalog:v1", defaultTtl: "5m" },
    sessions: { type: "redis", url: process.env.REDIS_URL, defaultTtl: "1d" },
  },
});

const catalog = await caches.cache("catalog"); // created lazily, instance reused
await caches.warmup(); // or create everything up front
console.log(await caches.health()); // { catalog: { status: "ok", ... }, ... }
await caches.close(); // closes only the caches that were created
```

## Framework integration

CacheKit works in any framework — it is a plain async library with zero runtime dependencies. Ready-made recipes:

| Framework            | Recipe                          |
| -------------------- | ------------------------------- |
| Express 4/5          | cache-aside handlers            |
| Fastify 4/5          | plugin with decorated cache     |
| NestJS 10+           | injectable `CacheService`       |
| Hono 4               | shared-instance middleware      |
| Next.js (App Router) | server-side route-handler cache |
| Elysia (Bun)         | shared async instance           |

See [framework integration](docs/frameworks.md) for copy-paste snippets.

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
- [End-to-end examples](docs/examples.md)
- [Framework integration](docs/frameworks.md)
- [Custom providers](docs/custom-providers.md)
- [Operations](docs/operations.md)
- [Security](docs/security.md)
- [Publishing](docs/publishing.md)
- [Changelog](CHANGELOG.md)

## Use with AI (llms.txt)

This repo ships an `llms.txt` — a curated, LLM-readable map of the API, semantics, and docs, written so coding assistants get it right the first time.

- **Cursor / Claude Code / Copilot**: open [`llms.txt`](https://github.com/mohamedhabibwork/cachekit/blob/main/llms.txt) or paste the raw text into your rules file (`CLAUDE.md`, `.cursorrules`, `AGENTS.md`).
- **ChatGPT / Custom GPTs / Perplexity**: add the raw URL — https://raw.githubusercontent.com/mohamedhabibwork/cachekit/main/llms.txt
- **Offline / agents in CI**: `llms.txt`, the README, and every guide in `docs/` ship inside the npm tarball, so agents can read them straight from `node_modules/@mohamedhabibwork/cachekit/`.
- **Contributing to this repo**: [AGENTS.md](AGENTS.md) documents layout, commands, and conventions for coding agents.

## License

[MIT](LICENSE)

## Logging with loggerkit

Managers accept an optional `logger` (any object with `debug/info/warn/error`), so a
[`@mohamedhabibwork/loggerkit`](https://github.com/mohamedhabibwork/loggerkit) `Logger` plugs in
directly with no extra dependency:

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";
import { createCacheManager } from "@mohamedhabibwork/cachekit";

const manager = createCacheManager({ ...config, logger: createLogger({ name: "cache" }) });
```

Provider creation and close events are logged at `debug`; creation failures at `error`.
