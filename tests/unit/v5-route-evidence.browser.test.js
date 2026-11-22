import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { serveDirectory } from "../utils/staticServer.mjs";
import { chromiumLaunchOptions } from "../utils/chromiumLaunch.mjs";
import { buildV5EvidenceReport } from "../utils/v5EvidenceReport.mjs";

/**
 * Browser evidence for V5 production surfaces.
 *
 * Every tests/e2e/v5-evidence/*.json file is `{ "route": "/dashboard/x", "stories": [<story id>...] }`
 * (one file per slice). Each story renders from the built storybook-static with the
 * V5 switch on (`data-ui="v5"`), in chromium at 1440x900 and 360x800, dark and light.
 * It must produce no console error or page error, no serious/critical axe violation
 * (wcag2a, wcag2aa, wcag21aa) and, at 360px, no horizontal document overflow. A
 * screenshot lands under .impeccable/review/v5/production/<route-slug>/.
 *
 * Runs only with RUN_V5_EVIDENCE=1. V5_EVIDENCE_ROUTES=<comma list> filters routes.
 * V5_STORYBOOK_DIR overrides the served directory (default <repo>/storybook-static).
 */
const enabled = process.env.RUN_V5_EVIDENCE === "1";
const root = resolve(import.meta.dirname, "../..");
const storybookDir = process.env.V5_STORYBOOK_DIR ? resolve(process.cwd(), process.env.V5_STORYBOOK_DIR) : resolve(root, "storybook-static");
const registryDir = resolve(root, "tests/e2e/v5-evidence");
const screenshotRoot = resolve(root, ".impeccable/review/v5/production");
const THEMES = ["dark", "light"];
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 360, height: 800 }];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);
const STORY_TIMEOUT = 20_000;
const evidenceReport = process.env.V5_EVIDENCE_REPORT ? resolve(root, process.env.V5_EVIDENCE_REPORT) : null;
const evidenceRows = [];

const slug = (value) => value.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";

function loadRegistry() {
  const entries = [];
  const files = existsSync(registryDir) ? readdirSync(registryDir).filter((name) => name.endsWith(".json")).sort() : [];
  for (const name of files) {
    const data = JSON.parse(readFileSync(resolve(registryDir, name), "utf8"));
    if (typeof data.route !== "string" || !data.route || !Array.isArray(data.stories) || data.stories.some((id) => typeof id !== "string")) {
      throw new Error(`${name}: expected {"route": string, "stories": string[]}`);
    }
    entries.push({ file: name, route: data.route, stories: data.stories });
  }
  return entries;
}

function selectedRoutes(registry) {
  const filter = (process.env.V5_EVIDENCE_ROUTES || "").split(",").map((route) => route.trim()).filter(Boolean);
  if (!filter.length) return registry;
  const known = new Set(registry.map((entry) => entry.route));
  const missing = filter.filter((route) => !known.has(route));
  if (missing.length) throw new Error(`V5_EVIDENCE_ROUTES names routes with no registry entry in tests/e2e/v5-evidence: ${missing.join(", ")}`);
  return registry.filter((entry) => filter.includes(entry.route));
}

/** Resolves once Storybook reports the story finished, or rejects on a render/play error. */
async function installStoryResult(page) {
  await page.addInitScript(() => {
    let channel;
    window.__v5StoryResult = null;
    const attach = (value) => {
      if (!value?.on || value.__v5Attached) return;
      value.__v5Attached = true;
      value.on("storyFinished", (payload) => { window.__v5StoryResult = payload; });
      for (const name of ["storyThrewException", "playFunctionThrewException", "unhandledErrorsWhilePlaying", "storyErrored"])
        value.on(name, (payload) => { window.__v5StoryResult = { status: "error", event: name, payload }; });
    };
    Object.defineProperty(window, "__STORYBOOK_ADDONS_CHANNEL__", {
      configurable: true,
      get: () => channel,
      set: (value) => { channel = value; attach(value); },
    });
  });
}

async function checkStory(browser, baseURL, route, id, theme, viewport) {
  const failures = [];
  const axeCounts = { minor: 0, moderate: 0, serious: 0, critical: 0 };
  let overflowPx = 0;
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  // Chromium's console text for a failed load omits the URL; record it for the report.
  page.on("response", (response) => { if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`); });
  page.on("requestfailed", (request) => consoleErrors.push(`request failed ${request.url()}: ${request.failure()?.errorText}`));
  await installStoryResult(page);
  try {
    await page.goto(`${baseURL}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=theme:${theme};ui:v5`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__v5StoryResult !== null, null, { timeout: STORY_TIMEOUT });
    const result = await page.evaluate(() => window.__v5StoryResult);
    if (result.status !== "success") failures.push(`story did not finish: ${JSON.stringify(result).slice(0, 400)}`);
    await page.evaluate(() => document.fonts.ready);
    const state = await page.evaluate(() => ({
      ui: document.documentElement.dataset.ui,
      theme: document.documentElement.style.colorScheme,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    if (state.ui !== "v5") failures.push(`html data-ui is ${JSON.stringify(state.ui)}, expected "v5"`);
    overflowPx = Math.max(0, state.scrollWidth - state.innerWidth);
    if (viewport.width === 360 && overflowPx > 0) failures.push(`horizontal overflow at 360: scrollWidth ${state.scrollWidth} > innerWidth ${state.innerWidth}`);

    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    for (const violation of axe.violations) axeCounts[violation.impact] = (axeCounts[violation.impact] || 0) + 1;
    for (const violation of axe.violations.filter((entry) => BLOCKING.has(entry.impact))) {
      failures.push(`axe ${violation.impact} ${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
    }

    const dir = resolve(screenshotRoot, slug(route));
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `${id}-${theme}-${viewport.width}.png`), fullPage: true });
    // Collected after the screenshot so late console output from settling is included.
    for (const text of consoleErrors) failures.push(`console error: ${text.slice(0, 300)}`);
  } catch (error) {
    failures.push(`render failed: ${error.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
  evidenceRows.push({ route, story: id, theme, width: viewport.width, pass: failures.length === 0, axeViolationsByImpact: axeCounts, consoleErrorCount: consoleErrors.length, overflowPx });
  return failures.map((failure) => `[${theme} ${viewport.width}px] ${failure}`);
}

const registry = enabled ? loadRegistry() : [];
const routes = enabled ? selectedRoutes(registry) : [];

describe.skipIf(!enabled)("v5 production route evidence", () => {
  let server;
  let browser;
  let storyIds = new Set();

  beforeAll(async () => {
    const indexPath = resolve(storybookDir, "index.json");
    if (!existsSync(indexPath)) throw new Error(`${indexPath} is missing: run \`pnpm run storybook:build\` before RUN_V5_EVIDENCE=1`);
    storyIds = new Set(Object.values(JSON.parse(readFileSync(indexPath, "utf8")).entries).filter((entry) => entry.type === "story").map((entry) => entry.id));
    server = await serveDirectory(storybookDir);
    browser = await chromium.launch(chromiumLaunchOptions(chromium, root));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (evidenceReport) {
      mkdirSync(resolve(evidenceReport, ".."), { recursive: true });
      writeFileSync(evidenceReport, `${JSON.stringify(buildV5EvidenceReport(evidenceRows, root), null, 2)}\n`);
    }
  });

  it("has a registry entry with stories for every selected route", () => {
    expect(registry.length, "tests/e2e/v5-evidence has no *.json files").toBeGreaterThan(0);
    for (const entry of routes) expect(entry.stories.length, `${entry.file} lists no stories`).toBeGreaterThan(0);
  });

  for (const entry of routes) {
    describe(`${entry.route} (${entry.file})`, () => {
      for (const id of entry.stories) {
        it(`${id} renders cleanly with the V5 switch on`, async () => {
          expect(storyIds.has(id), `${id} is not in storybook-static/index.json`).toBe(true);
          const failures = [];
          for (const theme of THEMES) for (const viewport of VIEWPORTS) failures.push(...await checkStory(browser, server.url, entry.route, id, theme, viewport));
          expect(failures, `${id}\n${failures.join("\n")}`).toEqual([]);
        }, 120_000);
      }
    });
  }
});
