import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const baselineDir = join(repoRoot, "tests/__baseline__");
const documentedExceptions = new Set([
  "baseline-results.json",
  "known-fails.txt",
  "verify-no-regression.mjs",
]);

describe("baseline inventory", () => {
  it("keeps every baseline file referenced or explicitly documented", () => {
    const files = readdirSync(baselineDir).sort();
    const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .filter((file) => file !== relative(repoRoot, import.meta.filename));

    const unreferenced = files.filter((file) => {
      if (documentedExceptions.has(file)) return false;
      return !trackedFiles.some((trackedFile) => {
        try {
          return readFileSync(join(repoRoot, trackedFile), "utf8").includes(file);
        } catch {
          return false;
        }
      });
    });

    expect(unreferenced).toEqual([]);
  });
});
