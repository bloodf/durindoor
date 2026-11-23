import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

describe("retired compact combo service", () => {
  it("removes the unused service and its source references", () => {
    expect(existsSync(resolve(root, "open-sse/services/compact.js"))).toBe(false);
    const references = ["src", "open-sse", "cli", "scripts"]
      .flatMap((dir) => sourceFiles(resolve(root, dir)))
      .filter((file) => readFileSync(file, "utf8").includes("compact.js"));
    expect(references).toEqual([]);
  });
});
