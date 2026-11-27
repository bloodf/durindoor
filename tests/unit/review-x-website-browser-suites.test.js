import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import config from "../../website/playwright.config.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");

describe("website browser validation", () => {
  it("installs Chromium and runs all suites in the website CI job after its build", () => {
    const job = read(".github/workflows/ci.yml").split("  website-build:")[1];
    expect(job).toMatch(/name: Build website[\s\S]*?working-directory: website[\s\S]*?run: pnpm run build[\s\S]*?name: Install Chromium[\s\S]*?working-directory: website[\s\S]*?run: pnpm exec playwright install --with-deps chromium[\s\S]*?name: Run website browser suites[\s\S]*?working-directory: website[\s\S]*?run: pnpm exec playwright test/);
  });

  it("runs sharded browser suites under the local website condition and fails missing browsers", () => {
    const local = read("scripts/local-ci.mjs");
    expect(local).toMatch(/if \(!websiteRun\)[\s\S]*?else \{[\s\S]*?website-build[\s\S]*?websiteBrowserInventoryCommand[\s\S]*?planWebsiteBrowserShards[\s\S]*?websiteBrowserShardCommands[\s\S]*?verifyWebsiteBrowserCoverage/);
    expect(local).toMatch(/else if \(!browserAvailable\) \{\s*anyFail = true;\s*skip\("website-browser-suites", "website-build", "required website browser suites cannot run: no executable Chromium browser", "failed"\)/);
    expect(local).not.toContain("browser suites skipped: no browser");
    expect(local).toMatch(/await planWebsiteBrowserShards[\s\S]*?--shard=\$\{shard.shard\}[\s\S]*?extractPlaywrightTests/);
    expect(local).toMatch(/requiredWebsiteCoverageStep\(websiteRun, evidence\.websiteBrowserCoverage, evidence\.steps\)[\s\S]*?evidence\.steps\.push[\s\S]*?coverageStep\.status === "failed"\) anyFail = true/);
    expect(JSON.parse(read("website/package.json")).scripts["test:browser"]).toBe("playwright test");
  });

  it("points every configured suite at an existing file", () => {
    expect(config.testMatch.length).toBeGreaterThan(0);
    for (const suite of config.testMatch) {
      expect(typeof suite).toBe("string");
      expect(existsSync(path.join(root, "website/tests", suite)), suite).toBe(true);
    }
  });
});
