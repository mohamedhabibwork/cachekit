import { describe, expect, it } from "vitest";
import { createLayeredCache, createMemoryCache, namespaced } from "../src/index.js";

function layers() {
  const l1 = createMemoryCache();
  const l2 = createMemoryCache();
  return { l1, l2, cache: createLayeredCache({ l1, l2, l1Ttl: "10s" }) };
}

describe("createLayeredCache", () => {
  it("writes through both tiers and reads L1 first", async () => {
    const { l1, l2, cache } = layers();
    await cache.set("k", "v", { ttl: "1m" });
    expect(await l1.get("k")).toBe("v");
    expect(await l2.get("k")).toBe("v");
    await l1.set("k", "l1-only");
    expect(await cache.get("k")).toBe("l1-only");
  });

  it("backfills L1 from L2 on a miss", async () => {
    const { l1, l2, cache } = layers();
    await l2.set("k", { a: 1 }, { tags: ["t"] });
    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(await l1.get("k")).toEqual({ a: 1 });
    const many = await cache.getMany(["k", "missing"]);
    expect([...many.keys()]).toEqual(["k"]);
  });

  it("deletes and invalidates tags in both tiers", async () => {
    const { l1, l2, cache } = layers();
    await cache.set("a", 1, { tags: ["t"] });
    await cache.set("b", 2);
    await cache.invalidateTags(["t"]);
    expect(await l1.get("a")).toBeUndefined();
    expect(await l2.get("a")).toBeUndefined();
    expect((await cache.delete("b")).deleted).toBe(true);
    expect(await cache.has("b")).toBe(false);
  });

  it("getOrSet loads once and populates both tiers", async () => {
    const { l1, l2, cache } = layers();
    let calls = 0;
    const loader = async () => ++calls;
    expect(await cache.getOrSet("k", loader)).toBe(1);
    expect(await cache.getOrSet("k", loader)).toBe(1);
    expect(calls).toBe(1);
    expect(await l1.get("k")).toBe(1);
    expect(await l2.get("k")).toBe(1);
  });

  it("reports L2 capabilities and combined health", async () => {
    const { l2, cache } = layers();
    expect(cache.capabilities).toBe(l2.capabilities);
    expect(cache.type).toBe("memory");
    const health = await cache.health();
    expect(health.status).toBe("ok");
    expect(health.provider).toBe("layered");
  });
});

describe("namespaced", () => {
  it("prefixes keys and maps getMany results back", async () => {
    const base = createMemoryCache();
    const tenant = namespaced(base, "tenant-a");
    await tenant.set("user:1", "alice");
    expect(await base.get("tenant-a:user:1")).toBe("alice");
    expect(await tenant.get("user:1")).toBe("alice");
    expect([...(await tenant.getMany(["user:1"])).entries()]).toEqual([["user:1", "alice"]]);
    expect(await namespaced(base, "tenant-b").get("user:1")).toBeUndefined();
    await expect(tenant.clear()).rejects.toThrow(/namespaced/);
  });

  it("rejects empty prefixes", () => {
    expect(() => namespaced(createMemoryCache(), "")).toThrow();
  });
});
