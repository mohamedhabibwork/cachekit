import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard for the flat src layout.
 *
 * Dependency direction (bottom-up):
 *   core.ts             — contracts and helpers. Leaf: no internal imports.
 *   memory.ts, redis.ts — provider implementations over core only.
 *   redis-compatible.ts — base for Redis-protocol providers; may extend redis.ts.
 *   <provider>.ts       — Redis-protocol services (valkey, dragonfly, elasticache,
 *                         memorystore, azure-redis). Extend redis-compatible only;
 *                         never import a sibling provider.
 *   testing.ts          — the in-memory fake; core + memory only.
 *   helpers.ts, layered.ts, namespaced.ts — contract-level utilities; core only.
 *   manager.ts          — named multi-cache manager; core + the factory only.
 *   index.ts            — composition / public API. Unrestricted.
 *
 * A violation means a provider reached across its boundary; fix the dependency
 * direction instead of widening the allow-list unless ARCHITECTURE.md agrees.
 */

const SRC = resolve(import.meta.dirname, "../src");

/** Which internal modules each src file may import directly. */
const allowedImports: Record<string, string[]> = {
  "core.ts": [],
  "logger.ts": [],
  "memory.ts": ["core.ts"],
  "redis.ts": ["core.ts"],
  "redis-compatible.ts": ["core.ts", "redis.ts"],
  "valkey.ts": ["redis-compatible.ts"],
  "dragonfly.ts": ["redis-compatible.ts"],
  "elasticache.ts": ["redis-compatible.ts"],
  "memorystore.ts": ["redis-compatible.ts"],
  "azure-redis.ts": ["redis-compatible.ts"],
  "testing.ts": ["core.ts", "memory.ts"],
  "helpers.ts": ["core.ts"],
  "layered.ts": ["core.ts"],
  "namespaced.ts": ["core.ts"],
  "manager.ts": ["core.ts", "index.ts", "logger.ts"],
};

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

function relativeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const statement =
    /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"](\.[^'"]*)['"]|\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g;
  return [...text.matchAll(statement)]
    .map((match) => match[1] ?? match[2]!)
    .map((spec) =>
      relative(SRC, resolve(file, "..", spec.replace(/\.js$/, ".ts")))
        .split("\\")
        .join("/"),
    );
}

describe("architecture", () => {
  it("keeps every module inside its dependency boundary", () => {
    const violations: string[] = [];
    for (const file of tsFiles(SRC)) {
      const fileRel = relative(SRC, file).split("\\").join("/");
      if (fileRel === "index.ts") continue; // composition layer
      const allowed = allowedImports[fileRel];
      if (!allowed)
        throw new Error(
          `Unmapped module in architecture guard: ${fileRel}. Add its allowed imports.`,
        );
      for (const target of relativeImports(file)) {
        if (!allowed.includes(target)) violations.push(`${fileRel} -> ${target}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
