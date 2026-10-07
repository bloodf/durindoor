import { defineConfig } from "@playwright/test";

// Point the same user-flow suite at a running production build or deployment.
const baseURL = process.env.DOCS_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  testMatch: "docs.spec.mjs",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "/tmp/omc-docs/playwright-docs-results",
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  webServer: process.env.DOCS_BASE_URL ? undefined : {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
