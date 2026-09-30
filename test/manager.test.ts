import { describe, expect, it } from "vitest";
import {
  CacheInvalidConfigError,
  createMemoryCache,
  defineCacheProvider,
  registerCacheProvider,
  type Cache,
} from "../src/index.js";
import { createCacheManager } from "../src/manager.js";

describe("createCacheManager", () => {
  it("creates named caches lazily and reuses the instance", async () => {
    const manager = createCacheManager({
      default: "catalog",
      caches: {
        catalog: { type: "memory", namespace: "catalog:v1" },
        sessions: { type: "memory", namespace: "sessions:v1" },
      },
    });

    const catalog = await manager.cache("catalog");
    expect(await manager.cache("catalog")).toBe(catalog); // same instance
    const sessions = await manager.cache("sessions");
    expect(sessions).not.toBe(catalog);

    await catalog.set("k", "v");
    expect(await catalog.get("k")).toBe("v");
    expect(await manager.default()).toBe(catalog); // default points at "catalog"
    expect(manager.cacheNames()).toEqual(["catalog", "sessions"]);
    expect(manager.defaultName()).toBe("catalog");
    await manager.close();
  });

  it("isolates namespaces between named caches", async () => {
    const manager = createCacheManager({
      default: "a",
      caches: {
        a: { type: "memory", namespace: "a" },
        b: { type: "memory", namespace: "b" },
      },
    });
    const a = await manager.cache("a");
    const b = await manager.cache("b");
    await a.set("shared-key", "from-a");
    expect(await b.get("shared-key")).toBeUndefined();
    await manager.close();
  });

  it("rejects unknown names and invalid setup", async () => {
    const manager = createCacheManager({
      default: "only",
      caches: { only: { type: "memory" } },
    });
    await expect(manager.cache("nope" as "only")).rejects.toThrow(CacheInvalidConfigError);

    // The compile-time `default` typing rejects unknown names; this exercises
    // the runtime guard for JavaScript callers.
    expect(() =>
      createCacheManager({ default: "x", caches: { y: { type: "memory" } } } as never),
    ).toThrow(CacheInvalidConfigError);
    await manager.close();
  });

  it("evicts failed creations so the next call retries", async () => {
    let attempts = 0;
    registerCacheProvider(
      defineCacheProvider({
        type: "flaky-manager-test",
        create: async () => {
          attempts++;
          if (attempts === 1) throw new Error("boom");
          return createMemoryCache({});
        },
      }),
    );
    const manager = createCacheManager({
      default: "flaky",
      caches: { flaky: { type: "flaky-manager-test" } as never },
    });

    await expect(manager.cache("flaky")).rejects.toThrow("boom");
    const cache: Cache = await manager.cache("flaky"); // retried and succeeded
    expect(attempts).toBe(2);
    expect(cache.type).toBe("memory");
    await manager.close();
  });

  it("warmup creates every cache up front; health tolerates failures", async () => {
    const manager = createCacheManager({
      default: "primary",
      caches: {
        primary: { type: "memory" },
        secondary: { type: "memory" },
        broken: { type: "no-such-provider" } as never,
      },
    });

    // warmup fails fast on a broken config...
    await expect(manager.warmup()).rejects.toThrow(CacheInvalidConfigError);

    // ...while health() reports per-cache status instead of throwing.
    const health = await manager.health();
    expect(health.primary?.status).toBe("ok");
    expect(health.secondary?.status).toBe("ok");
    expect(health.broken?.status).toBe("error");
    await manager.close();
  });

  it("warmup succeeds when every config is valid", async () => {
    const manager = createCacheManager({
      default: "primary",
      caches: { primary: { type: "memory" }, secondary: { type: "memory" } },
    });
    await manager.warmup();
    const health = await manager.health();
    expect(health.primary?.status).toBe("ok");
    expect(health.secondary?.status).toBe("ok");
    await manager.close();
  });

  it("close closes created caches and forgets them; later use re-creates", async () => {
    const manager = createCacheManager({
      default: "only",
      caches: { only: { type: "memory" } },
    });
    const first = await manager.cache("only");
    await manager.close();
    await expect(first.get("k")).rejects.toThrow(); // closed cache refuses work

    const second = await manager.cache("only"); // re-created after close
    await second.set("k", "v");
    expect(await second.get("k")).toBe("v");
    await manager.close();
  });
});
