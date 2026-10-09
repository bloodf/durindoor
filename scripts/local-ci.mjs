#!/usr/bin/env node
// Local CI runner: mirrors the former ci.yml, test.yml and commitlint.yml gates
// against an exact, caller-supplied base/head commit pair. It runs everything
// in a private snapshot with private HOME/npm cache/DATA_DIR, writes JSON
// evidence, and NEVER publishes a GitHub status. See CONTRIBUTING.md.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const NODE_VERSION = "20.20.2";
const NPM_VERSION = "10.8.2";
const COMMITLINT_CLI_VERSION = "18.6.1"; // pins from wagoid/commitlint-github-action v5.5.1 / commitlint.yml
const COMMITLINT_CONFIG_VERSION = "18.6.3";
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const USAGE = `Usage: node scripts/local-ci.mjs --base <full-sha> --head <full-sha> [options]
  --repo <dir>         source repository (default: cwd)
  --out <dir>          new evidence/workspace dir (default: ~/.cache/durindoor-local-ci/<head12>-<utc>)
  --path-prepend <dir> directory with Node ${NODE_VERSION} (and npm ${NPM_VERSION}) put first on PATH
  --website auto|always  auto (default): build website only if docs/ or website/ differ base..head
  --title <text>       also commitlint this PR title (squash-merge subject)
Exit: 0 all required steps passed, 1 failure, 130 interrupted, 2 usage/prerequisite error.`;

let opts;
try {
  opts = parseArgs({
    options: {
      base: { type: "string" }, head: { type: "string" }, repo: { type: "string" },
      out: { type: "string" }, "path-prepend": { type: "string" },
      website: { type: "string", default: "auto" }, title: { type: "string" },
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

const repo = path.resolve(opts.repo ?? process.cwd());
const BASE = opts.base;
const HEAD = opts.head;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const out = path.resolve(
  opts.out ?? path.join(os.homedir(), ".cache", "durindoor-local-ci", `${HEAD.slice(0, 12)}-${stamp}`),
);
if (existsSync(out)) usageDie(`--out already exists, refusing to reuse: ${out}`);
const dirs = {
  logs: path.join(out, "logs"), src: path.join(out, "src"), home: path.join(out, "home"),
  testHome: path.join(out, "durindoor-home"), data: path.join(out, "durindoor-data-build"),
  testData: path.join(out, "durindoor-data-test"),
  cache: path.join(out, "npm-cache"), tool: path.join(out, "commitlint-tool"),
};
for (const d of Object.values(dirs)) if (d !== dirs.src) mkdirSync(d, { recursive: true });

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const now = () => new Date().toISOString();

const evidence = {
  schema: "durindoor-local-ci/1",
  startedAt: now(), endedAt: null, status: "running",
  note: "Produced by scripts/local-ci.mjs. This runner never publishes GitHub statuses.",
  repo, base: BASE, head: HEAD, out,
  options: { website: opts.website, title: opts.title ?? null, pathPrepend: opts["path-prepend"] ?? null },
  identities: {}, toolchain: { required: { node: NODE_VERSION, npm: NPM_VERSION } },
  steps: [],
};
const save = () => {
  const tmp = path.join(out, "evidence.json.tmp");
  writeFileSync(tmp, JSON.stringify(evidence, null, 2) + "\n");
  renameSync(tmp, path.join(out, "evidence.json"));
};
save();

const baseEnv = {
  ...process.env,
  HOME: dirs.home, DATA_DIR: dirs.data, CI: "true",
  npm_config_cache: dirs.cache, npm_config_update_notifier: "false",
  PATH: [opts["path-prepend"], process.env.PATH].filter(Boolean).join(path.delimiter),
};
const envOverrides = (extra = {}) => ({
  HOME: baseEnv.HOME, DATA_DIR: baseEnv.DATA_DIR, CI: "true",
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
  const log = path.join(dirs.logs, `${String(++seq).padStart(2, "0")}-${id}.log`);
  step.stdoutStderrLog = log;
  step.startedAt = now();
  save();
  const fd = openSync(log, "w");
  await new Promise((resolve) => {
    try {
      child = spawn(cmd, args, {
        cwd, env: { ...baseEnv, ...env }, detached: true,
        stdio: [input === undefined ? "ignore" : "pipe", fd, fd],
      });
    } catch (e) { step.spawnError = String(e); resolve(); return; }
    if (input !== undefined) child.stdin.end(input);
    child.on("error", (e) => { step.spawnError = String(e); resolve(); });
    child.on("close", (code, signal) => { step.exitCode = code; step.signal = signal; resolve(); });
  });
  child = null;
  closeSync(fd);
  step.endedAt = now();
  step.logSha256 = sha256(log);
  step.status = interrupted ? "interrupted"
    : step.spawnError || step.signal || !expectOk(step.exitCode) ? "failed" : "passed";
  if (step.status !== "passed") anyFail = true;
  save();
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
  return { s, text: readLog(s) };
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
  "package-lock.json", "website/package-lock.json", "tests/package-lock.json", ".nvmrc", ".commitlintrc.cjs",
]) {
  const p = path.join(dirs.src, f);
  evidence.identities.files[f] = existsSync(p) ? sha256(p) : null;
}
save();

// ---- toolchain: refuse a wrong Node/npm instead of silently running ---------
const nodeStep = await run("toolchain-node", "setup", "node", ["--version"]);
const npmStep = await run("toolchain-npm", "setup", "npm", ["--version"]);
// (readLog defined above)
evidence.toolchain.node = readLog(nodeStep);
evidence.toolchain.npm = readLog(npmStep);
const nvmrc = readFileSync(path.join(dirs.src, ".nvmrc"), "utf8").trim();
if (evidence.toolchain.node !== `v${NODE_VERSION}` || evidence.toolchain.npm !== NPM_VERSION || nvmrc !== NODE_VERSION) {
  skip(
    "toolchain-check", "setup",
    `need node v${NODE_VERSION} (.nvmrc=${nvmrc}) and npm ${NPM_VERSION}; got node ${evidence.toolchain.node || "?"}, npm ${evidence.toolchain.npm || "?"}. Use --path-prepend.`,
    "failed",
  );
  finish(2, "prerequisite-error");
}
save();

// ---- jobs ------------------------------------------------------------------
const npmCi = ["ci", "--no-audit", "--no-fund"];
const web = path.join(dirs.src, "website");
const tests = path.join(dirs.src, "tests");

// Website decision: exact base/head diff of docs/ and website/ (old rule: git diff --quiet).
let websiteRun = true;
let websiteReason = "--website always";
if (opts.website === "auto") {
  const d = await run("website-diff", "website-changes", "git", ["diff", "--quiet", BASE, HEAD, "--", "docs", "website"], {
    expectOk: (c) => c === 0 || c === 1,
  });
  if (!ok(d)) { websiteRun = null; }
  else {
    websiteRun = d.exitCode === 1;
    websiteReason = websiteRun ? "docs/ or website/ changed between base and head" : "no docs/ or website/ change between base and head";
  }
}
evidence.identities.websiteDecision = { run: websiteRun, reason: websiteReason };
save();

// lint-and-build
await job("lint-and-build", [
  ["npm-ci-root", "npm", npmCi],
  ["lint", "npm", ["run", "lint"]],
  ["check-agent-index", "npm", ["run", "check:agent-index"]],
  ["check-postgres-migrations", "npm", ["run", "check:postgres-migrations"]],
  ["build-isolated-state", "npm", ["run", "build"]],
]);

// Each CI job did its own checkout + installs, so each job here runs its own
// installs in order and is independent of the other jobs' outcome.
// website-build (conditional)
if (websiteRun === null) {
  for (const id of ["npm-ci-root", "npm-ci-website", "website-build", "check-docs", "check-provider-catalog"]) {
    skip(id, "website-build", "website diff could not be evaluated", "not-run");
  }
} else if (!websiteRun) {
  // Explicit skip: not a pass. check:docs / check:provider-catalog lived in this CI job.
  for (const id of ["npm-ci-root", "npm-ci-website", "website-build", "check-docs", "check-provider-catalog"]) {
    skip(id, "website-build", `conditional job skipped: ${websiteReason}`, "skipped");
  }
} else {
  await job("website-build", [
    ["npm-ci-root", "npm", npmCi],
    ["npm-ci-website", "npm", npmCi, { cwd: web }],
    ["website-build", "npm", ["run", "build"], { cwd: web }],
    ["check-docs", "npm", ["run", "check:docs"]],
    ["check-provider-catalog", "npm", ["run", "check:provider-catalog"]],
  ]);
}

// vitest + no-regression gate (independent of lint-and-build / website-build outcome)
await job("vitest", [
  ["npm-ci-root", "npm", npmCi],
  ["npm-ci-website", "npm", npmCi, { cwd: web }],
  ["npm-ci-tests", "npm", npmCi, { cwd: tests }],
  ["vitest-test-ci", "npm", ["run", "test:ci"], {
    cwd: tests, env: { HOME: dirs.testHome, DATA_DIR: dirs.testData, BASELINE_BASE_REF: BASE },
  }],
]);
// "Verify test reports" ran with if: always() in test.yml.
{
  const reports = ["tests/.test-results.json", "tests/.test-results.junit.xml"].map((f) => {
    const p = path.join(dirs.src, f);
    return { file: f, bytes: existsSync(p) ? statSync(p).size : 0, sha256: existsSync(p) ? sha256(p) : null };
  });
  const good = reports.every((r) => r.bytes > 0);
  evidence.steps.push({ id: "verify-test-reports", job: "vitest", kind: "check", reports, status: good ? "passed" : "failed", at: now() });
  if (!good) anyFail = true;
  save();
}

// commitlint over exactly base..head (private tool install; config copied beside it
// so @commitlint/config-conventional resolves from the tool dir, hash checked).
const configCopy = path.join(dirs.tool, ".commitlintrc.cjs");
writeFileSync(configCopy, readFileSync(path.join(dirs.src, ".commitlintrc.cjs")));
const toolInstalled = ok(await run("commitlint-install", "commitlint", "npm", [
  "install", "--no-audit", "--no-fund", "--no-save", "--no-package-lock", "--prefix", dirs.tool,
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

if (interrupted) finish(130, "interrupted");
const bad = anyFail || evidence.steps.some((s) => ["failed", "not-run", "interrupted"].includes(s.status));
finish(bad ? 1 : 0, bad ? "failed" : "passed");
