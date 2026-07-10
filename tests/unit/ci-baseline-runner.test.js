import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readFreshReport, validateVitestExecution } from "../__baseline__/run-ci.mjs";
import { addedBaselineEntries } from "../__baseline__/verify-baseline-diff.mjs";

describe("fail-closed CI runner", () => {
  it("rejects a stale report instead of reusing it after startup failure", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ci-report-"));
    try {
      const report = path.join(dir, "report.json");
      fs.writeFileSync(report, JSON.stringify({ testResults: [] }));
      const stale = new Date(Date.now() - 60_000);
      fs.utimesSync(report, stale, stale);
      expect(() => readFreshReport(report, Date.now())).toThrow(/stale/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects startup and collection failures even when no assertion failed", () => {
    expect(() => validateVitestExecution({ testResults: [] }, 1)).toThrow(/zero test suites/);
    expect(() => validateVitestExecution({
      testResults: [{ name: "broken.test.js", status: "failed", assertionResults: [] }],
    }, 1)).toThrow(/zero tests/);
    expect(() => validateVitestExecution({
      testResults: [{
        name: "after-all.test.js",
        status: "failed",
        assertionResults: [{ fullName: "passes", status: "passed" }],
      }],
    }, 1)).toThrow(/collection failed/);
  });

  it("rejects infrastructure exit codes and report/exit mismatches", () => {
    const failed = {
      success: false,
      testResults: [{
        name: "known-failure.test.js",
        status: "failed",
        assertionResults: [{ fullName: "known failure", status: "failed" }],
      }],
    };
    expect(() => validateVitestExecution(failed, 2)).toThrow(/infrastructure status 2/);
    expect(() => validateVitestExecution(failed, 0)).toThrow(/exited 0/);
    expect(() => validateVitestExecution({
      success: false,
      testResults: [{
        name: "passing.test.js",
        status: "passed",
        assertionResults: [{ fullName: "passes", status: "passed" }],
      }],
    }, 0)).toThrow(/report\/exit status mismatch/);
  });

  it("distinguishes forbidden baseline additions from allowed deletions", () => {
    expect(addedBaselineEntries("@@\n-old failure\n")).toEqual([]);
    expect(addedBaselineEntries("@@\n+new failure\n")).toEqual(["new failure"]);
  });
});
