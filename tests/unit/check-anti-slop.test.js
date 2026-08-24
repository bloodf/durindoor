/**
 * Unit tests for the anti-slop gate runner (clean-tree mode, no baseline).
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOxlint } from "../../scripts/check-anti-slop.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("check-anti-slop", () => {
  it("exposes runOxlint that returns a JSON report shape", () => {
    expect(existsSync(path.join(ROOT, "node_modules/oxlint/bin/oxlint"))).toBe(true);
    expect(typeof runOxlint).toBe("function");
  });

  it("reports diagnostics as an array on the JSON report", () => {
    // Lint only the typeChecks helper (must stay typeof-free and clean).
    const { report } = runOxlint({
      args: [
        "-c",
        path.join(ROOT, ".oxlintrc.json"),
        "--quiet",
        "-f",
        "json",
        "src/shared/utils/typeChecks.js",
      ],
    });
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});
