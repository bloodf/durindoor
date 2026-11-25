import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectChecks } from "../../scripts/checks-select.mjs";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

describe("repository check selection", () => {
  it("selects existing source and test files and excludes deleted files", () => {
    expect(selectChecks([
      "src/app/page.js",
      "tests/unit/checks-select.test.js",
      "src/deleted-file.js",
    ])).toEqual({
      eslint: ["src/app/page.js"],
      tests: ["unit/checks-select.test.js"],
      related: ["src/app/page.js"],
    });
  });

  it("does not select documentation", () => {
    expect(selectChecks(["AGENTS.md"])).toEqual({ eslint: [], tests: [], related: [] });
  });

  it("caps test workers", () => {
    expect(read("scripts/checks.sh")).toContain("--maxWorkers=50%");
    expect(read("playwright.config.mjs")).toMatch(/workers: Math\.min\(2,/);
    expect(read("website/playwright.config.mjs")).toMatch(/workers: 2/);
  });
});
