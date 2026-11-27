import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import {
  TRANSIENT_OWNER_ENV,
  TRANSIENT_RUNNER_ENV,
  TRANSIENT_STATE_ENV,
  transientServerPlan,
  transientStatePath,
} from "./scripts/transient-server.mjs";

// The browser suite owns exactly one host server and only for the length of
// the run: it binds 127.0.0.1, starts with the tests, stops with them, and
// never attaches to a server that already exists. There is no unit, schedule
// or daemon behind it, so nothing survives the run.
//
// The port is explicit rather than inherited from a running server, because a
// discovered port is how a suite ends up talking to yesterday's process.
// `reuseExistingServer: false` makes an occupied port a hard failure instead
// of a silent attach. local-ci gives each shard its own free port, private
// state file and owner token through WEBSITE_TRANSIENT_*; a direct run falls
// back to port 3100, a per-process state file and a fresh token. Workers load
// this file again, so the chosen values are pinned into process.env once.
const plan = transientServerPlan();
process.env[TRANSIENT_OWNER_ENV] = plan.owner;
const stateFile = process.env[TRANSIENT_STATE_ENV] || transientStatePath();
process.env[TRANSIENT_STATE_ENV] = stateFile;
// Only the main runner starts the web server; its PID lets the launcher stop
// the server when the runner is killed before it can clean up. Workers
// (TEST_WORKER_INDEX set) inherit the main runner's value; an inherited value
// in the main runner is ignored so a nested run cannot watch a foreign PID.
const runnerPid = process.env.TEST_WORKER_INDEX === undefined
  ? String(process.pid)
  : process.env[TRANSIENT_RUNNER_ENV];
process.env[TRANSIENT_RUNNER_ENV] = runnerPid;

// Minimal Linux hosts can lack Fontconfig entirely. Chromium then gives text
// zero dimensions, even for web fonts. Use the bundled fonts in that case.
if (process.platform === "linux" && !process.env.FONTCONFIG_FILE && !existsSync("/etc/fonts/fonts.conf")) {
  process.env.FONTCONFIG_FILE = fileURLToPath(new URL("./tests/fontconfig-fallback.conf", import.meta.url));
}

const useOptions = { baseURL: plan.baseURL, trace: "retain-on-failure", viewport: { width: 1280, height: 800 } };
if (process.env.WEBSITE_CHROMIUM_EXECUTABLE) useOptions.launchOptions = { executablePath: process.env.WEBSITE_CHROMIUM_EXECUTABLE };

export default defineConfig({
  testDir: "./tests",
  testMatch: ["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  reporter: "list",
  outputDir: `/tmp/omc-docs/playwright-docs-results-${plan.port}`,
  globalSetup: "./tests/global-setup.mjs",
  use: useOptions,
  webServer: {
    command: plan.command,
    // The probe asks whether the server is serving, not whether every page
    // renders. A static public asset answers that without turning a broken
    // page into an opaque readiness timeout; the specs assert page health.
    url: `${plan.url}/robots.txt`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
    env: { ...plan.env, [TRANSIENT_STATE_ENV]: stateFile, [TRANSIENT_RUNNER_ENV]: runnerPid },
  },
});
