import path from "node:path";
import { validateVitestExecution } from "./run-ci.mjs";
import { analyzeVitestReport } from "./verify-no-regression.mjs";

// Sequential commands retain the complete configured inventory and normal isolation.
export function partitionInventory(entries, tests, count = 4) {
  if (!Array.isArray(entries) || !entries.length) throw new Error("empty test inventory");
  const files = entries.map(({ file }) => {
    if (typeof file !== "string") throw new Error("invalid inventory file");
    const relative = path.relative(tests, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".test.js")) {
      throw new Error("test outside inventory root");
    }
    return relative.split(path.sep).join("/");
  }).sort();
  if (new Set(files).size !== files.length) throw new Error("duplicate inventory file");
  if (!Number.isInteger(count) || count < 1 || files.length < count) throw new Error("invalid batch count");
  return Array.from({ length: count }, (_, index) => files.filter((_, i) => i % count === index));
}

export function mergeBatchReports(batches, reports, tests) {
  if (!batches.length || batches.length !== reports.length) throw new Error("missing batch report");
  const expected = batches.flat();
  if (new Set(expected).size !== expected.length) throw new Error("duplicate batch inventory");
  for (let i = 0; i < batches.length; i++) {
    validateVitestExecution(reports[i], 0);
    const actual = reports[i].testResults.map(s => path.relative(tests, s.name).split(path.sep).join("/")).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...batches[i]].sort())) throw new Error("batch collection mismatch");
  }
  const merged = { success: true, testResults: reports.flatMap(r => r.testResults), numRuntimeErrorTestSuites: 0 };
  for (const key of ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites"]) {
    merged[key] = reports.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
  }
  if (analyzeVitestReport(merged, new Set()).regressions.length) throw new Error("test regressions");
  return merged;
}

