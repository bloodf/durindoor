import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("retired compact combo service", () => {
  it("removes the unused service and its source references", () => {
    expect(existsSync(resolve(root, "open-sse/services/compact.js"))).toBe(false);
    const trackedFiles = execFileSync("git", ["ls-files", "-z", "--", "src", "open-sse", "cli", "scripts"], {
      cwd: root,
      encoding: "utf8",
    });
    const references = trackedFiles
      .split("\0")
      .filter((file) => file && readFileSync(resolve(root, file), "utf8").includes("compact.js"));
    expect(references).toEqual([]);
  });
});
