import { describe, expect, it } from "vitest";
import {
  CacheInvalidConfigError,
  addIfAbsent,
  createMemoryCache,
  decrement,
  increment,
  memoize,
  pull,
} from "../src/index.js";
import { createFakeClock } from "../src/testing.js";

describe("counters", () => {
  it("increments from zero and by custom steps", async () => {
    const cache = createMemoryCache();
    expect(await increment(cache, "hits")).toBe(1);
    expect(await increment(cache, "hits", { by: 4 })).toBe(5);
    expect(await decrement(cache, "hits", { by: 2 })).toBe(3);
    expect(await cache.get("hits")).toBe(3);
  });

  it("serialises concurrent increments", async () => {
    const cache = createMemoryCache();
    await Promise.all(Array.from({ length: 20 }, () => increment(cache, "n")));
    expect(await cache.get("n")).toBe(20);
  });

  it("applies the ttl only when the counter window starts", async () => {
    const clock = createFakeClock();
    const cache = createMemoryCache({ clock: clock.now });
    await increment(cache, "window", { ttl: "1s", clock: clock.now });
    clock.advance(600);
    await increment(cache, "window", { ttl: "1s", clock: clock.now });
    clock.advance(500);
    expect(await cache.get("window")).toBeUndefined();
    expect(await increment(cache, "window", { ttl: "1s", clock: clock.now })).toBe(1);
  });

  it("rejects non-numeric stored values and invalid steps", async () => {
    const cache = createMemoryCache();
    await cache.set("text", "abc");
    await expect(increment(cache, "text")).rejects.toBeInstanceOf(CacheInvalidConfigError);
    await expect(increment(cache, "x", { by: Number.NaN })).rejects.toBeInstanceOf(
      CacheInvalidConfigError,
    );
  });
});

describe("addIfAbsent and pull", () => {
  it("stores only when the key is missing", async () => {
    const cache = createMemoryCache();
    expect(await addIfAbsent(cache, "k", 1)).toBe(true);
    expect(await addIfAbsent(cache, "k", 2)).toBe(false);
    expect(await cache.get("k")).toBe(1);
  });

  it("reads and deletes in one call", async () => {
    const cache = createMemoryCache();
    await cache.set("once", "token");
    expect(await pull(cache, "once")).toBe("token");
    expect(await pull(cache, "once")).toBeUndefined();
  });
});

describe("memoize", () => {
  it("caches results per argument key", async () => {
    const cache = createMemoryCache();
    let calls = 0;
    const square = memoize(
      cache,
      async (n: number) => {
        calls++;
        return n * n;
      },
      { key: (n) => `square:${n}`, ttl: "1m" },
    );
    expect(await square(3)).toBe(9);
    expect(await square(3)).toBe(9);
    expect(await square(4)).toBe(16);
    expect(calls).toBe(2);
  });

  it("supports tags derived from arguments", async () => {
    const cache = createMemoryCache();
    let calls = 0;
    const load = memoize(cache, async (id: string) => ({ id, n: ++calls }), {
      key: (id) => `user:${id}`,
      tags: (id) => [`user:${id}`],
    });
    await load("a");
    await cache.invalidateTags(["user:a"]);
    expect((await load("a")).n).toBe(2);
  });
});
