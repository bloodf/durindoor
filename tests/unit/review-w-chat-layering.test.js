import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../src/sse/", import.meta.url);
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("chat layering", () => {
  it("keeps SSE imports independent of API routes", () => {
    const violations = sources(root.pathname).filter((path) => /(?:from\s*|import\s*(?:\(\s*)?)\s*["'][^"']*(?:app\/api\/)[^"']*["']/.test(readFileSync(path, "utf8")));
    expect(violations).toEqual([]);
  });

  it("does not import combo from single-model handling", () => {
    const dir = new URL("../../src/sse/handlers/chat/singleModel/", import.meta.url);
    const files = [new URL("../../src/sse/handlers/chat/singleModel.js", import.meta.url), ...readdirSync(dir).map((name) => new URL(name, dir))];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/(?:from\s*|import\s*(?:\(\s*)?)\s*["'](?:\.\.?\/)+(?:chat\/)?combo\.js["']/);
    }
  });
});
