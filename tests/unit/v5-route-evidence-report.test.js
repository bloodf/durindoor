import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildV5EvidenceReport } from "../utils/v5EvidenceReport.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("V5 evidence report", () => {
  it("uses the candidate override and preserves report fields", () => {
    const cases = [{ pass: true }];
    const report = buildV5EvidenceReport(cases, root, { V5_EVIDENCE_CANDIDATE: "chosen-commit" });
    expect(report.candidate).toBe("chosen-commit");
    expect(report.cases).toBe(cases);
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });

  it("falls back to the repository HEAD", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    expect(buildV5EvidenceReport([], root, {}).candidate).toBe(head);
  });

  it("uses null when git cannot resolve HEAD, without a hard-coded SHA", () => {
    expect(buildV5EvidenceReport([], resolve(root, "missing-directory"), {}).candidate).toBeNull();
    const browserTest = readFileSync(resolve(root, "tests/unit/v5-route-evidence.browser.test.js"), "utf8");
    expect(browserTest).not.toContain("31cfbb7d70c1");
  });
});
