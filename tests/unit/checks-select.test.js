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
    ])).toEqual(expect.objectContaining({
      eslint: ["src/app/page.js"],
      tests: ["unit/checks-select.test.js"],
    }));
  });

  it("selects importers of a source hub and leaves unrelated files empty", () => {
    expect(selectChecks(["open-sse/handlers/chatCore.js"]).related).toContain("unit/zcode-provider.test.js");
    expect(selectChecks(["scripts/checks-select.mjs"]).related).toContain("unit/checks-select.test.js");
    expect(selectChecks(["scripts/bench-" + "db-queries.mjs"]).related).toEqual([]);
  });

  it("does not select documentation", () => {
    expect(selectChecks(["AGENTS.md"])).toEqual({ eslint: [], tests: [], related: [] });
  });

  it("selects tests mentioning deleted source basenames and requires full lint", () => {
    expect(selectChecks([], ["src/checks-select.mjs"])).toEqual({
      eslint: [],
      tests: ["unit/checks-select.test.js"],
      related: ["unit/checks-select.test.js"],
      fullLint: true,
    });
    expect(selectChecks(["AGENTS.md"], [])).toEqual(selectChecks(["AGENTS.md"]));
  });

  it("caps test workers", () => {
    expect(read("scripts/checks.sh")).toContain("--maxWorkers=50%");
    expect(read("playwright.config.mjs")).toMatch(/workers: Math\.min\(2,/);
    expect(read("website/playwright.config.mjs")).toMatch(/workers: 2/);
  });

  it("does not wrap test:ci in an outer timeout", () => {
    const script = read("scripts/checks.sh");
    const testCiLines = script.split("\n").filter((line) => line.includes("test:ci") && !line.trim().startsWith("#"));
    expect(testCiLines.length).toBeGreaterThan(0);
    for (const line of testCiLines) expect(line).not.toMatch(/timeout 300|\brun sh\b/);
    expect(script).toMatch(/timeout 300 "\$@"/);
    expect(script).toContain("run pnpm run lint\n");
  });

  it("passes unit vitest runs when no test matches", () => {
    const vitestLines = read("scripts/checks.sh").split("\n").filter((line) => line.includes("vitest.mjs"));
    expect(vitestLines).toHaveLength(2);
    expect(read("scripts/checks.sh")).not.toContain("vitest.mjs related");
    for (const line of vitestLines) expect(line).toContain("--passWithNoTests");
  });
});
