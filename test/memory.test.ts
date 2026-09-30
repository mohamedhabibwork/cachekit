import { describe, expect, it } from "vitest";
import { CacheClosedError, CacheInvalidConfigError, createMemoryCache } from "../src/index.js";
import { createFakeClock } from "../src/testing.js";

describe("MemoryCache", () => {
  it("round-trips null and defensively encoded values", async () => {
    const cache = createMemoryCache();
    const value = { nested: { count: 1 } };
    await cache.set("object", value);
    value.nested.count = 2;
    await cache.set("null", null);
    expect(await cache.get("object")).toEqual({ nested: { count: 1 } });
    expect(await cache.get("null")).toBeNull();
  });

  it("honours fresh and stale TTL windows", async () => {
    const clock = createFakeClock();
    const cache = createMemoryCache({ clock: clock.now });
    await cache.set("key", "value", { ttl: "1s", staleTtl: "2s" });
    clock.advance(1_000);
    expect(await cache.get("key")).toBeUndefined();
    expect(await cache.get("key", { allowStale: true })).toBe("value");
    clock.advance(2_000);
    expect(await cache.get("key", { allowStale: true })).toBeUndefined();
  });

  it("invalidates tags and updates indexes", async () => {
    const cache = createMemoryCache();
    await cache.set("a", 1, { tags: ["one", "all"] });
    await cache.set("b", 2, { tags: ["all"] });
    expect(await cache.invalidateTags(["all"])).toEqual({ invalidated: 2, mode: "delete" });
    expect(await cache.getMany(["a", "b"])).toEqual(new Map());
  });

  it("deduplicates concurrent loaders", async () => {
    const cache = createMemoryCache();
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "loaded";
    };
    await expect(
      Promise.all([cache.getOrSet("key", loader), cache.getOrSet("key", loader)]),
    ).resolves.toEqual(["loaded", "loaded"]);
    expect(calls).toBe(1);
  });

  it("validates inputs and rejects work after close", async () => {
    const cache = createMemoryCache();
    await expect(cache.set("", "x")).rejects.toBeInstanceOf(CacheInvalidConfigError);
    await cache.close();
    await expect(cache.get("key")).rejects.toBeInstanceOf(CacheClosedError);
  });
});
