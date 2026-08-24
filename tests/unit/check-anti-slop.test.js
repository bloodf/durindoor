/**
 * Unit tests for the anti-slop baseline gate helpers.
 * Runtime oxlint invocation is covered by `npm run lint:anti-slop` in CI/husky.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateDiagnostics,
  diffAgainstBaseline,
  formatBaseline,
  normalizeDiagnosticFile,
  parseBaseline,
} from "../../scripts/check-anti-slop.mjs";

describe("check-anti-slop helpers", () => {
  it("normalizes absolute paths to repo-relative POSIX paths", () => {
    const root = "/workspace";
    expect(normalizeDiagnosticFile("/workspace/src/foo.js", root)).toBe("src/foo.js");
    expect(normalizeDiagnosticFile("src/bar.js", root)).toBe("src/bar.js");
  });

  it("aggregates error diagnostics by file and rule", () => {
    const counts = aggregateDiagnostics(
      {
        diagnostics: [
          { filename: "a.js", code: "anti-slop(no-runtime-typeof)", severity: "error" },
          { filename: "a.js", code: "anti-slop(no-runtime-typeof)", severity: "error" },
          { filename: "b.js", code: "anti-slop(no-module-mocking)", severity: "error" },
          { filename: "c.js", code: "anti-slop(no-runtime-typeof)", severity: "warning" },
        ],
      },
      "/tmp/root",
    );
    expect(counts.get("a.js\tanti-slop(no-runtime-typeof)")).toBe(2);
    expect(counts.get("b.js\tanti-slop(no-module-mocking)")).toBe(1);
    expect(counts.has("c.js\tanti-slop(no-runtime-typeof)")).toBe(false);
  });

  it("round-trips baseline TSV and rejects bad rows", () => {
    const text = formatBaseline(
      new Map([
        ["z.js\tanti-slop(no-runtime-typeof)", 2],
        ["a.js\tanti-slop(no-module-mocking)", 1],
      ]),
    );
    expect(text).toContain("a.js\tanti-slop(no-module-mocking)\t1");
    expect(text.indexOf("a.js")).toBeLessThan(text.indexOf("z.js"));
    const parsed = parseBaseline(text);
    expect(parsed.get("a.js\tanti-slop(no-module-mocking)")).toBe(1);
    expect(parsed.get("z.js\tanti-slop(no-runtime-typeof)")).toBe(2);
    expect(() => parseBaseline("not-a-row")).toThrow(/invalid baseline row/);
  });

  it("fails on new or increased counts and allows shrinks", () => {
    const baseline = new Map([
      ["a.js\tanti-slop(no-runtime-typeof)", 3],
      ["b.js\tanti-slop(no-module-mocking)", 1],
    ]);
    const current = new Map([
      ["a.js\tanti-slop(no-runtime-typeof)", 4],
      ["c.js\tanti-slop(no-shape-in-symbol-names)", 1],
    ]);
    const { ok, regressions, improvements } = diffAgainstBaseline(current, baseline);
    expect(ok).toBe(false);
    expect(regressions.some((r) => r.includes("REGRESSED a.js"))).toBe(true);
    expect(regressions.some((r) => r.includes("NEW c.js"))).toBe(true);
    expect(improvements.some((r) => r.includes("CLEARED b.js"))).toBe(true);

    const cleaned = diffAgainstBaseline(
      new Map([["a.js\tanti-slop(no-runtime-typeof)", 1]]),
      baseline,
    );
    expect(cleaned.ok).toBe(true);
    expect(cleaned.improvements.length).toBeGreaterThan(0);
  });
});
