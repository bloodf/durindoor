import path from "node:path";
import { validateVitestExecution } from "./run-ci.mjs";
import { analyzeVitestReport } from "./verify-no-regression.mjs";

// The repository allows four sequential Vitest commands, four fork workers each.
export const FULL_BATCH_COUNT = 4;
export const FULL_BATCH_WORKERS = 4;

// Sequential commands retain the complete configured inventory and normal isolation.
export function partitionInventory(entries, tests, count = FULL_BATCH_COUNT) {
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

// One batch command: explicit files, per-file isolation in at most four forks.
export function fullBatchArgs(tests, selected, reportFile) {
  return [path.join(tests, "node_modules/vitest/vitest.mjs"), "run", ...selected,
    `--maxWorkers=${FULL_BATCH_WORKERS}`, "--isolate", "--pool=forks", "--reporter=verbose", "--reporter=json",
    `--outputFile.json=${reportFile}`];
}

// Repo-relative tracked paths -> tests/-relative files the configured gate must run.
// Mirrors the exclusions in tests/vitest.config.js.
export function mandatoryTestInventory(trackedPaths, { hasCloud = false } = {}) {
  return trackedPaths.filter(p => p.startsWith("tests/") && p.endsWith(".test.js")
    && !p.endsWith(".live.test.js") && !p.includes("/node_modules/") && !p.includes("/.omc/")
    && !p.includes("/.claude/") && !p.includes("/omp-extension/") && !p.includes("/dist/")
    && !(p.endsWith("/embeddings.cloud.test.js") && !hasCloud)).map(p => p.slice(6)).sort();
}

// Every tracked test must be discovered; returns the tracked files Vitest missed.
export function missingFromDiscovery(batches, mandatory) {
  const discovered = new Set(batches.flat());
  return mandatory.filter(file => !discovered.has(file));
}

// Checks that each batch report covers exactly its batch, then sums the reports.
export function combineBatchReports(batches, reports, tests) {
  if (!batches.length || batches.length !== reports.length) throw new Error("missing batch report");
  const expected = batches.flat();
  if (new Set(expected).size !== expected.length) throw new Error("duplicate batch inventory");
  for (let i = 0; i < batches.length; i++) {
    if (!Array.isArray(reports[i]?.testResults)) throw new Error(`batch ${i + 1} report has no testResults[]`);
    const actual = reports[i].testResults.map(s => path.relative(tests, s.name).split(path.sep).join("/")).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...batches[i]].sort())) throw new Error("batch collection mismatch");
  }
  const merged = {
    success: reports.every(r => r.success === true),
    testResults: reports.flatMap(r => r.testResults),
    numRuntimeErrorTestSuites: reports.reduce((sum, r) => sum + (Number(r.numRuntimeErrorTestSuites) || 0), 0),
    unhandledErrors: reports.flatMap(r => (Array.isArray(r.unhandledErrors) ? r.unhandledErrors : [])),
  };
  for (const key of ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites"]) {
    merged[key] = reports.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
  }
  return merged;
}

// Strict form used by the full checkpoint: every batch must have passed.
export function mergeBatchReports(batches, reports, tests) {
  if (!batches.length || batches.length !== reports.length) throw new Error("missing batch report");
  for (const report of reports) validateVitestExecution(report, 0);
  const merged = { ...combineBatchReports(batches, reports, tests), success: true };
  if (analyzeVitestReport(merged, new Set()).regressions.length) throw new Error("test regressions");
  return merged;
}
