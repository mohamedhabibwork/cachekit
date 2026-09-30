# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

**CacheKit** (`@mohamedhabibwork/cachekit`) — provider-first TypeScript caching: one cache
contract, a zero-dependency in-memory provider, and Redis-protocol providers whose `redis`
peer is optional and loaded dynamically. Node >= 20, Bun, Deno; dual ESM/CJS.

## Layout

- `src/` — flat modules; dependency direction is whitelisted (see below).
  `core.ts` is the leaf; `redis-compatible.ts` extends `redis.ts`; each Redis-protocol
  provider extends `redis-compatible.ts`; `index.ts` is the composition layer.
- `src/manager.ts` — named multi-cache manager (lazily creates via the `index.ts` factory).
- `test/` — Vitest suites, including `architecture.test.ts` (boundary guard) and
  `peer-dependencies.test.ts` (optional-peer contract).
- `docs/` — markdown guides, shipped in the npm tarball and formatted by oxfmt.

## Commands

```sh
npm ci             # install exactly the lockfile (dev deps only)
npm run check      # format:check -> lint -> typecheck -> test -> build  (the gate)
npm run lint:fix   # oxlint --fix
npm run format     # oxfmt (also formats docs/*.md)
npm test           # vitest run
```

CI fails on any lint warning (`--deny-warnings`), any formatting diff, or any architecture
violation. Run `npm run check` before declaring anything done.

## Conventions

- **Formatting is oxfmt, not opinion**: never hand-format; run `npm run format`. Markdown and
  `llms.txt` sibling docs are formatted too.
- **Lint**: `.oxlintrc.json` enables correctness/suspicious/perf across typescript, unicorn,
  import, promise plugins. If a rule fires on intentional code, add an inline
  `// oxlint-disable-next-line <rule>` (or `/* ... */` mid-expression) **with a reason** —
  never widen the config for one site.
- **Architecture**: `test/architecture.test.ts` whitelists which modules each module may
  import. Adding a module REQUIRES registering it there and describing it in
  `docs/architecture.md`. Providers must never import sibling providers.
- **Dependencies**: do not add runtime dependencies. Provider SDKs are optional peers loaded
  via dynamic `import()` with an install-hinting `CacheDependencyMissingError`. Dev deps only
  when actually needed.
- **TypeScript**: `lib: ["ES2023", "DOM"]` — `toSorted`, `findLast` etc. are fine; keep
  `verbatimModuleSyntax` discipline (`import type` for types).
- **Errors**: throw the typed `Cache*Error` subclasses; missing optional SDKs must surface
  the install command (covered by `test/peer-dependencies.test.ts`).

## Gotchas

- `MemoryCacheOptions.clock` takes `clock.now` from `createFakeClock()`, not the clock object.
- The redis path never imports the `redis` package when a client is injected — keep it that
  way (it is what makes the peer optional).
- Docs, README, and `llms.txt` are part of the deliverable: API changes update all three.
