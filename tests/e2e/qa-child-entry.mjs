#!/usr/bin/env node
// Contained QA child entrypoint. Runs once per worker, launched by the
// container's ENTRYPOINT (node). Validates that the process tree was
// started inside a hardened container, writes the authority marker the
// fixture layer cross-checks, then spawns the actual Playwright CLI with a
// fixed allowlist of command/target combinations.
//
// CLI grammar (compose passes these directly via the service `command:`):
//   qa-child-entry.mjs test --target <app|storybook> [-- <extra>]
//
// `--target` defaults to "app" (the compose service's default `command:`
// already provides it; the entry accepts either form so the file can be
// smoke-run from inside an image with no override).
// The worker count is hardcoded to 1: the Playwright CLI flag is appended
// to every spawned invocation regardless of host input. H1 startQa creates
// a per-worker fresh run dir, so there is intentionally no global
// `run-dir` flag (the launcher owns that decision, not this entry).

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeContainerAuthorityManifest } from "./runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HARNESS_DIR = path.join(ROOT, "tests/e2e");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules/playwright/cli.js");
const STORYBOOK_STATIC = path.join(ROOT, "storybook-static");
const RUNS_DIR = path.join(ROOT, "qa/runs");
const ALLOWED_COMMANDS = new Set(["test"]);
const ALLOWED_TARGETS = new Set(["app", "storybook"]);
const HARDCODED_WORKERS = "1";

function fail(message, code = 64) {
  process.stderr.write(`[ui-qa] ${message}\n`);
  process.exit(code);
}

// Hard-containment guard. Failures here mean the entry was launched without
// the documented Compose contract — never proceed; fail closed.
function requireContained() {
  if (process.env.DURIN_QA_HARDENED !== "1") {
    fail("refuses to run outside hardened QA container", 77);
  }
  if (process.env.DURIN_QA_DB_HOST || process.env.DATABASE_URL) {
    fail("refuses host database configuration", 77);
  }
  if (process.env.DOCKER_HOST || process.env.KUBERNETES_SERVICE_HOST) {
    fail("refuses docker host credentials", 77);
  }
  if (!process.env.DURIN_QA_FAKE_UPSTREAM_HOST) {
    fail("DURIN_QA_FAKE_UPSTREAM_HOST is required", 77);
  }
  if (!process.argv[1] || !process.argv[1].endsWith("qa-child-entry.mjs")) {
    fail("entrypoint must be qa-child-entry.mjs", 77);
  }
}

// Permit only a fixed, documented set of CLI shapes. Anything else fails
// closed with a 64 (EX_USAGE) before we ever spawn a process. We accept
// --target on the wire for the storybook opt-in path, but --workers is
// always overridden by HARDCODED_WORKERS at the spawn site.
function readFlags(argv) {
  const out = { command: null, target: null, remaining: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      const value = argv[++i];
      if (value === undefined) fail("--target requires a value");
      out.target = value;
      continue;
    }
    if (arg === "--workers") {
      // Accept the flag for symmetry with the compose `command:` shape, but
      // ignore the supplied value — workers is hardcoded to 1 below.
      argv[++i];
      continue;
    }
    if (out.command === null) { out.command = arg; continue; }
    out.remaining.push(arg);
  }
  if (!out.command || !ALLOWED_COMMANDS.has(out.command)) {
    fail(`command must be one of: ${[...ALLOWED_COMMANDS].join(", ")}`);
  }
  if (out.target === null) out.target = "app";
  if (!ALLOWED_TARGETS.has(out.target)) {
    fail(`target must be one of: ${[...ALLOWED_TARGETS].join(", ")}`);
  }
  return out;
}

// Construct the explicit, allowlisted environment the child Playwright
// process is allowed to see. Never `process.env` spread: host-side
// credentials (e.g. AWS_*, GH_*, npm tokens accidentally exported by the
// developer's shell) MUST NOT leak through the launcher's environment.
function buildChildEnv(target, invocationRoot) {
  const allow = [
    "PATH", "NODE_PATH", "LANG", "LC_ALL", "TZ",
    "NODE_ENV", "NEXT_TELEMETRY_DISABLED", "HOSTNAME", "PORT",
    "PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
    "DURIN_QA_HARDENED", "DURIN_QA_ROLE",
    "DURIN_QA_FAKE_UPSTREAM_HOST", "DURIN_QA_FAKE_UPSTREAM_PORT",
    "DURIN_QA_WORKER_ID", "DURINDOOR_QA_MODE",
    "DURINDOOR_CANDIDATE_SHA",
  ];
  const env = {};
  for (const key of allow) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // One Playwright invocation gets one host-mounted root. Its HOME/cache are
  // private to that root; Playwright creates browser profiles below it per
  // worker, so no browser or auth cache is shared with another invocation.
  env.HOME = path.join(invocationRoot, "home");
  env.XDG_CACHE_HOME = path.join(invocationRoot, "cache");
  // Chromium uses temp files for renderer shared memory; the container's
  // small /tmp cannot also hold profiles, traces, and rendered pages.
  env.TMPDIR = path.join(invocationRoot, "tmp");
  env.DURIN_QA_HARD_DIR = invocationRoot;
  env.DURIN_QA_AUTHORITY_MANIFEST = path.join(invocationRoot, ".authority.json");
  env.DURIN_QA_WORKER_ID = String(process.env.DURIN_QA_WORKER_ID || "0");
  env.DURINDOOR_QA_MODE = target;
  return env;
}

// Pre-flight: ensure the run dir exists with mode 0700 owned by the running
// uid. The bind mount from compose overlays this with a host-owned tempdir
// at runtime; if that mount is missing (e.g. local smoke) the directory must
// still be writable by the non-root user.
async function createInvocationRoot() {
  const invocationRoot = await fs.mkdtemp(path.join(RUNS_DIR, "invocation-"));
  await fs.chmod(invocationRoot, 0o700);
  await fs.mkdir(path.join(invocationRoot, "home"), { mode: 0o700 });
  await fs.mkdir(path.join(invocationRoot, "cache"), { mode: 0o700 });
  await fs.mkdir(path.join(invocationRoot, "tmp"), { mode: 0o700 });
  return invocationRoot;
}

async function runPlaywright({ command, target, remaining, invocationRoot }) {
  const configPath = path.join(ROOT, "playwright.config.mjs");
  const args = [
    PLAYWRIGHT_CLI,
    command,
    `--config=${configPath}`,
    `--workers=${HARDCODED_WORKERS}`,
    "--reporter=list",
    ...remaining,
  ];
  // Forward signals so Ctrl-C / docker stop / compose down propagate to the
  // spawned Playwright process and the entry exits with the exact code Node
  // saw, not a wrapper-injected 130. spawn() (not spawnSync) so we can relay
  // SIGTERM/SIGINT live and reap the exit code.
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, args, {
      cwd: ROOT,
      env: buildChildEnv(target, invocationRoot),
      stdio: "inherit",
    });
    const forward = (signal) => { if (proc.exitCode === null) proc.kill(signal); };
    process.once("SIGTERM", () => forward("SIGTERM"));
    process.once("SIGINT", () => forward("SIGINT"));
    process.once("SIGHUP", () => forward("SIGHUP"));
    proc.once("error", (error) => fail(`failed to launch Playwright: ${error.message}`, 70));
    proc.once("close", (code, signal) => {
      if (code !== null) return resolve(code);
      if (signal === "SIGINT" || signal === "SIGTERM") return resolve(130);
      return resolve(1);
    });
  });
}

async function ensureRunsDir() {
  await fs.mkdir(RUNS_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(RUNS_DIR, 0o700);
}

async function main() {
  requireContained();
  const flags = readFlags(process.argv.slice(2));
  await ensureRunsDir();
  const invocationRoot = await createInvocationRoot();
  // Marker is invocation-private and must exist before any test runner starts;
  // fixtures cross-check it to prove this hardened entry launched process tree.
  await writeContainerAuthorityManifest(path.join(invocationRoot, ".authority.json"));
  if (flags.target === "storybook") {
    const stat = await fs.stat(STORYBOOK_STATIC).catch(() => null);
    if (!stat || !stat.isDirectory()) fail("storybook-static is not present in image", 77);
  }
  const code = await runPlaywright({ ...flags, invocationRoot });
  process.exit(code);
}

main().catch((error) => fail(error?.message || String(error), 70));
