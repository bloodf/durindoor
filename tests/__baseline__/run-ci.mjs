import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { analyzeVitestReport, printAnalysis } from "./verify-no-regression.mjs";
import { verifyBaselineDiff } from "./verify-baseline-diff.mjs";
import { writeDiagnosticJunit, writeJunitReport } from "./junit.mjs";

const testsDir = fileURLToPath(new URL("../", import.meta.url));
const reportPath = path.join(testsDir, ".test-results.json");
const junitPath = path.join(testsDir, ".test-results.junit.xml");

export function readFreshReport(file, startedAt) {
  if (!fs.existsSync(file)) throw new Error("Vitest did not create a JSON report");
  const stat = fs.statSync(file);
  if (stat.mtimeMs < startedAt - 1000) throw new Error("Vitest JSON report is stale");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Vitest JSON report is not parseable: ${error.message}`);
  }
}

export function validateVitestExecution(report, exitCode, signal = null) {
  if (signal) throw new Error(`Vitest terminated by signal ${signal}`);
  if (!Array.isArray(report?.testResults)) throw new Error("Vitest report has no testResults[]");
  if (![0, 1].includes(exitCode)) throw new Error(`Vitest exited with infrastructure status ${exitCode}`);
  if (report.testResults.length === 0) throw new Error("Vitest collected zero test suites");
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults || []);
  if (assertions.length === 0) throw new Error("Vitest collected zero tests");
  const collectionFailures = report.testResults.filter(
    (suite) => suite.status === "failed"
      && (!Array.isArray(suite.assertionResults) || !suite.assertionResults.some((test) => test.status === "failed")),
  );
  const runtimeErrors = Number(report.numRuntimeErrorTestSuites || 0)
    + (Array.isArray(report.unhandledErrors) ? report.unhandledErrors.length : 0);
  const assertionFailures = assertions.filter((test) => test.status === "failed").length;
  if (collectionFailures.length > 0) throw new Error(`Vitest collection failed in ${collectionFailures.length} suite(s)`);
  if (runtimeErrors > 0) throw new Error(`Vitest reported ${runtimeErrors} runtime error(s)`);
  if (exitCode === 0 && assertionFailures > 0) throw new Error("Vitest exited 0 despite failed assertions");
  if (exitCode === 1 && assertionFailures === 0) throw new Error("Vitest exited 1 without assertion failures");
  if (report.success === true && assertionFailures > 0) throw new Error("Vitest report marks failed assertions successful");
  if (report.success === false && exitCode === 0) throw new Error("Vitest report/exit status mismatch");
}

function ensureDiagnosticArtifacts(error) {
  let hasParseableJson = false;
  try {
    JSON.parse(fs.readFileSync(reportPath, "utf8"));
    hasParseableJson = true;
  } catch {}
  if (!hasParseableJson) {
    fs.writeFileSync(reportPath, `${JSON.stringify({
      success: false,
      infrastructureError: error?.stack || error?.message || String(error),
      testResults: [],
    }, null, 2)}\n`);
  }
  if (!fs.existsSync(junitPath)) writeDiagnosticJunit(error, junitPath);
}

export function runCi() {
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(junitPath, { force: true });
  const startedAt = Date.now();
  const vitestBin = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [vitestBin, "run", "--reporter=json", `--outputFile=${reportPath}`], {
    cwd: testsDir,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;

  const report = readFreshReport(reportPath, startedAt);
  writeJunitReport(report, junitPath);
  validateVitestExecution(report, result.status ?? 1, result.signal);
  const analysis = analyzeVitestReport(report);
  printAnalysis(analysis);
  verifyBaselineDiff();
  if (analysis.regressions.length > 0) {
    throw new Error(`${analysis.regressions.length} test regression(s) are outside the baseline`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCi();
  } catch (error) {
    ensureDiagnosticArtifacts(error);
    console.error(`CI test gate failed: ${error.message}`);
    process.exit(1);
  }
}
