import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import {
  TRANSIENT_STATE_ENV,
  transientServerPlan,
  transientStatePath,
} from "./scripts/transient-server.mjs";

// The browser suite owns exactly one host server and only for the length of
// the run: it binds 127.0.0.1, starts with the tests, stops with them, and
// never attaches to a server that already exists. There is no unit, schedule
// or daemon behind it, so nothing survives the run.
//
// The port is fixed and explicit rather than inherited from a running server,
// because a discovered port is how a suite ends up talking to yesterday's
// process. `reuseExistingServer: false` makes an occupied port a hard failure
// instead of a silent attach.
const plan = transientServerPlan();
const stateFile = transientStatePath();
process.env[TRANSIENT_STATE_ENV] = stateFile;

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
  outputDir: join(tmpdir(), "omc-docs", `playwright-docs-results-${plan.port}`),
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
    env: { ...plan.env, [TRANSIENT_STATE_ENV]: stateFile },
  },
});
