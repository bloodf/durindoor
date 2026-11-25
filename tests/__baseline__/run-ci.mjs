import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { analyzeVitestReport, printAnalysis } from "./verify-no-regression.mjs";
import { verifyBaselineDiff } from "./verify-baseline-diff.mjs";
import { writeDiagnosticJunit, writeJunitReport } from "./junit.mjs";
import {
  combineBatchReports, fullBatchArgs, mandatoryTestInventory, missingFromDiscovery, partitionInventory,
} from "./full-batches.mjs";

import { validateCompletedReportStates } from "./report-states.mjs";

const testsDir = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(testsDir, "..");
const reportPath = path.join(testsDir, ".test-results.json");
const junitPath = path.join(testsDir, ".test-results.junit.xml");
const inventoryPath = path.join(testsDir, ".full-inventory.json");
const batchReportPath = (index) => path.join(testsDir, `.full-batch-${index + 1}.json`);

// Every command in the gate has a five-minute ceiling, including kill grace.
export const COMMAND_TIMEOUT_MS = 300_000;

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
  validateCompletedReportStates(report);
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

function killGroup(pid) {
  try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
}

// Runs one command in its own process group; on timeout the whole group
// (Vitest and its forks) is killed and the result is marked timedOut.
export function runSupervised(command, args, { cwd, env = process.env, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: "inherit", detached: true });
    } catch (error) {
      resolve({ code: null, signal: null, timedOut: false, error, startedAt, durationMs: 0 });
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      // Reap fork workers a crashed or killed runner may leave behind.
      if (child.pid) killGroup(child.pid);
      resolve({ timedOut, startedAt, durationMs: Date.now() - startedAt, ...result });
    };
    child.on("error", (error) => finish({ code: null, signal: null, error }));
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}

function assertCompleted(label, result) {
  if (result.error) throw result.error;
  if (result.timedOut) throw new Error(`${label} exceeded the ${COMMAND_TIMEOUT_MS}ms command ceiling`);
}

function trackedTestPaths() {
  const result = spawnSync("git", ["ls-files", "-z", "--", "tests"], { cwd: repoRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`cannot list the tracked test inventory: ${result.error?.message || result.stderr.trim()}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

async function discoverBatches(vitestBin, env) {
  const result = await runSupervised(process.execPath,
    [vitestBin, "list", "--filesOnly", `--json=${inventoryPath}`], { cwd: testsDir, env });
  assertCompleted("Vitest discovery", result);
  if (result.code !== 0) throw new Error(`Vitest discovery exited ${result.code ?? result.signal}`);
  const batches = partitionInventory(readFreshReport(inventoryPath, result.startedAt), testsDir);
  const mandatory = mandatoryTestInventory(trackedTestPaths(),
    { hasCloud: fs.existsSync(path.join(repoRoot, "cloud")) });
  const missing = missingFromDiscovery(batches, mandatory);
  if (missing.length > 0) {
    throw new Error(`Vitest discovery missed ${missing.length} tracked test file(s): ${missing.slice(0, 5).join(", ")}`);
  }
  return batches;
}

export async function runCi({ env = process.env } = {}) {
  for (const file of [reportPath, junitPath, inventoryPath]) fs.rmSync(file, { force: true });
  const vitestBin = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const batches = await discoverBatches(vitestBin, env);
  console.log(`test:ci: ${batches.flat().length} files in ${batches.length} sequential batches`);

  const reports = [];
  for (let i = 0; i < batches.length; i++) {
    const file = batchReportPath(i);
    fs.rmSync(file, { force: true });
    console.log(`test:ci: batch ${i + 1}/${batches.length} start (${batches[i].length} files)`);
    const result = await runSupervised(process.execPath, fullBatchArgs(testsDir, batches[i], file), { cwd: testsDir, env });
    assertCompleted(`Vitest batch ${i + 1}`, result);
    const report = readFreshReport(file, result.startedAt);
    validateVitestExecution(report, result.code ?? 1, result.signal);
    console.log(`test:ci: batch ${i + 1}/${batches.length} finished in ${(result.durationMs / 1000).toFixed(1)}s`);
    reports.push(report);
  }

  const merged = combineBatchReports(batches, reports, testsDir);
  fs.writeFileSync(reportPath, `${JSON.stringify(merged)}\n`);
  writeJunitReport(merged, junitPath);
  const analysis = analyzeVitestReport(merged);
  printAnalysis(analysis);
  verifyBaselineDiff();
  if (analysis.regressions.length > 0) {
    throw new Error(`${analysis.regressions.length} test regression(s) are outside the baseline`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCi().catch((error) => {
    ensureDiagnosticArtifacts(error);
    console.error(`CI test gate failed: ${error.message}`);
    process.exit(1);
  });
}
