import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const oldAlias = "@/" + "models";
const oldPath = "src/" + "models";

function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

describe("retired models barrel", () => {
  it("has no remaining imports or mocks and no barrel file", () => {
    const references = ["src", "open-sse", "tests"].flatMap((dir) =>
      filesIn(join(root, dir)).filter((path) => /\.[cm]?[jt]sx?$/.test(path)).filter((path) => {
        const source = readFileSync(path, "utf8");
        return source.includes(oldAlias) || source.includes(oldPath);
      })
    );
    expect(references).toEqual([]);
    expect(existsSync(join(root, oldPath, "index.js"))).toBe(false);
  });
});
