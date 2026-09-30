# Architecture

Provider-first caching with a flat `src/` layout. The dependency direction is strict and
whitelisted — each module may import only what is listed for it in
`test/architecture.test.ts`, which walks every file under `src/`, resolves each relative
import, and fails on any other edge.

## Module map

Dependencies point one way, bottom-up:

| Module                                                                            | Role                                                    | May import                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------- |
| `core.ts`                                                                         | Contracts, errors, codec, TTL/locking primitives        | nothing internal (leaf)    |
| `memory.ts`                                                                       | In-process L1 cache                                     | `core.ts`                  |
| `redis.ts`                                                                        | Redis provider over the minimal `RedisClient` surface   | `core.ts`                  |
| `redis-compatible.ts`                                                             | Base for Redis-protocol services; extends `RedisCache`  | `core.ts`, `redis.ts`      |
| `valkey.ts`, `dragonfly.ts`, `elasticache.ts`, `memorystore.ts`, `azure-redis.ts` | Redis-protocol providers                                | `redis-compatible.ts` only |
| `testing.ts`                                                                      | In-memory fake for consumers                            | `core.ts`, `memory.ts`     |
| `manager.ts`                                                                      | Named multi-cache manager (lazy, warmup, health, close) | `core.ts`, `index.ts`      |
| `index.ts`                                                                        | Composition / public API                                | anything                   |

Note that `src/` never imports the `redis` npm package: providers talk to a small structural
`RedisClient` interface (or accept an injected client), which keeps the peer dependency optional
and the providers portable across Redis, Valkey, ElastiCache, Memorystore, and Dragonfly.

### Adding a provider

1. If it speaks the Redis protocol, extend `RedisCompatibleCache`; otherwise implement `Cache`
   from `core.ts` directly.
2. Add a facade module and wire it into `index.ts` and `package.json` exports.
3. Register the new module's allowed imports in `test/architecture.test.ts` (the test throws on
   an unregistered module by design) and run `npm run check`.

## Clean-code toolchain

Linting and formatting are enforced by oxlint and oxfmt:

| Command                | What it does                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint`         | `oxlint --deny-warnings --report-unused-disable-directives` — fails on any warning |
| `npm run lint:fix`     | Auto-fix what oxlint can                                                           |
| `npm run format`       | `oxfmt` — canonical formatting for every source file                               |
| `npm run format:check` | CI gate for formatting                                                             |
| `npm run check`        | format:check → lint → typecheck → test → build                                     |

The lint config (`.oxlintrc.json`) enables the `correctness`, `suspicious`, and `perf` categories
across the `typescript`, `unicorn`, `import`, and `promise` plugins, plus targeted rules:
`no-unused-vars` (with `_`-prefix opt-out), `no-console` (allowing `warn`/`error` only),
`prefer-node-protocol`, `no-array-reduce`, `no-require-imports`, `import/no-duplicates`,
`promise/no-nesting`, and `promise/always-return`. Tests and scripts get a narrower rule set via
`overrides`. Anything intentionally outside the rules is marked inline with a reason
(`// oxlint-disable-next-line <rule> -- why`) rather than a blanket exclusion.
