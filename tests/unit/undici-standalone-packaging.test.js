import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// scripts/build-app.mjs copies only the undici package dir into the standalone
// bundle. That is the full closure only while undici has no runtime deps; if a
// bump adds one, the shipped bundle fails with ERR_MODULE_NOT_FOUND again.
describe("standalone undici copy", () => {
  it("undici has no runtime dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "node_modules", "undici", "package.json"), "utf8"),
    );
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
