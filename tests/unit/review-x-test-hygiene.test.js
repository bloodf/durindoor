import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const unitRoot = new URL("./", import.meta.url);

describe("issue 2300 test hygiene", () => {
  it("does not collect the duplicate Antigravity shim or the DB benchmark", () => {
    expect(existsSync(new URL("./antigravity-schema-fallback.test.js", unitRoot))).toBe(false);
    expect(existsSync(new URL("./db-benchmark.test.js", unitRoot))).toBe(false);

    const benchmarkPath = new URL("../bench/db-benchmark.bench.js", import.meta.url);
    expect(existsSync(benchmarkPath)).toBe(true);
    expect(benchmarkPath.pathname).not.toMatch(/\.test\.js$/);

    const config = readFileSync(new URL("../vitest.config.js", import.meta.url), "utf8");
    expect(config).toContain('include: ["**/*.test.js"]');
  });
});
