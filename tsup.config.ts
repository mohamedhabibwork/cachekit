import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    memory: "src/memory.ts",
    redis: "src/redis.ts",
    valkey: "src/valkey.ts",
    dragonfly: "src/dragonfly.ts",
    elasticache: "src/elasticache.ts",
    memorystore: "src/memorystore.ts",
    "azure-redis": "src/azure-redis.ts",
    testing: "src/testing.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: "es2022",
  external: ["redis"],
});
