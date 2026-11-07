import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateVitestExecution } from "../__baseline__/run-ci.mjs";
import { mergeBatchReports } from "../__baseline__/full-batches.mjs";
import { writeJunitReport } from "../__baseline__/junit.mjs";
import { validateTestReport } from "../../scripts/local-ci.mjs";

const suite = (name, status = "passed", assertionStatus = "passed") => ({
  name, status, assertionResults: [{ fullName: "completion", status: assertionStatus }],
});

describe("completed Vitest report states", () => {
  it.each(["pending", "running", "queued", "unknown", "disabled", null, undefined])(
    "rejects unfinished or unsupported assertion state %s before acceptance, aggregation or JUnit", (status) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "report-states-"));
      try {
        const unfinished = suite(path.join(dir, "b.test.js"));
        unfinished.assertionResults[0].status = status;
        const report = { success: true, testResults: [suite(path.join(dir, "a.test.js")), unfinished] };
        const file = path.join(dir, "report.json");
        writeFileSync(file, JSON.stringify(report));
        expect(() => validateVitestExecution(report, 0)).toThrow(/state|status/);
        expect(() => validateTestReport(file, Date.now() - 1000, 0, null, dir)).toThrow(/state|status/);
        expect(() => mergeBatchReports([["a.test.js", "b.test.js"]], [report], dir)).toThrow(/state|status/);
        expect(() => writeJunitReport(report, path.join(dir, "report.xml"))).toThrow(/state|status/);
        expect(existsSync(path.join(dir, "report.xml"))).toBe(false);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  );

  it.each(["pending", "running", "unknown", "skipped", null, undefined])(
    "rejects unsupported suite state %s alongside a passing suite", (status) => {
      const bad = suite("b.test.js");
      bad.status = status;
      expect(() => validateVitestExecution({ success: true, testResults: [suite("a.test.js"), bad] }, 0)).toThrow(/state|status/);
    },
  );

  it("rejects malformed suite and assertion collections", () => {
    for (const bad of [null, {}, { status: "passed" }, { status: "passed", assertionResults: {} },
      { status: "passed", assertionResults: [null] }, { status: "passed", assertionResults: [{}] }]) {
      expect(() => validateVitestExecution({ testResults: [suite("a.test.js"), bad] }, 0)).toThrow();
    }
  });

  it("preserves explicit skipped/todo assertions as skips in completed suites", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "report-skips-"));
    try {
      const report = { success: true, testResults: [suite(path.join(dir, "a.test.js")),
        suite(path.join(dir, "b.test.js"), "passed", "skipped"), suite(path.join(dir, "c.test.js"), "passed", "todo")] };
      expect(() => validateVitestExecution(report, 0)).not.toThrow();
      const merged = mergeBatchReports([["a.test.js", "b.test.js", "c.test.js"]], [report], dir);
      const file = path.join(dir, "report.xml");
      writeJunitReport(merged, file);
      expect(readFileSync(file, "utf8")).toContain('failures="0" skipped="2"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
