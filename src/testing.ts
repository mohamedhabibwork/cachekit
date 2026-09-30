import { createMemoryCache } from "./memory.js";
import type { Cache } from "./core.js";

/** Basic provider contract checks, reusable by provider authors. */
export async function runCacheContract(create: () => Promise<Cache> | Cache): Promise<void> {
  const cache = await create();
  try {
    if ((await cache.get("missing")) !== undefined)
      throw new Error("A missing value must return undefined.");
    await cache.set("null", null, { ttl: "1s" });
    if ((await cache.get("null")) !== null) throw new Error("The cache must preserve null values.");
    await cache.set("tagged", "value", { tags: ["contract"] });
    await cache.invalidateTags(["contract"]);
    if ((await cache.get("tagged")) !== undefined) throw new Error("Tag invalidation failed.");
  } finally {
    await cache.close();
  }
}
export function createFakeClock(start = 0): {
  now: () => number;
  advance: (milliseconds: number) => void;
} {
  let value = start;
  return {
    now: () => value,
    advance: (milliseconds) => {
      value += milliseconds;
    },
  };
}
export { createMemoryCache };
