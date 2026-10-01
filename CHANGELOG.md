# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

- feat: `increment`/`decrement`, `addIfAbsent`, `pull`, `memoize` helpers
- feat: `namespaced` scoped cache views and `createLayeredCache` L1/L2 tiering
- fix: memory `withLock` now admits one waiter at a time (previously all waiters ran together after a release)
- fix: memory `maxEntries` eviction is now LRU instead of FIFO
- docs: `docs/use-cases.md` with an example per use case

## [v0.2.0] - 2026-09-30

- chore: release v0.2.0 (f78a902)
- chore: update tooling, scripts and dependencies (9fd4d9b)
- docs: update README, guides and agent docs (cb80066)
- test: add architecture, peer-dependency and manager tests (081434b)
- refactor: restructure source modules for clean architecture (d1ab91c)
- feat: accept optional loggerkit-compatible logger in managers (4c61377)
- ci: update GitHub workflows and repository templates (9b50a10)
- docs: add project badges (168653f)
- build: override patched esbuild release (518438f)
- ci: generate changelog for releases (591af0e)
- feat: add support for additional cache providers (valkey, dragonfly, elasticache, memorystore, azure-redis) (34ace95)
- ci: make package publishing idempotent (053e6d0)
- Merge pull request #2 from mohamedhabibwork/dependabot/npm_and_yarn/multi-00f7b83f97 (cf00dd7)
- build(deps): bump @vitest/mocker and vitest (1e998fa)

## [v0.1.2] - 2026-09-09

- feat: initialize CacheKit caching package (2bb51f8)
