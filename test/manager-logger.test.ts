import { describe, expect, it, vi } from "vitest";
import { createCacheManager, type KitLogger } from "../src/index.js";

const spyLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn<KitLogger["error"]>(),
});

describe("manager logger integration", () => {
  it("reports provider creation failures to the injected logger and retries later", async () => {
    const logger = spyLogger();
    const manager = createCacheManager({
      default: "bad",
      caches: { bad: { type: "does-not-exist" } as never },
      logger,
    });

    await expect(manager.cache("bad")).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[1]).toBeInstanceOf(Error);

    await expect(manager.cache("bad")).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(2); // failed instance was evicted
  });
});
