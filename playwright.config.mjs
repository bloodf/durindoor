import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { validatedQaHardDir } from "./tests/e2e/boundaries.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Listing specs never executes a worker, so it must not allocate or require
// an invocation root. Every real run receives DURIN_QA_HARD_DIR from the
// hardened entry; we validate it here so a missing/misplaced value fails
// fast in the actual run, never silently sharing report directories.
const listingTests = process.argv.includes("--list");
const invocationRoot = listingTests
  ? null
  : validatedQaHardDir(ROOT, process.env.DURIN_QA_HARD_DIR);

const storybook = process.env.DURINDOOR_QA_MODE === "storybook";
const browsers = ["chromium", "firefox", "webkit"];
const themes = ["dark", "light"];

// Per-engine mobile emulation. `isMobile` is only honored in Chromium/WebKit;
// Firefox rejects it. hasTouch + the small viewport work everywhere.
const mobile = (browserName) => {
  const base = { viewport: { width: 390, height: 844 }, hasTouch: true };
  if (browserName === "firefox") return base;
  return { ...base, isMobile: true, screen: { width: 390, height: 844 } };
};

const desktop = { viewport: { width: 1440, height: 900 } };

const projects = browsers.flatMap((browserName) => themes.flatMap((colorScheme) =>
  Object.entries({ desktop, mobile: mobile(browserName) }).map(([viewportName, viewport]) => ({
    name: `${browserName}-${colorScheme}-${viewportName}`,
    use: { browserName, colorScheme, ...viewport, serviceWorkers: "block" },
  })),
));

// Storybook mode selects only the storybook runner; app mode runs every other
// e2e spec and ignores storybook.spec.js without a fragile negative regex.
// One worker by default: each owns an isolated mutable backend.
const testMatch = storybook ? "**/storybook.spec.js" : "**/*.spec.js";
const testIgnore = storybook ? [] : ["**/storybook.spec.js"];

const runConfig = listingTests ? null : {
  testDir: "./tests/e2e",
  testMatch,
  testIgnore,
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // All artifacts land under the validated invocation root, so parallel
  // invocations never share outputDir or HTML report folders.
  outputDir: path.join(invocationRoot, "playwright-results"),
  reporter: [["list"], ["html", { outputFolder: path.join(invocationRoot, "playwright-report"), open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects,
};

const listConfig = {
  testDir: "./tests/e2e",
  testMatch,
  testIgnore,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: "list",
  projects,
};

export default defineConfig(listingTests ? listConfig : runConfig);
