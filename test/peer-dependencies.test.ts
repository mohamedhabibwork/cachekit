import { describe, expect, it } from "vitest";
import { CacheDependencyMissingError, createMemoryCache } from "../src/index.js";
import { createRedisCache } from "../src/redis.js";

/**
 * CacheKit must stay useful with zero provider SDKs installed: the memory
 * provider and any Redis-protocol provider backed by an injected client work
 * out of the box, and only auto-creating a connection reaches for the
 * optional "redis" package — with an install hint if it is missing.
 */
describe("optional peer dependencies", () => {
  it("runs the memory provider with no SDK installed", async () => {
    const cache = await createMemoryCache({ defaultTtl: "1m" });
    await cache.set("product:42", { id: 42 });
    expect(await cache.get("product:42")).toEqual({ id: 42 });
    await cache.close();
  });

  it("hints at the install command when the redis SDK is absent and no client is injected", async () => {
    await expect(createRedisCache({ url: "redis://localhost:6379" })).rejects.toThrow(
      CacheDependencyMissingError,
    );
    await expect(createRedisCache({ url: "redis://localhost:6379" })).rejects.toThrow(
      /npm install redis/,
    );
  });

  it("never loads the redis SDK when a compatible client is injected", async () => {
    const store = new Map<string, string>();
    const client = {
      isOpen: true,
      sendCommand: async (command: readonly string[]): Promise<string | null | number> => {
        const [op, key, ...rest] = command;
        switch (op) {
          case "SET":
            store.set(key!, rest[0]!);
            return "OK";
          case "GET":
            return store.get(key!) ?? null;
          case "DEL":
            return store.delete(key!) ? 1 : 0;
          default:
            return "OK";
        }
      },
      quit: async () => {},
    };
    const cache = await createRedisCache({ client });
    await cache.set("product:42", { id: 42 });
    expect(await cache.get("product:42")).toEqual({ id: 42 });
    await cache.close();
  });
});
