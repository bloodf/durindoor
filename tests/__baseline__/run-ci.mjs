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

// ps works on Linux and Darwin. Zombies cannot execute and may remain until
// their parent (or the host reaper) collects them; they are not live workers.
export function processGroupMembers(pid, timeoutMs = 2000) {
  const result = spawnSync("ps", ["-axo", "pid=,pgid=,stat="], {
    encoding: "utf8", timeout: Math.max(1, Math.min(2000, timeoutMs)), maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`cannot inspect command process group: ${result.error?.message || result.stderr}`);
  return result.stdout.trim().split("\n").filter(Boolean).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)$/);
    if (!match) throw new Error("invalid ps process group inventory");
    return { pid: Number(match[1]), group: Number(match[2]), state: match[3] };
  }).filter((row) => row.group === pid && !row.state.startsWith("Z")).map((row) => row.pid);
}

export async function killGroup(pid, { kill = process.kill, members = processGroupMembers,
  deadline = Date.now() + 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("invalid command process group");
  const failures = [];
  try { kill(-pid, "SIGKILL"); }
  catch (error) { if (error.code !== "ESRCH") failures.push(error); }
  // A failed ps is unknown, not an empty group. Reserve time for one last
  // inventory after the final signal, and retry transient listing failures.
  const finalReserve = Math.min(500, Math.max(0, Math.floor((deadline - Date.now()) / 2)));
  let lastError = null;
  const inspect = (reserve = 0) => {
    try { const live = members(pid, Math.max(1, deadline - reserve - Date.now())); lastError = null; return live; }
    catch (error) { lastError = error; return null; }
  };
  while (Date.now() < deadline - finalReserve) {
    const live = inspect(finalReserve);
    if (live && live.length === 0) return;
    if (live) for (const member of live) {
      if (!Number.isInteger(member) || member <= 1 || member === process.pid) throw new Error("unsafe command group member");
      try { kill(member, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") failures.push(error); }
    }
    const delay = Math.min(10, Math.max(0, deadline - finalReserve - Date.now()));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  const final = inspect();
  if (final && final.length === 0) return;
  if (!final) throw new AggregateError([...failures, lastError].filter(Boolean), "command cleanup could not be verified");
  const codes = [...new Set(failures.map((error) => error.code || error.message))].join(", ");
  throw new AggregateError(failures, `command cleanup deadline exceeded; live workers may remain${codes ? ` (${codes})` : ""}`);
}

// Reserve cleanup time inside the command ceiling. Close alone is not proof
// that workers exited; cleanup failures must reach the caller and fail the gate.
export function runSupervised(command, args, { cwd, env = process.env, timeoutMs = COMMAND_TIMEOUT_MS,
  operations = {} } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const grace = Math.min(5000, timeoutMs / 4);
    let child;
    try {
      child = (operations.spawn || spawn)(command, args, { cwd, env, stdio: "inherit", detached: true });
    } catch (error) {
      resolve({ code: null, signal: null, timedOut: false, error, startedAt, durationMs: 0 });
      return;
    }
    let timedOut = false;
    let finishing = false;
    const finish = async (result) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      try {
        if (child.pid) await killGroup(child.pid, { ...operations, deadline: Math.min(deadline, Date.now() + grace) });
      } catch (error) {
        result.error = result.error ? new AggregateError([result.error, error], "command and cleanup failed") : error;
      }
      resolve({ timedOut, startedAt, durationMs: Date.now() - startedAt, ...result });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void finish({ code: null, signal: null });
    }, Math.max(0, timeoutMs - grace));
    child.on("error", (error) => { void finish({ code: null, signal: null, error }); });
    child.on("close", (code, signal) => { void finish({ code, signal }); });
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
