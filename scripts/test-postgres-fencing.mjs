#!/usr/bin/env node
// Runs the Antigravity PostgreSQL fencing suite against a disposable cluster
// that the caller supplies in DURINDOOR_TEST_PG_URL. The script never starts,
// stops or reaches a container runtime itself. Vitest gets an allowlisted
// environment, so container-runtime, cloud and app credentials of the caller
// never reach it. The run fails when the URL is absent, when the cluster is
// unreachable, or when any expected fencing test is skipped or missing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const FENCING_TEST_FILE = "unit/antigravity-lease-postgres.test.js";
export const FENCING_TIMEOUT_MS = 240_000;
const SUITE = "Antigravity management fence on disposable PostgreSQL";
export const REQUIRED_FENCING_TESTS = [
  `${SUITE} blocks replay after fencing a dispatched exchange (delete: false)`,
  `${SUITE} blocks replay after fencing a dispatched exchange (delete: true)`,
  `${SUITE} grants exactly one lease when separate processes race one connection`,
  `${SUITE} never leaves a replayable lease when fencing races dispatch`,
  `${SUITE} keeps a dispatch uncertain after management fencing and worker death`,
];

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fencingDatabaseUrl(env) {
  const raw = env.DURINDOOR_TEST_PG_URL;
  if (!raw) throw new Error("DURINDOOR_TEST_PG_URL is required; point it at a disposable PostgreSQL cluster");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DURINDOOR_TEST_PG_URL is not a valid URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DURINDOOR_TEST_PG_URL must use the postgres: or postgresql: scheme");
  }
  return raw;
}

export function buildFencingRun({ env, workDir, root = repoDir }) {
  const testsDir = path.join(root, "tests");
  const reportFile = path.join(workDir, "fencing-results.json");
  return {
    command: process.execPath,
    args: [
      path.join(testsDir, "node_modules/vitest/vitest.mjs"),
      "run",
      FENCING_TEST_FILE,
      "--maxWorkers=1",
      "--reporter=verbose",
      "--reporter=json",
      `--outputFile.json=${reportFile}`,
    ],
    cwd: testsDir,
    reportFile,
    // Allowlist only: nothing else from the caller's environment is inherited.
    env: {
      PATH: env.PATH || "/usr/bin:/bin",
      HOME: path.join(workDir, "home"),
      DATA_DIR: path.join(workDir, "data"),
      TMPDIR: path.join(workDir, "tmp"),
      CI: "true",
      NODE_ENV: "test",
      DURINDOOR_TEST_PG_URL: fencingDatabaseUrl(env),
      DURINDOOR_TEST_PG_REQUIRED: "1",
    },
  };
}

export function assertFencingReport(report) {
  const tests = (report?.testResults || []).flatMap((suite) => suite.assertionResults || []);
  const byName = new Map(tests.map((test) => [test.fullName, test.status]));
  const missing = REQUIRED_FENCING_TESTS.filter((name) => !byName.has(name));
  if (missing.length) throw new Error(`PostgreSQL fencing tests missing: ${missing.join("; ")}`);
  const notPassed = tests.filter((test) => test.status !== "passed");
  if (notPassed.length) {
    throw new Error(`PostgreSQL fencing tests not passed: ${notPassed.map((t) => `${t.fullName} [${t.status}]`).join("; ")}`);
  }
  if (report.success !== true) throw new Error("Vitest report is not successful");
  return tests.length;
}

export function runFencing(env = process.env) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-pg-fencing-"));
  try {
    const run = buildFencingRun({ env, workDir });
    for (const dir of [run.env.HOME, run.env.DATA_DIR, run.env.TMPDIR]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const child = spawnSync(run.command, run.args, {
      cwd: run.cwd, env: run.env, stdio: "inherit", timeout: FENCING_TIMEOUT_MS, killSignal: "SIGKILL",
    });
    if (child.error) throw child.error;
    if (child.signal) throw new Error(`Vitest terminated by ${child.signal}`);
    if (!fs.existsSync(run.reportFile)) throw new Error(`Vitest exited ${child.status} without a report`);
    const count = assertFencingReport(JSON.parse(fs.readFileSync(run.reportFile, "utf8")));
    if (child.status !== 0) throw new Error(`Vitest exited ${child.status}`);
    return count;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = runFencing();
    console.log(`PostgreSQL fencing: ${count} tests passed`);
  } catch (error) {
    console.error(`PostgreSQL fencing failed: ${error.message}`);
    process.exit(1);
  }
}
