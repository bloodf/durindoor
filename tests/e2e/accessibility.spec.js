import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, authSensitiveTest } from "./fixtures.js";

const manifestPath = fileURLToPath(new URL("./routes.json", import.meta.url));
const { routes } = JSON.parse(await readFile(manifestPath, "utf8"));
const wcagTags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

function seedId(seed, key) {
  const value = seed.ids[key];
  if (!value) throw new Error(`Missing required seed id: ids.${key}`);
  return value;
}

function resolveVariantUrl(variant, seed) {
  if (variant.url) return variant.url;
  if (variant.urlFrom === "seed.ids.comboIds[0]") return `/dashboard/media-providers/combo/${seedId(seed, "comboIds")[0]}`;
  if (variant.urlFrom === "seed.ids.mediaProviderNodeId") return `/dashboard/media-providers/embedding/${seedId(seed, "mediaProviderNodeId")}`;
  if (variant.urlFrom === "seed.ids.traceIds[0]") return `/dashboard/timeline/${seedId(seed, "traceIds")[0]}`;
  if (variant.urlFrom === "seed.ids.openaiCompatibleNodeId") return `/dashboard/providers/${seedId(seed, "openaiCompatibleNodeId")}`;
  if (variant.urlFrom === "seed.ids.anthropicCompatibleNodeId") return `/dashboard/providers/${seedId(seed, "anthropicCompatibleNodeId")}`;
  throw new Error(`No concrete URL resolver for variant urlFrom=${variant.urlFrom}`);
}

async function installLoginIntercept(page, kind) {
  const handler = async (routeRequest) => {
    const request = routeRequest.request();
    if (new URL(request.url()).pathname !== "/api/auth/login") return routeRequest.fallback();
    if (kind === "rate-limit") return routeRequest.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many failed attempts.", retryAfter: 30 }) });
    return routeRequest.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ mustChangePassword: true, requiresPasswordChange: true, proof: "fixture-proof-token" }) });
  };
  await page.route("**/*", handler);
  return handler;
}

function resolveExpectedText(route, variant, seed) {
  if (variant.expectedText) return variant.expectedText;
  if (variant.expectedFinalText) return variant.expectedFinalText;
  if (variant.expectedTextFrom === "seed.ids.openaiCompatibleNodeId" || variant.expectedTextFrom === "seed.ids.anthropicCompatibleNodeId") {
    const id = variant.expectedTextFrom === "seed.ids.openaiCompatibleNodeId" ? seedId(seed, "openaiCompatibleNodeId") : seedId(seed, "anthropicCompatibleNodeId");
    const record = seed.records.mediaProviders?.find((node) => node.id === id);
    if (!record?.name) throw new Error(`Missing required seeded provider node record: ${id}`);
    return record.name;
  }
  return route.expectedText;
}

async function expectVisible(page, text, locator = "text") {
  if (locator === "label") return expect(page.getByLabel(text, { exact: true })).toBeVisible();
  if (locator === "title") return expect(page.getByTitle(text, { exact: true })).toBeVisible();
  if (["button", "combobox", "group", "img", "region", "heading", "table"].includes(locator)) return expect(page.getByRole(locator, { name: text, exact: true })).toBeVisible();
  if (typeof text === "string" && text.includes("%d")) return expect(page.getByText(new RegExp(text.replace("%d", "\\d+")), { exact: false }).first()).toBeVisible();
  return expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

async function waitForSentinel(page, route, variant, seed) {
  if (variant.expectedHttpStatus === 404) return expect(page.getByText("This page could not be found.", { exact: true })).toBeVisible();
  if (variant.destination) {
    await expect(page).toHaveURL(new RegExp(`${variant.destination.replace(/\//g, "\\/")}(?:[/?].*)?$`));
    const finalText = variant.expectedFinalText || variant.expectedText;
    if (finalText) await expectVisible(page, finalText, variant.expectedLocator || "text");
    if (route.id === "R18" || route.id === "R37") await expectVisible(page, "Date range", "group");
    return;
  }
  if (route.id === "R36" && variant.injectLogin429) {
    await page.locator("#dashboard-password").fill("fixture-password");
    await page.getByRole("button", { name: "Login", exact: true }).click();
    return expect(page.getByRole("button", { name: /Wait \d+s/ })).toBeVisible();
  }
  if (route.id === "R36" && variant.injectForcedPasswordChange) {
    await page.locator("#dashboard-password").fill("fixture-password");
    await page.getByRole("button", { name: "Login", exact: true }).click();
    return expect(page.getByRole("button", { name: "Set password", exact: true })).toBeVisible();
  }
  if (route.id === "R36") return expectVisible(page, "DurinDoor", "img");
  const expected = resolveExpectedText(route, variant, seed);
  if (!expected) throw new Error(`${route.id} ${variant.url || variant.urlFrom} has no rendered sentinel`);
  const locator = variant.expectedLocator || route.expectedLocator || (variant.headingLocator ?? route.headingLocator ?? true ? "heading" : "text");
  return expectVisible(page, expected, locator);
}

function defineAccessibilityTest(route, variant, routeTest) {
  routeTest(`accessibility ${route.id} ${variant.url || variant.urlFrom} [${variant.branch || variant.seedScenario || route.fixture || "baseline"}]`, async ({ page, qa }, testInfo) => {
    const consoleErrors = []; const pageErrors = [];
    const onConsole = (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location()?.url || null }); };
    const onPageError = (error) => pageErrors.push(error.message);
    page.on("console", onConsole); page.on("pageerror", onPageError);
    let loginHandler = null;
    try {
      const seed = await qa.seed(variant.seedScenario || route.fixture || "baseline");
      const url = resolveVariantUrl(variant, seed);
      if (route.id !== "R36") await qa.authenticate(page);
      if (variant.injectLogin429) loginHandler = await installLoginIntercept(page, "rate-limit");
      if (variant.injectForcedPasswordChange) loginHandler = await installLoginIntercept(page, "forced-change");
      const response = await page.goto(`${qa.baseURL}${url}`, { waitUntil: "domcontentloaded" });
      if (variant.expectedHttpStatus === 404) expect(response?.status(), `${route.id} 404 navigation status`).toBe(404);
      await waitForSentinel(page, route, variant, seed);
      const standards = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
      const enhanced = await new AxeBuilder({ page }).withRules(["color-contrast-enhanced"]).analyze();
      await qa.assertNoExternalEffects();
      const expectedNotFoundPath = variant.expectedHttpStatus === 404 ? url : null;
      const expectedLoginStatuses = new Set();
      if (variant.injectLogin429) expectedLoginStatuses.add(429);
      if (variant.injectForcedPasswordChange) expectedLoginStatuses.add(403);
      const isSuppressedNoise = (entry) => {
        if (!entry.url) return false;
        let pathname;
        try { pathname = new URL(entry.url).pathname; } catch { return false; }
        if (expectedNotFoundPath && pathname === expectedNotFoundPath && entry.text.toLowerCase().includes("404")) return true;
        if (variant.expectedApiNotFound === pathname && entry.text.includes("404")) return true;
        if (pathname === "/api/auth/login" && expectedLoginStatuses.size > 0) {
          for (const status of expectedLoginStatuses) if (entry.text.includes(String(status))) return true;
        }
        return false;
      };
      const filteredConsole = consoleErrors.filter((entry) => !isSuppressedNoise(entry));
      await testInfo.attach(`axe-${route.id}-${url.replaceAll("/", "-")}.json`, { body: JSON.stringify({ url, standards: { violations: standards.violations, incomplete: standards.incomplete }, enhanced: { violations: enhanced.violations, incomplete: enhanced.incomplete }, consoleErrors, pageErrors }, null, 2), contentType: "application/json" });
      expect(standards.violations, `${route.id} ${url} axe WCAG standards violations`).toEqual([]);
      expect(standards.incomplete, `${route.id} ${url} axe incomplete standards checks block certification`).toEqual([]);
      expect(enhanced.violations, `${route.id} ${url} axe color-contrast-enhanced violations`).toEqual([]);
      expect(enhanced.incomplete, `${route.id} ${url} axe color-contrast-enhanced incomplete checks block certification`).toEqual([]);
      expect(filteredConsole.map((entry) => entry.text), `${route.id} ${url} console errors`).toEqual([]);
      expect(pageErrors, `${route.id} ${url} page errors`).toEqual([]);
    } finally {
      if (loginHandler) await page.unroute("**/*", loginHandler);
      page.off("console", onConsole); page.off("pageerror", onPageError);
    }
  });
}

for (const route of routes) for (const variant of route.variants) {
  if (!variant.url && !variant.urlFrom) continue;
  if (route.id === "R36") {
    authSensitiveTest.describe(`accessibility ${route.id} ${variant.branch || "login"}`, () => {
      authSensitiveTest.use({ storageState: { cookies: [], origins: [] } });
      defineAccessibilityTest(route, variant, authSensitiveTest);
    });
  } else defineAccessibilityTest(route, variant, test);
}
