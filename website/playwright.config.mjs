import { defineConfig } from "@playwright/test";

// Point the same user-flow suite at a running production build or deployment.
const baseURL = process.env.DOCS_BASE_URL || "http://localhost:3000";

const useOptions = { baseURL, trace: "retain-on-failure", viewport: { width: 1280, height: 800 } };
if (process.env.WEBSITE_CHROMIUM_EXECUTABLE) useOptions.launchOptions = { executablePath: process.env.WEBSITE_CHROMIUM_EXECUTABLE };

export default defineConfig({
  testDir: "./tests",
  testMatch: ["docs.spec.mjs", "marketing.spec.mjs"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "/tmp/omc-docs/playwright-docs-results",
  use: useOptions,
  webServer: process.env.DOCS_BASE_URL ? undefined : {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
