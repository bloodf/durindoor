#!/usr/bin/env node
// Local CI runner: mirrors the former ci.yml, test.yml and commitlint.yml gates
// against an exact, caller-supplied base/head commit pair. It runs everything
// in a private snapshot with private HOME/pnpm store/DATA_DIR, writes JSON
// evidence, and NEVER publishes a GitHub status. See AGENTS.md.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync, constants, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, rmSync, lstatSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readFreshReport, validateVitestExecution } from "../tests/__baseline__/run-ci.mjs";
import { isString, isFunction } from "../src/shared/utils/typeChecks.js";
import { partitionInventory, mergeBatchReports, fullBatchArgs, mandatoryTestInventory, missingFromDiscovery } from "../tests/__baseline__/full-batches.mjs";
import { writeJunitReport } from "../tests/__baseline__/junit.mjs";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "../tests/utils/chromiumLaunch.mjs";
import { isMainModule } from "./lib/is-main-module.mjs";
import {
  SHARD_OWNER_ENV, SHARD_PORT_ENV, SHARD_STATE_ENV, cleanupShardServer, newShardOwnerToken, reserveLoopbackPort,
} from "./lib/website-shard-server.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
// Unknown or shared-risk paths deliberately require the existing full gate.
export function selectRiskFloor(paths, inventory, deleted = []) {
  const full = { mode: "full", risk: "shared-or-unknown", tests: [] };
  if (deleted.length || paths.some(p => ["AGENTS.md", "internal/docs/testing.mdx", "internal/docs/agent-workflow.md", "internal/docs/local-ci.md"].includes(p))) return full;
  // Exact helper domain only; the base caller is mandatory, with its adjacent suite when present.
  if (paths.length && paths.every(p => ["scripts/upstream-ported-ids.sh", "tests/unit/upstream-watch-filter.test.js",
    "internal/docs/upstream-sync.mdx"].includes(p))) {
    if (!inventory.includes("unit/upstream-watch-filter.test.js")) return full;
    return { mode: "scoped", risk: "upstream-watch", tests: inventory.filter(p => ["unit/upstream-watch-filter.test.js",
      "unit/upstream-watch.test.js"].includes(p)).sort() };
  }
  if (paths.length && paths.every(p => /^(docs\/|internal\/docs\/).*\.(md|mdx)$/.test(p))) {
    return { mode: "scoped", risk: "docs", tests: [] };
  }
  if (paths.length && paths.every(p => /^open-sse\/translator\/(request|response)\/[\w/.-]+\.js$/.test(p)
    || /^tests\/translator\/[\w/.-]+\.test\.js$/.test(p))) {
    const callers = ["unit/media-routes.test.js", "unit/media-routes-api.test.js", "unit/media-routes-handlers.test.js",
      "unit/native-provider.test.js", "unit/gemini-native-endpoint.test.js", "unit/tool-result-missing-id-3362.test.js",
      "unit/stream-terminal-outcome.test.js", "unit/claude-foreign-server-tool-chatcore.test.js",
      "unit/responses-explicit-stream-route.test.js", "unit/openai-responses-stream-tool-identity.test.js"];
    if (callers.some(p => !inventory.includes(p)) || !inventory.some(p => p.startsWith("translator/"))) return full;
    return { mode: "scoped", risk: "translator", tests: inventory.filter(p => p.startsWith("translator/") || callers.includes(p)).sort() };
  }
  return { mode: "full", risk: "shared-or-unknown", tests: [] };
}

export function validateSelection(selection, identity, floor, inventory) {
  for (const key of ["base", "head", "policySha256", "runnerSha256"]) {
    if (selection[key] !== identity[key]) throw new Error(`reviewed selection ${key} mismatch`);
  }
  if (!isString(selection.reviewer) || !selection.reviewer.trim()) throw new Error("independent reviewer required");
  if (!Array.isArray(selection.tests) || new Set(selection.tests).size !== selection.tests.length) throw new Error("unique explicit test selection required");
  for (const test of selection.tests) {
    if (!isString(test) || !/^(unit|translator|functional)\/[\w/.-]+\.test\.js$/.test(test)
      || test.split("/").includes("..") || test.endsWith(".live.test.js") || test.startsWith("translator/real/")
      || !inventory.includes(test)) throw new Error(`invalid selected test: ${test}`);
  }
  if (floor.tests.some(test => !selection.tests.includes(test))) throw new Error("reviewed selection omits mandatory tests");
  if (floor.risk !== "docs" && !selection.tests.length) throw new Error("zero selected tests");
  return [...selection.tests].sort();
}

// Every child receives this owned temporary root; reject replacement or permission drift.
export function assertPrivateTemporaryRoot(directory) {
  if (!path.isAbsolute(directory)) throw new Error("temporary root must be absolute");
  const state = lstatSync(directory);
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== process.geteuid()
    || (state.mode & 0o777) !== 0o700) throw new Error("temporary root must remain owned and private (0700)");
}

export function testEnvironment(source, privatePaths) {
  const allowed = ["PATH", "LANG", "LC_ALL", "TZ", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"];
  return { ...Object.fromEntries(allowed.filter(k => source[k] !== undefined).map(k => [k, source[k]])),
    ...privatePaths, CI: "true" };
}

// Shared dashboard imports and build configuration can affect the website too.
export function requiresWebsiteBuild(paths) {
  return paths.some(p => /^(docs|website|src|open-sse|public)\//.test(p)
    || /^(package(?:-lock)?\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.nvmrc|next\.config\.[^/]+|postcss\.config\.[^/]+)$/.test(p)
    || p.startsWith("scripts/") || p.startsWith(".github/workflows/"));
}

// A configured path is only a candidate; launching and report validation remain mandatory.
export function websiteBrowserAvailable(browser) {
  try {
    if (!browser || !statSync(browser).isFile()) return false;
    accessSync(browser, constants.X_OK);
    return true;
  } catch { return false; }
}

// Applies equally to a single shard (1/1) and multiple shards. Build-only success
// must never stand in for browser coverage when the full website job is selected.
export function requiredWebsiteCoverageStep(websiteRun, coverage, steps) {
  if (!websiteRun) return null;
  const passed = Number.isInteger(coverage?.totalTests) && coverage.totalTests > 0
    && Number.isInteger(coverage?.shards) && coverage.shards > 0
    && steps.some(s => s.id === "verify-website-browser-reports" && s.status === "passed");
  return {
    id: "required-website-browser-coverage", job: "website-build", kind: "check",
    status: passed ? "passed" : "failed",
    reason: passed ? "complete website browser inventory executed"
      : "required website browser coverage did not run or did not pass",
  };
}

// Deterministic Playwright sharding keeps each website browser command well
// under the 300-second ceiling while covering the complete configured inventory.
export const WEBSITE_BROWSER_SHARD_COUNT = 8;

const LITERAL_PLAYWRIGHT_SPEC_RE = /^[\w./-]+\.spec\.(?:m|c)?[jt]s$/;

export function extractPlaywrightTests(report) {
  if (!Array.isArray(report?.suites)) {
    throw new Error("Playwright JSON report has no suites[]");
  }
  if (!Array.isArray(report.errors) || report.errors.length > 0) {
    throw new Error(`Playwright reported ${Array.isArray(report.errors) ? report.errors.length : "invalid"} error(s)`);
  }
  const entries = [];
  const seen = new Set();
  const walkSuite = (suite, parentTitles, isFileRoot) => {
    const nextTitles = isFileRoot ? parentTitles : [...parentTitles, suite.title];
    for (const spec of suite.specs || []) {
      const file = spec.file || suite.file;
      if (!isString(file) || !file.trim() || !isString(spec.title) || !spec.title.trim()) {
        throw new Error("Playwright spec missing file or title");
      }
      const title = [...nextTitles, spec.title].join(" › ");
      const tests = Array.isArray(spec.tests) ? spec.tests : [];
      if (!tests.length) throw new Error(`Playwright spec has no tests[]: ${file} :: ${title}`);
      for (const test of tests) {
        const projectId = isString(test.projectId) ? test.projectId : "";
        const projectName = isString(test.projectName) ? test.projectName : "";
        const id = isString(spec.id) && spec.id.trim() ? spec.id : null;
        const key = `${projectId}::${file}::${title}${id ? `::${id}` : ""}`;
        if (seen.has(key)) throw new Error(`duplicate Playwright test key: ${key}`);
        seen.add(key);
        entries.push({
          key, id, projectId, projectName, file, title,
          ok: spec.ok === true,
          status: test.status,
          resultCount: Array.isArray(test.results) ? test.results.length : 0,
        });
      }
    }
    for (const childSuite of suite.suites || []) walkSuite(childSuite, nextTitles, false);
  };
  for (const fileSuite of report.suites) walkSuite(fileSuite, [], true);
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export function collectWebsiteBrowserInventory(listReport) {
  const tests = extractPlaywrightTests(listReport);
  if (!tests.length) throw new Error("empty website browser test inventory");
  const files = [...new Set(tests.map((entry) => entry.file))].sort();
  const projects = Array.isArray(listReport?.config?.projects) ? listReport.config.projects : [];
  for (const project of projects) {
    const matches = Array.isArray(project?.testMatch) ? project.testMatch : [];
    for (const match of matches) {
      if (!isString(match) || !LITERAL_PLAYWRIGHT_SPEC_RE.test(match)) continue;
      if (!files.some((file) => file === match || file.endsWith(`/${match}`))) {
        throw new Error(`configured website browser suite produced zero tests: ${match}`);
      }
    }
  }
  return { tests, files };
}

export function selectWebsiteBrowserShards(inventory, count = WEBSITE_BROWSER_SHARD_COUNT) {
  if (!Array.isArray(inventory) || !inventory.length) throw new Error("empty website browser test inventory");
  if (!Number.isInteger(count) || count < 1) throw new Error("invalid website browser shard count");
  const total = Math.min(count, inventory.length);
  return Array.from({ length: total }, (_, index) => ({
    index: index + 1,
    total,
    shard: `${index + 1}/${total}`,
    id: `website-browser-shard-${index + 1}`,
  }));
}

// Playwright owns grouping semantics (including serial suites and projects).
// Probe its real shard listings rather than approximating groups from test count.
export async function planWebsiteBrowserShards(inventory, listShard, count = WEBSITE_BROWSER_SHARD_COUNT) {
  const candidates = selectWebsiteBrowserShards(inventory, count);
  for (let total = candidates.length; total >= 1; total--) {
    const shards = selectWebsiteBrowserShards(inventory, total);
    const results = [];
    for (const shard of shards) results.push({ entries: await listShard(shard) });
    if (results.some((result) => !result.entries.length)) continue;
    verifyWebsiteBrowserCoverage(inventory, results);
    return shards;
  }
  throw new Error("Playwright produced no non-empty shard plan");
}

export function websiteBrowserInventoryCommand(web, browser, reportFile) {
  for (const [label, value] of [["web", web], ["browser", browser], ["reportFile", reportFile]]) {
    if (!isString(value) || !path.isAbsolute(value)) throw new Error(`website browser ${label} must be an absolute path`);
  }
  return [
    "website-browser-inventory",
    "node",
    [path.join(web, "node_modules/@playwright/test/cli.js"), "test", "--list", "--reporter=json"],
    {
      cwd: web,
      env: {
        WEBSITE_CHROMIUM_EXECUTABLE: browser,
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      },
    },
  ];
}

// Each shard owns one transient website server. Its private state file and
// random owner token are fixed here; the port is reserved immediately before
// the shard starts (websiteBrowserShardEnv) so that it is still free.
export function websiteBrowserShardCommands(web, shards, { browser, outputRoot, reportRoot, ownerToken = newShardOwnerToken } = {}) {
  if (!Array.isArray(shards) || !shards.length) throw new Error("empty website browser shards");
  for (const [label, value] of [
    ["web", web], ["browser", browser], ["outputRoot", outputRoot], ["reportRoot", reportRoot],
  ]) {
    if (!isString(value) || !path.isAbsolute(value)) throw new Error(`website browser ${label} must be an absolute path`);
  }
  const total = shards.length;
  return shards.map((entry, idx) => {
    const expectedIndex = idx + 1;
    const expectedShard = `${expectedIndex}/${total}`;
    const expectedId = `website-browser-shard-${expectedIndex}`;
    if (!entry || entry.index !== expectedIndex || entry.total !== total
      || entry.shard !== expectedShard || entry.id !== expectedId) {
      throw new Error(`invalid website browser shard entry at position ${expectedIndex}`);
    }
    const shardOutputDir = path.join(outputRoot, `shard-${expectedIndex}`);
    const verifyScreenshotsDir = path.join(outputRoot, `shard-${expectedIndex}-verify-screenshots`);
    const reviewScreenshotsDir = path.join(outputRoot, `shard-${expectedIndex}-review-screenshots`);
    const reportFile = path.join(reportRoot, `shard-${expectedIndex}.json`);
    const serverStateFile = path.join(outputRoot, `shard-${expectedIndex}-server.json`);
    const owner = ownerToken();
    return [
      expectedId,
      "node",
      [
        path.join(web, "node_modules/@playwright/test/cli.js"),
        "test",
        `--shard=${expectedShard}`,
        "--reporter=list,json",
        `--output=${shardOutputDir}`,
      ],
      {
        cwd: web,
        env: {
          WEBSITE_CHROMIUM_EXECUTABLE: browser,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
          WEBSITE_VERIFY_SCREENSHOTS: verifyScreenshotsDir,
          WEBSITE_REVIEW_SCREENSHOTS: reviewScreenshotsDir,
          [SHARD_STATE_ENV]: serverStateFile,
          [SHARD_OWNER_ENV]: owner,
        },
        reportFile,
        shard: expectedShard,
        server: { owner, stateFile: serverStateFile },
      },
    ];
  });
}

// The child env is an explicit allowlist (testEnvironment plus these keys), so
// the port has to be passed here; nothing is inherited from the host.
export function websiteBrowserShardEnv(shardOpts, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid website browser shard port");
  return { ...shardOpts.env, [SHARD_PORT_ENV]: String(port) };
}

// Runs after every shard, whatever ended it: pass, failure, budget or silence
// timeout, interrupt or spawn error. A failed cleanup is a failed check and
// stops the remaining shards (fail closed).
export async function websiteBrowserShardCleanupStep(shardId, shardOpts, port, cleanup = cleanupShardServer) {
  const step = { id: `${shardId}-server-cleanup`, job: "website-build", kind: "check", port };
  try {
    const result = await cleanup({ owner: shardOpts.server.owner, port, stateFile: shardOpts.server.stateFile });
    Object.assign(step, {
      status: result.ok ? "passed" : "failed",
      reason: result.ok
        ? (result.foreignListener ? "shard server stopped; an unrelated listener on the port was left untouched" : "shard server stopped")
        : result.reason,
      verification: result.verification,
      signalled: result.signalled,
      survivors: result.survivors,
      foreignListener: result.foreignListener,
    });
  } catch (error) {
    Object.assign(step, { status: "failed", reason: `shard server cleanup could not be established: ${error.message}` });
  }
  return step;
}

export function validateWebsiteBrowserShardReport(reportFile, startedAt, exitCode, signal = null) {
  if (signal) throw new Error(`website browser shard terminated by signal ${signal}`);
  if (exitCode !== 0) throw new Error(`website browser shard exited with status ${exitCode}`);
  if (!existsSync(reportFile)) throw new Error("website browser shard did not create a JSON report");
  if (statSync(reportFile).mtimeMs < startedAt - 1000) throw new Error("website browser shard JSON report is stale");
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch (error) {
    throw new Error(`website browser shard JSON report is not parseable: ${error.message}`);
  }
  const entries = extractPlaywrightTests(report);
  if (!entries.length) throw new Error("website browser shard collected zero tests");
  const stats = report.stats || {};
  if (Number(stats.unexpected || 0) !== 0 || Number(stats.skipped || 0) !== 0 || Number(stats.flaky || 0) !== 0) {
    throw new Error("website browser shard reported unexpected, skipped, or flaky tests");
  }
  if (Number(stats.expected || 0) !== entries.length) {
    throw new Error("website browser shard expected test count mismatch");
  }
  for (const entry of entries) {
    if (!entry.ok || entry.status !== "expected" || entry.resultCount < 1) {
      throw new Error(`website browser test did not pass: ${entry.file} :: ${entry.title}`);
    }
  }
  return { file: reportFile, sha256: digest(readFileSync(reportFile)), tests: entries.length, entries };
}

export function verifyWebsiteBrowserCoverage(inventory, shardResults) {
  if (!Array.isArray(inventory) || !inventory.length) throw new Error("empty website browser test inventory");
  if (!Array.isArray(shardResults) || !shardResults.length) throw new Error("missing website browser shard results");
  const expected = new Set();
  for (const entry of inventory) {
    if (!isString(entry?.key) || !entry.key) throw new Error("invalid website browser inventory entry");
    if (expected.has(entry.key)) throw new Error(`duplicate website browser inventory entry: ${entry.key}`);
    expected.add(entry.key);
  }
  const executed = new Set();
  for (let i = 0; i < shardResults.length; i++) {
    const entries = shardResults[i]?.entries;
    if (!Array.isArray(entries) || !entries.length) {
      throw new Error(`website browser shard ${i + 1} executed zero tests`);
    }
    for (const entry of entries) {
      if (!isString(entry?.key) || !entry.key) throw new Error("invalid website browser shard entry");
      if (executed.has(entry.key)) throw new Error(`duplicate website browser test across shards: ${entry.key}`);
      executed.add(entry.key);
    }
  }
  const missing = [...expected].filter((key) => !executed.has(key));
  if (missing.length) throw new Error(`website browser shards omitted ${missing.length} configured test(s)`);
  const extra = [...executed].filter((key) => !expected.has(key));
  if (extra.length) throw new Error(`website browser shards ran ${extra.length} unexpected test(s)`);
  return {
    totalTests: expected.size,
    shards: shardResults.length,
    files: [...new Set(inventory.map((entry) => entry.file))].sort(),
  };
}

// Every full checkpoint exercises the same artifacts that release.yml publishes.
// Commands stay separate so each retains the supervisor's 300-second ceiling.
export function artifactCommands(src, packDirectory, version) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("invalid package version");
  return [
    ["smoke-standalone", "pnpm", ["run", "verify:installed", path.join(src, ".next/standalone/custom-server.js")]],
    ["pnpm-install-cli", "pnpm", ["install", "--frozen-lockfile"], { cwd: path.join(src, "cli") }],
    ["build-cli", "pnpm", ["-C", "cli", "run", "build"]],
    ["pack-cli", "npm", ["pack", "./cli", "--pack-destination", packDirectory]],
    ["smoke-packed", "pnpm", ["run", "verify:packed", path.join(packDirectory, `durindoor-${version}.tgz`)]],
  ];
}

export function fullTestDependencyCommands(src) {
  const install = ["install", "--frozen-lockfile"];
  return [
    ["pnpm-install-root", "pnpm", install],
    ["pnpm-install-cli", "pnpm", install, { cwd: path.join(src, "cli") }],
    ["pnpm-install-tests", "pnpm", install, { cwd: path.join(src, "tests") }],
  ];
}

export function scopedTestArgs(tests, selected) {
  return [path.join(tests, "node_modules/vitest/vitest.mjs"), "run", ...selected, "--maxWorkers=2",
    "--reporter=json", `--outputFile=${path.join(tests, ".scoped-results.json")}`];
}

/** Real test completion output keeps the silence watchdog informed without weakening it. */
export function fullTestArgs(tests, selected, reportFile) {
  return fullBatchArgs(tests, selected, reportFile);
}

export function validateTestReport(file, startedAt, exitCode, signal, tests, selected = []) {
  const report = readFreshReport(file, startedAt);
  validateVitestExecution(report, exitCode, signal);
  const assertions = report.testResults.flatMap(s => s.assertionResults || []);
  if (exitCode !== 0 || !assertions.some(a => a.status === "passed")) throw new Error("no passing tests or failed command");
  const collected = new Set(report.testResults.filter(s => s.assertionResults?.some(a => a.status === "passed"))
    .map(s => path.relative(tests, s.name).split(path.sep).join("/")));
  if (selected.some(s => !collected.has(s))) throw new Error("selected test suite not executed");
  return { file, sha256: digest(readFileSync(file)), tests: assertions.filter(a => a.status === "passed").length };
}

// Metadata validation only. The independent publisher must recompute on-disk
// receipt/log/report hashes and verify frozen review provenance and collection.
export function validateReceipt(receipt, expected, { now = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
  for (const key of ["base", "head", "policySha256", "runnerSha256", "toolchainSha256", "selectionSha256"]) {
    if (receipt[key] !== expected[key]) throw new Error(`receipt ${key} mismatch`);
  }
  const age = now - Date.parse(receipt.endedAt);
  if (receipt.status !== "passed" || !Number.isFinite(age) || age < 0 || age > maxAgeMs) throw new Error("stale or failed receipt");
  for (const id of expected.requiredSteps) {
    const steps = receipt.steps.filter(s => s.id === id);
    if (!steps.length || steps.some(s => s.kind !== "command" || s.status !== "passed" || s.exitCode !== 0
      || s.signal || s.spawnError || !/^[a-f0-9]{64}$/.test(s.logSha256))) throw new Error(`required command not passed: ${id}`);
  }
  if (receipt.steps.some(s => ["failed", "not-run", "interrupted", "running"].includes(s.status))) throw new Error("failed receipt command");
  if (!(expected.risk === "docs" && expected.selectedTests?.length === 0)
    && (!receipt.reports?.length || receipt.reports.some(r => !/^[a-f0-9]{64}$/.test(r.sha256) || !(r.tests > 0)))) throw new Error("missing test report");
  return true;
}

export function terminateCommandGroup(pid) {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("invalid command process group");
  try { process.kill(-pid, "SIGKILL"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

export async function main() {

const NODE_VERSION = "24.22.2";
const PNPM_VERSION = "12.18.0";
const COMMITLINT_CLI_VERSION = "18.6.1"; // pins from wagoid/commitlint-github-action v5.5.1 / commitlint.yml
const COMMITLINT_CONFIG_VERSION = "18.6.3";
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const USAGE = `Usage: node scripts/local-ci.mjs --base <full-sha> --head <full-sha> [options]
  --repo <dir>         source repository (default: cwd)
  --out <dir>          new evidence/workspace dir (default: ~/.cache/durindoor-local-ci/<head12>-<utc>)
  --path-prepend <dir> directory with Node ${NODE_VERSION} (and pnpm ${PNPM_VERSION}) put first on PATH
  --mode full|scoped   full (default) retains the bootstrap/checkpoint gate
  --selection <file>   externally reviewed JSON with base/head/policySha256/runnerSha256/reviewer/tests
  --policy-sha <hash>  independently frozen base-policy SHA256 (required in scoped mode)
  --runner-sha <hash>  independently frozen runner SHA256 (required in scoped mode)
  --website auto|always  auto (default): build website when content or shared build inputs differ
  --title <text>       also commitlint this PR title (squash-merge subject)
Exit: 0 all required steps passed, 1 failure, 130 interrupted, 2 usage/prerequisite error.`;

let opts;
try {
  opts = parseArgs({
    options: {
      base: { type: "string" }, head: { type: "string" }, repo: { type: "string" },
      out: { type: "string" }, "path-prepend": { type: "string" },
      website: { type: "string", default: "auto" }, title: { type: "string" },
      mode: { type: "string", default: "full" }, selection: { type: "string" },
      "policy-sha": { type: "string" }, "runner-sha": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  }).values;
} catch (e) {
  console.error(`${e.message}\n${USAGE}`);
  process.exit(2);
}
if (opts.help) { console.log(USAGE); process.exit(0); }
const usageDie = (m) => { console.error(`${m}\n${USAGE}`); process.exit(2); };
if (!SHA_RE.test(opts.base ?? "")) usageDie("--base must be a full lowercase commit SHA (no refs, no ranges)");
if (!SHA_RE.test(opts.head ?? "")) usageDie("--head must be a full lowercase commit SHA (no refs, no ranges)");
if (!["auto", "always"].includes(opts.website)) usageDie("--website must be auto or always");

if (!["full", "scoped"].includes(opts.mode)) usageDie("--mode must be full or scoped");
if (opts.mode === "scoped" && (!opts.selection || !opts["policy-sha"] || !opts["runner-sha"])) usageDie("scoped mode requires independent frozen policy, runner and selection");
const runnerSha256 = digest(readFileSync(fileURLToPath(import.meta.url)));
if (opts["runner-sha"] && opts["runner-sha"] !== runnerSha256) usageDie("frozen runner SHA256 mismatch");

const repo = path.resolve(opts.repo ?? process.cwd());
const BASE = opts.base;
const HEAD = opts.head;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const out = path.resolve(
  opts.out ?? path.join(os.homedir(), ".cache", "durindoor-local-ci", `${HEAD.slice(0, 12)}-${stamp}`),
);
if (existsSync(out)) usageDie(`--out already exists, refusing to reuse: ${out}`);
if (!isFunction(process.geteuid) || process.geteuid() === 0) usageDie("unprivileged POSIX execution required");
mkdirSync(out, { recursive: true, mode: 0o700 });
const privateRoot = lstatSync(out);
if (!privateRoot.isDirectory() || privateRoot.isSymbolicLink() || privateRoot.uid !== process.geteuid()
  || (privateRoot.mode & 0o077)) usageDie("output root must be owned by execution identity and private (0700)");
const dirs = {
  logs: path.join(out, "logs"), src: path.join(out, "src"), home: path.join(out, "home"),
  testHome: path.join(out, "durindoor-home"), data: path.join(out, "durindoor-data-build"),
  testData: path.join(out, "durindoor-data-test"), tmp: path.join(out, "tmp"),
  cache: path.join(out, "npm-cache"), tool: path.join(out, "commitlint-tool"),
};
for (const d of Object.values(dirs)) {
  if (d === dirs.src) continue;
  const mkdirOptions = { recursive: true };
  if (d === dirs.tmp) mkdirOptions.mode = 0o700;
  mkdirSync(d, mkdirOptions);
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const now = () => new Date().toISOString();

const evidence = {
  schema: "durindoor-local-ci/2", mode: opts.mode, runnerSha256, reports: [],
  startedAt: now(), endedAt: null, status: "running",
  note: "Produced by scripts/local-ci.mjs. This runner never publishes GitHub statuses.",
  repo, base: BASE, head: HEAD, out,
  options: { website: opts.website, title: opts.title ?? null, pathPrepend: opts["path-prepend"] ?? null },
  identities: {}, toolchain: { required: { node: NODE_VERSION, pnpm: PNPM_VERSION } },
  steps: [],
};
const save = () => {
  const tmp = path.join(out, "evidence.json.tmp");
  writeFileSync(tmp, JSON.stringify(evidence, null, 2) + "\n");
  renameSync(tmp, path.join(out, "evidence.json"));
};
save();

const baseEnv = {
  ...testEnvironment(process.env, {}),
  HOME: dirs.home, DATA_DIR: dirs.data, TMPDIR: dirs.tmp, CI: "true",
  npm_config_cache: dirs.cache, npm_config_update_notifier: "false",
  PATH: [opts["path-prepend"], process.env.PATH].filter(Boolean).join(path.delimiter),
};
const envOverrides = (extra = {}) => ({
  HOME: baseEnv.HOME, DATA_DIR: baseEnv.DATA_DIR, TMPDIR: baseEnv.TMPDIR, CI: "true",
  npm_config_cache: dirs.cache, PATH_PREPEND: opts["path-prepend"] ?? null, ...extra,
});

let interrupted = null;
let child = null;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    interrupted = sig;
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } }
  });
}

let seq = 0;
let anyFail = false;

/** Run one command, record evidence. Returns the step record. */
async function run(id, job, cmd, args, { cwd = dirs.src, env = {}, input, expectOk = (c) => c === 0 } = {}) {
  const step = {
    id, job, kind: "command", argv: [cmd, ...args], cwd,
    env: envOverrides(env), startedAt: null, endedAt: null,
    exitCode: null, signal: null, spawnError: null, status: "running", stdoutStderrLog: null, logSha256: null,
  };
  evidence.steps.push(step);
  if (interrupted) { step.status = "not-run"; step.reason = `interrupted by ${interrupted}`; save(); return step; }
  try { assertPrivateTemporaryRoot(dirs.tmp); }
  catch (error) {
    step.spawnError = `private temporary root invalid before command: ${error.message}`;
    step.status = "failed"; anyFail = true; save(); return step;
  }
  for (const directory of [out, cwd, ...Object.values(dirs).filter(d => existsSync(d))]) {
    const state = lstatSync(directory);
    if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== process.geteuid()) {
      step.spawnError = "command state ownership mismatch";
      step.status = "failed"; anyFail = true; save(); return step;
    }
  }
  const log = path.join(dirs.logs, `${String(++seq).padStart(2, "0")}-${id}.log`);
  step.stdoutStderrLog = log;
  step.startedAt = now();
  save();
  const fd = openSync(log, "w");
  console.log(`local-ci: start ${job}/${id}`);
  let timer;
  let watchdog;
  let lastBytes = 0;
  let lastProgress = Date.now();
  await new Promise((resolve) => {
    try {
      child = spawn(cmd, args, {
        cwd, env: { ...baseEnv, ...env }, detached: true,
        stdio: [input === undefined ? "ignore" : "pipe", fd, fd],
      });
    } catch (e) { step.spawnError = String(e); resolve(); return; }
    timer = setTimeout(() => {
      step.spawnError = "command exceeded 300000ms budget";
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* child already exited */ }
    }, 300000);
    watchdog = setInterval(() => {
      const bytes = statSync(log).size;
      if (bytes !== lastBytes) { lastBytes = bytes; lastProgress = Date.now(); }
      console.log(`local-ci: progress ${job}/${id} ${bytes} log bytes`);
      if (Date.now() - lastProgress > 180000) {
        step.spawnError = "no command output for 180000ms";
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* child already exited */ }
      }
    }, 30000);
    if (input !== undefined) child.stdin.end(input);
    child.on("error", (e) => { step.spawnError = String(e); resolve(); });
    child.on("close", (code, signal) => { step.exitCode = code; step.signal = signal; resolve(); });
  });
  clearTimeout(timer);
  clearInterval(watchdog);
  if (child?.pid) {
    try { terminateCommandGroup(child.pid); }
    catch (error) { step.spawnError = `command group cleanup failed: ${error.message}`; }
  }
  child = null;
  closeSync(fd);
  const after = lstatSync(out);
  if (!after.isDirectory() || after.isSymbolicLink() || after.uid !== process.geteuid() || (after.mode & 0o077)) {
    step.spawnError = "private output root changed during command";
  }
  try { assertPrivateTemporaryRoot(dirs.tmp); }
  catch (error) { step.spawnError = `private temporary root invalid after command: ${error.message}`; }
  step.endedAt = now();
  step.logSha256 = sha256(log);
  step.status = interrupted ? "interrupted"
    : step.spawnError || step.signal || !expectOk(step.exitCode) ? "failed" : "passed";
  if (step.status !== "passed") anyFail = true;
  save();
  console.log(`local-ci: ${step.status} ${job}/${id} (${step.exitCode})`);
  return step;
}

function skip(id, job, reason, kind = "skipped") {
  evidence.steps.push({ id, job, kind: "marker", status: kind, reason, at: now() });
  save();
}
const ok = (s) => s.status === "passed";

/** Run a job's commands in order; the first failure marks the rest not-run (like a GitHub job). */
async function job(name, list) {
  let dead = false;
  for (const [id, cmd, args, o] of list) {
    if (dead) { skip(id, name, "earlier step in this job did not pass", "not-run"); continue; }
    if (!ok(await run(id, name, cmd, args, o))) dead = true;
  }
  return !dead;
}

function finish(code, status) {
  evidence.endedAt = now();
  evidence.status = status;
  save();
  writeFileSync(path.join(out, "evidence.sha256"), `${sha256(path.join(out, "evidence.json"))}  evidence.json\n`);
  const failed = evidence.steps.filter((s) => ["failed", "interrupted", "not-run"].includes(s.status));
  console.log(`local-ci: ${status.toUpperCase()} (${evidence.steps.length} records, ${failed.length} not passing)`);
  for (const s of failed) console.log(`  ${s.status}: ${s.job}/${s.id}${s.reason ? ` (${s.reason})` : ""}`);
  console.log(`evidence: ${path.join(out, "evidence.json")}`);
  process.exit(code);
}

// ---- prerequisites: exact commit identities (every git call is a recorded step) --
const readLog = (s) => (s.stdoutStderrLog && existsSync(s.stdoutStderrLog) ? readFileSync(s.stdoutStderrLog, "utf8").trim() : "");
const gitq = async (id, args, cwd, o = {}) => {
  const s = await run(id, "setup", "git", args, { cwd, ...o });
  return { s, text: args.includes("-z") && s.stdoutStderrLog ? readFileSync(s.stdoutStderrLog, "utf8") : readLog(s) };
};
const bail = (code) => finish(interrupted ? 130 : code, interrupted ? "interrupted" : code === 2 ? "prerequisite-error" : "failed");
for (const [label, sha] of [["base", BASE], ["head", HEAD]]) {
  const r = await gitq(`verify-${label}-commit`, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], repo);
  if (!ok(r.s) || r.text !== sha) {
    skip(`identity-${label}`, "setup", `${label} ${sha} is not an exact commit in ${repo}`, "failed");
    bail(2);
  }
}
const headTree = await gitq("head-tree", ["rev-parse", `${HEAD}^{tree}`], repo);
if (!ok(headTree.s)) bail(1);
evidence.identities.headTree = headTree.text;
const mb = await gitq("merge-base", ["merge-base", BASE, HEAD], repo, { expectOk: (c) => c === 0 || c === 1 });
evidence.identities.mergeBase = mb.s.exitCode === 0 ? mb.text : null;
const cnt = await gitq("commits-in-range", ["rev-list", "--count", `${BASE}..${HEAD}`], repo);
if (!ok(cnt.s)) bail(1);
evidence.identities.commitsInRange = Number(cnt.text);
save();

// ---- private immutable snapshot of HEAD (full history for base/head diffs) --
const gitLocal = ["-c", "uploadpack.allowAnySHA1InWant=true"];
mkdirSync(dirs.src, { recursive: true });
const snap = [
  ["snapshot-init", "git", ["init", "--quiet", dirs.src], { cwd: out }],
  ["snapshot-fetch", "git", [...gitLocal, "fetch", "--quiet", "--no-tags", repo, BASE, HEAD], {}],
  ["snapshot-checkout", "git", ["checkout", "--quiet", "--detach", HEAD], {}],
];
if (!(await job("setup", snap))) bail(1);
const snapHeadR = await gitq("snapshot-head", ["rev-parse", "HEAD"], dirs.src);
const snapTreeR = await gitq("snapshot-tree", ["rev-parse", "HEAD^{tree}"], dirs.src);
const dirtyR = await gitq("snapshot-status", ["status", "--porcelain"], dirs.src);
const snapHead = snapHeadR.text;
const snapTree = snapTreeR.text;
const dirty = dirtyR.text;
evidence.identities.snapshotHead = snapHead;
evidence.identities.snapshotTree = snapTree;
if (![snapHeadR, snapTreeR, dirtyR].every((r) => ok(r.s)) || snapHead !== HEAD || snapTree !== evidence.identities.headTree || dirty) {
  skip("snapshot-identity", "setup", `snapshot mismatch head=${snapHead} tree=${snapTree} dirty=${Boolean(dirty)}`, "failed");
  anyFail = true;
  finish(1, "failed");
}
evidence.identities.files = {};
for (const f of [
  "pnpm-lock.yaml", "website/pnpm-lock.yaml", "tests/pnpm-lock.yaml", "cli/pnpm-lock.yaml", ".nvmrc", ".commitlintrc.cjs",
]) {
  const p = path.join(dirs.src, f);
  evidence.identities.files[f] = existsSync(p) ? sha256(p) : null;
}
save();

// ---- toolchain: refuse a wrong Node/npm instead of silently running ---------
const nodeStep = await run("toolchain-node", "setup", "node", ["--version"]);
const pnpmStep = await run("toolchain-pnpm", "setup", "pnpm", ["--version"]);
// (readLog defined above)
evidence.toolchain.node = readLog(nodeStep);
evidence.toolchain.pnpm = readLog(pnpmStep);
const nvmrc = readFileSync(path.join(dirs.src, ".nvmrc"), "utf8").trim();
if (process.version !== `v${NODE_VERSION}` || evidence.toolchain.node !== `v${NODE_VERSION}` || evidence.toolchain.pnpm !== PNPM_VERSION || nvmrc !== NODE_VERSION) {
  skip(
    "toolchain-check", "setup",
    `need node v${NODE_VERSION} (.nvmrc=${nvmrc}) and pnpm ${PNPM_VERSION}; got node ${evidence.toolchain.node || "?"}, pnpm ${evidence.toolchain.pnpm || "?"}. Use --path-prepend.`,
    "failed",
  );
  finish(2, "prerequisite-error");
}
save();

// Scope comes from git objects, never candidate-controlled CLI patterns.
const changed = await gitq("changed-paths", ["diff", "--name-only", "-z", "--no-renames", BASE, HEAD], dirs.src);
const inventoryResult = await gitq("test-inventory", ["ls-tree", "-r", "--name-only", BASE, "--", "tests"], dirs.src);
const headInventoryResult = await gitq("head-test-inventory", ["ls-tree", "-r", "--name-only", HEAD, "--", "tests"], dirs.src);
const deletions = await gitq("deleted-paths", ["diff", "--name-only", "-z", "--diff-filter=D", "--no-renames", BASE, HEAD], dirs.src);
if (![changed, inventoryResult, headInventoryResult, deletions].every(r => ok(r.s))) bail(1);
const changedPaths = changed.text.split("\0").filter(Boolean);
const inventory = inventoryResult.text.split("\n").filter(p => p.endsWith(".test.js")
  && !p.endsWith(".live.test.js") && !p.startsWith("tests/translator/real/")).map(p => p.slice(6));
const policyParts = [];
for (const file of ["AGENTS.md", "internal/docs/testing.mdx", "internal/docs/agent-workflow.md"]) {
  const r = await gitq(`policy-${path.basename(file)}`, ["show", `${BASE}:${file}`], dirs.src);
  if (!ok(r.s)) bail(1);
  policyParts.push([file, sha256(r.s.stdoutStderrLog)]);
}
evidence.policySha256 = digest(JSON.stringify(policyParts));
evidence.changedPaths = changedPaths;
evidence.riskFloor = selectRiskFloor(changedPaths, inventory, deletions.text.split("\0").filter(Boolean));
evidence.selectionSha256 = null;
evidence.toolchain.identity = { node: evidence.toolchain.node, pnpm: evidence.toolchain.pnpm,
  abi: process.versions.modules, platform: process.platform, arch: process.arch,
  lockfiles: evidence.identities.files };
evidence.toolchainSha256 = digest(JSON.stringify(evidence.toolchain.identity));
let selected = [];
if (opts.mode === "scoped") {
  if (opts["policy-sha"] !== evidence.policySha256) throw new Error("frozen base policy SHA256 mismatch");
  if (evidence.riskFloor.mode === "full") throw new Error("changed paths require full checkpoint, not scoped mode");
  const bytes = readFileSync(path.resolve(opts.selection));
  evidence.selectionSha256 = digest(bytes);
  selected = validateSelection(JSON.parse(bytes), evidence, evidence.riskFloor,
    headInventoryResult.text.split("\n").filter(p => p.startsWith("tests/")).map(p => p.slice(6)));
  evidence.selectedTests = selected;
}
save();

// ---- jobs ------------------------------------------------------------------
const pnpmInstall = ["install", "--frozen-lockfile"];
const web = path.join(dirs.src, "website");
const tests = path.join(dirs.src, "tests");

// Compare the already recorded exact base/head paths, including shared imports.
const websiteRun = opts.website === "always" || requiresWebsiteBuild(changedPaths);
const websiteReason = opts.website === "always" ? "--website always"
  : websiteRun ? "website content or shared build inputs changed" : "no website inputs changed";
evidence.identities.websiteDecision = { run: websiteRun, reason: websiteReason };
save();

// Full mode retains every old job.
if (opts.mode === "full") {
// lint-and-build
const appBuilt = await job("lint-and-build", [
  ["pnpm-install-root", "pnpm", pnpmInstall],
  ["lint", "pnpm", ["run", "lint"]],
  ["check-agent-index", "pnpm", ["run", "check:agent-index"]],
  ["check-postgres-migrations", "pnpm", ["run", "check:postgres-migrations"]],
  ["check-registry-index", "pnpm", ["run", "check:registry-index"]],
  ["check-docs", "pnpm", ["run", "check:docs"]],
  ["check-provider-catalog", "pnpm", ["run", "check:provider-catalog"]],
  ["build-isolated-state", "pnpm", ["run", "build"]],
]);

// Each CI job did its own checkout + installs, so each job here runs its own
// installs in order and is independent of the other jobs' outcome.
// website-build (conditional)
if (!websiteRun) {
  skip("website-build", "website-build", `conditional job skipped: ${websiteReason}`, "skipped");
} else {
  // Reuse the browser chosen for local evidence; child HOME stays private.
  const configuredBrowser = process.env.WEBSITE_CHROMIUM_EXECUTABLE || process.env.V5_CHROMIUM_EXECUTABLE;
  const resolvedBrowser = configuredBrowser ? path.resolve(configuredBrowser) : null;
  const browser = resolvedBrowser || chromiumLaunchOptions(chromium, dirs.src).executablePath || chromium.executablePath();
  const browserAvailable = websiteBrowserAvailable(browser);
  const websiteBuilt = await job("website-build", [
    ["pnpm-install-root", "pnpm", pnpmInstall],
    ["pnpm-install-website", "pnpm", pnpmInstall, { cwd: web }],
    ["website-build", "pnpm", ["run", "build"], { cwd: web }],
  ]);
  if (!websiteBuilt) {
    skip("website-browser-inventory", "website-build", "website build did not pass", "not-run");
  } else if (!browserAvailable) {
    anyFail = true;
    skip("website-browser-suites", "website-build", "required website browser suites cannot run: no executable Chromium browser", "failed");
  } else {
    const browserOutputRoot = path.join(dirs.tmp, "website-browser-output");
    const browserReportRoot = path.join(out, "website-browser-reports");
    mkdirSync(browserOutputRoot, { recursive: true, mode: 0o700 });
    mkdirSync(browserReportRoot, { recursive: true, mode: 0o700 });
    const inventoryFile = path.join(browserReportRoot, "inventory.json");
    rmSync(inventoryFile, { force: true });
    const [invId, invCmd, invArgs, invOpts] = websiteBrowserInventoryCommand(web, browser, inventoryFile);
    const inventoryStep = await run(invId, "website-build", invCmd, invArgs, invOpts);
    if (!ok(inventoryStep)) {
      skip("verify-website-browser-reports", "website-build", "website browser inventory did not pass", "not-run");
    } else {
      try {
        if (!existsSync(inventoryFile) || statSync(inventoryFile).mtimeMs < Date.parse(inventoryStep.startedAt) - 1000) {
          throw new Error("missing or stale website browser inventory report");
        }
        const discovered = collectWebsiteBrowserInventory(JSON.parse(readFileSync(inventoryFile, "utf8")));
        const shards = await planWebsiteBrowserShards(discovered.tests, async (shard) => {
          const reportFile = path.join(browserReportRoot, `plan-${shard.total}-${shard.index}.json`);
          rmSync(reportFile, { force: true });
          const [id, cmd, args, options] = websiteBrowserInventoryCommand(web, browser, reportFile);
          const step = await run(`${id}-plan-${shard.total}-${shard.index}`, "website-build", cmd,
            [...args, `--shard=${shard.shard}`], options);
          if (!ok(step)) throw new Error("website browser shard planning failed");
          if (!existsSync(reportFile) || statSync(reportFile).mtimeMs < Date.parse(step.startedAt) - 1000) {
            throw new Error("missing or stale website browser shard plan");
          }
          return extractPlaywrightTests(JSON.parse(readFileSync(reportFile, "utf8")));
        });
        const shardCommands = websiteBrowserShardCommands(web, shards, {
          browser,
          outputRoot: browserOutputRoot,
          reportRoot: browserReportRoot,
        });
        evidence.websiteBrowserInventory = discovered.tests.map((entry) => entry.key);
        evidence.websiteBrowserShards = shards.map((entry) => entry.shard);
        save();
        const shardResults = [];
        let dead = false;
        let shardValidationError = null;
        for (const [shardId, cmd, args, shardOpts] of shardCommands) {
          if (dead) {
            skip(shardId, "website-build", "earlier website browser shard did not pass", "not-run");
            continue;
          }
          rmSync(shardOpts.reportFile, { force: true });
          rmSync(shardOpts.server.stateFile, { force: true });
          const port = await reserveLoopbackPort();
          const step = await run(shardId, "website-build", cmd, args, {
            cwd: shardOpts.cwd, env: websiteBrowserShardEnv(shardOpts, port),
          });
          const cleanupStep = await websiteBrowserShardCleanupStep(shardId, shardOpts, port);
          cleanupStep.at = now();
          evidence.steps.push(cleanupStep);
          save();
          if (cleanupStep.status !== "passed") {
            anyFail = true;
            dead = true;
            continue;
          }
          if (!ok(step)) {
            dead = true;
            continue;
          }
          try {
            const validated = validateWebsiteBrowserShardReport(
              shardOpts.reportFile, Date.parse(step.startedAt), step.exitCode, step.signal,
            );
            shardResults.push(validated);
            evidence.reports.push({ file: validated.file, sha256: validated.sha256, tests: validated.tests });
            save();
          } catch (error) {
            dead = true;
            shardValidationError = error;
          }
        }
        if (shardValidationError) throw shardValidationError;
        if (dead) throw new Error("one or more website browser shards failed");
        evidence.websiteBrowserCoverage = verifyWebsiteBrowserCoverage(discovered.tests, shardResults);
        evidence.steps.push({ id: "verify-website-browser-reports", job: "website-build", kind: "check", status: "passed", at: now() });
        save();
      } catch (error) {
        anyFail = true;
        skip("verify-website-browser-reports", "website-build", error.message, "failed");
      }
    }
  }
}

const packDirectory = path.join(out, "pack");
mkdirSync(packDirectory, { mode: 0o700 });
const rootVersion = JSON.parse(readFileSync(path.join(dirs.src, "package.json"), "utf8")).version;
const cliVersion = JSON.parse(readFileSync(path.join(dirs.src, "cli/package.json"), "utf8")).version;
if (rootVersion !== cliVersion) {
  anyFail = true;
  skip("artifact-version", "artifacts", "root and CLI versions differ", "failed");
} else if (!appBuilt) {
  skip("artifact-build", "artifacts", "standalone build did not pass", "not-run");
} else if (await job("artifacts", artifactCommands(dirs.src, packDirectory, cliVersion))) {
  const file = path.join(packDirectory, `durindoor-${cliVersion}.tgz`);
  evidence.artifacts = [{ file, bytes: statSync(file).size, sha256: sha256(file) }];
  save();
}

// vitest + no-regression gate (independent of lint-and-build / website-build outcome)
await job("vitest", [
  ...fullTestDependencyCommands(dirs.src),
  ["pnpm-install-website", "pnpm", pnpmInstall, { cwd: web }],
]);
// Discover with the same configuration as execution; never substitute tracked-file globs.
const testEnv = { HOME: dirs.testHome, DATA_DIR: dirs.testData, BASELINE_BASE_REF: BASE };
const discoveryFile = path.join(tests, ".full-inventory.json");
rmSync(discoveryFile, { force: true });
const discovery = await run("vitest-inventory", "vitest", "node", [
  path.join(tests, "node_modules/vitest/vitest.mjs"), "list", "--filesOnly", `--json=${discoveryFile}`,
], { cwd: tests, env: testEnv });
if (ok(discovery)) {
  try {
    const batches = partitionInventory(JSON.parse(readFileSync(discoveryFile, "utf8")), tests);
    const mandatory = mandatoryTestInventory(headInventoryResult.text.split("\n"),
      { hasCloud: existsSync(path.join(dirs.src, "cloud")) });
    if (missingFromDiscovery(batches, mandatory).length || batches.flat().length !== mandatory.length) {
      throw new Error("configured discovery differs from tracked test inventory");
    }
    evidence.fullTestInventory = batches.flat().sort();
    evidence.fullTestBatches = batches;
    save();
    const reports = [];
    for (let i = 0; i < batches.length; i++) {
      const reportFile = path.join(tests, `.full-batch-${i + 1}.json`);
      rmSync(reportFile, { force: true });
      const step = await run(`vitest-full-batch-${i + 1}`, "vitest", "node",
        fullTestArgs(tests, batches[i], reportFile), { cwd: tests, env: testEnv });
      if (!ok(step)) throw new Error(`full batch ${i + 1} failed`);
      const report = readFreshReport(reportFile, Date.parse(step.startedAt));
      validateVitestExecution(report, step.exitCode, step.signal);
      validateTestReport(reportFile, Date.parse(step.startedAt), step.exitCode, step.signal, tests);
      reports.push(report);
      evidence.reports.push({ file: reportFile, sha256: sha256(reportFile),
        tests: report.testResults.flatMap(s => s.assertionResults || []).filter(a => a.status === "passed").length });
    }
    if (readFileSync(path.join(tests, "__baseline__/known-fails.txt"), "utf8").trim()) throw new Error("nonempty failure baseline");
    const merged = mergeBatchReports(batches, reports, tests);
    writeFileSync(path.join(tests, ".test-results.json"), JSON.stringify(merged));
    writeJunitReport(merged, path.join(tests, ".test-results.junit.xml"));
    validateTestReport(path.join(tests, ".test-results.json"), Date.parse(discovery.startedAt), 0, null, tests);
    if (!statSync(path.join(tests, ".test-results.junit.xml")).size) throw new Error("empty JUnit report");
    evidence.reports.push({ file: path.join(tests, ".test-results.json"), sha256: sha256(path.join(tests, ".test-results.json")),
      tests: merged.testResults.flatMap(s => s.assertionResults || []).filter(a => a.status === "passed").length });
    evidence.aggregateReports = [".test-results.json", ".test-results.junit.xml"].map(file => ({
      file: path.join(tests, file), bytes: statSync(path.join(tests, file)).size, sha256: sha256(path.join(tests, file)),
    }));
    evidence.steps.push({ id: "verify-test-reports", job: "vitest", kind: "check", status: "passed", at: now() });
    save();
  } catch (error) {
    anyFail = true;
    skip("verify-test-reports", "vitest", error.message, "failed");
  }
}

} else {
  await job("scoped-checks", [
    ["pnpm-install-root", "pnpm", pnpmInstall],
    ["pnpm-install-tests", "pnpm", pnpmInstall, { cwd: tests }],
    ["lint", "pnpm", ["run", "lint"]],
    ["check-docs", "pnpm", ["run", "check:docs"]],
  ]);
  if (evidence.riskFloor.risk === "upstream-watch") {
    await run("check-upstream-watch-shell", "scoped-checks", "bash", ["-n", "scripts/upstream-ported-ids.sh"]);
  }
  if (selected.length) {
    rmSync(path.join(tests, ".scoped-results.json"), { force: true });
    const step = await run("vitest-scoped", "vitest", "node", scopedTestArgs(tests, selected), {
      cwd: tests, env: { HOME: dirs.testHome, DATA_DIR: dirs.testData, BASELINE_BASE_REF: BASE },
    });
    try {
      evidence.reports.push(validateTestReport(path.join(tests, ".scoped-results.json"),
        Date.parse(step.startedAt), step.exitCode, step.signal, tests, selected));
    } catch (error) { anyFail = true; skip("scoped-report", "vitest", error.message, "failed"); }
  }
  await run("baseline-diff", "vitest", "node", ["__baseline__/verify-baseline-diff.mjs"], {
    cwd: tests, env: { BASELINE_BASE_REF: BASE },
  });
}
if (readFileSync(path.join(tests, "__baseline__/known-fails.txt"), "utf8").trim()) {
  anyFail = true;
  skip("empty-baseline", "vitest", "nonempty failure baseline", "failed");
}

// commitlint over exactly base..head (private tool install; config copied beside it
// so @commitlint/config-conventional resolves from the tool dir, hash checked).
const configCopy = path.join(dirs.tool, ".commitlintrc.cjs");
writeFileSync(configCopy, readFileSync(path.join(dirs.src, ".commitlintrc.cjs")));
// pnpm requires a manifest in the target dir (npm installed with --prefix did not).
writeFileSync(path.join(dirs.tool, "package.json"), JSON.stringify({ name: "commitlint-tool", private: true }));
const toolInstalled = ok(await run("commitlint-install", "commitlint", "pnpm", [
  "--dir", dirs.tool, "add",
  `@commitlint/cli@${COMMITLINT_CLI_VERSION}`, `@commitlint/config-conventional@${COMMITLINT_CONFIG_VERSION}`,
], { cwd: dirs.tool }));
if (toolInstalled) {
  const cli = path.join(dirs.tool, "node_modules", "@commitlint", "cli", "cli.js");
  for (const n of ["cli", "config-conventional"]) {
    evidence.toolchain[`commitlint-${n}`] = JSON.parse(
      readFileSync(path.join(dirs.tool, "node_modules", "@commitlint", n, "package.json"), "utf8"),
    ).version;
  }
  evidence.identities.commitlintConfigSha256 = sha256(configCopy);
  save();
  const common = [cli, "--config", configCopy, "--cwd", dirs.src];
  await run("commitlint-range", "commitlint", "node", [...common, "--from", BASE, "--to", HEAD, "--verbose"]);
  if (opts.title !== undefined) {
    await run("commitlint-title", "commitlint", "node", [...common, "--verbose"], { input: `${opts.title}\n` });
  } else skip("commitlint-title", "commitlint", "no --title supplied (old workflow only linted commits)", "skipped");
} else {
  skip("commitlint-range", "commitlint", "commitlint install did not pass", "not-run");
}

if (opts.mode === "full") {
  const coverageStep = requiredWebsiteCoverageStep(websiteRun, evidence.websiteBrowserCoverage, evidence.steps);
  if (coverageStep) {
    evidence.steps.push({ ...coverageStep, at: now() });
    if (coverageStep.status === "failed") anyFail = true;
    save();
  }
}
if (interrupted) finish(130, "interrupted");
const bad = anyFail || evidence.steps.some((s) => ["failed", "not-run", "interrupted"].includes(s.status));
finish(bad ? 1 : 0, bad ? "failed" : "passed");
}

if (isMainModule(import.meta.url)) {
  main().catch(error => { console.error(`local-ci: ${error.stack || error.message}`); process.exitCode = 1; });
}
