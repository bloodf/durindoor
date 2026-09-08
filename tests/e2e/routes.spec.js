import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test as rawTest, expect, authSensitiveTest } from "./fixtures.js";

const manifestPath = fileURLToPath(new URL("./routes.json", import.meta.url));
const { routes } = JSON.parse(await readFile(manifestPath, "utf8"));

function requireSeedId(seed, key) {
  const value = seed.ids[key];
  if (!value) throw new Error(`Missing required seed id: ids.${key}`);
  return value;
}

function resolveVariantUrl(variant, seed) {
  if (variant.url) return variant.url;
  if (variant.urlFrom === "seed.ids.comboIds[0]") return `/dashboard/media-providers/combo/${requireSeedId(seed, "comboIds")[0]}`;
  if (variant.urlFrom === "seed.ids.mediaProviderNodeId") return `/dashboard/media-providers/embedding/${requireSeedId(seed, "mediaProviderNodeId")}`;
  if (variant.urlFrom === "seed.ids.traceIds[0]") return `/dashboard/timeline/${requireSeedId(seed, "traceIds")[0]}`;
  if (variant.urlFrom === "seed.ids.openaiCompatibleNodeId") return `/dashboard/providers/${requireSeedId(seed, "openaiCompatibleNodeId")}`;
  if (variant.urlFrom === "seed.ids.anthropicCompatibleNodeId") return `/dashboard/providers/${requireSeedId(seed, "anthropicCompatibleNodeId")}`;
  throw new Error(`No concrete URL resolver for variant urlFrom=${variant.urlFrom}`);
}

function resolveExpectedText(variant, seed) {
  if (!variant.expectedTextFrom) return null;
  const id = variant.expectedTextFrom === "seed.ids.openaiCompatibleNodeId"
    ? requireSeedId(seed, "openaiCompatibleNodeId")
    : variant.expectedTextFrom === "seed.ids.anthropicCompatibleNodeId"
      ? requireSeedId(seed, "anthropicCompatibleNodeId")
      : null;
  const record = seed.records.mediaProviders?.find((node) => node.id === id);
  if (!record?.name) throw new Error(`Missing required seeded provider node record: ${id}`);
  return record.name;
}

async function visit(page, qa, url, authenticate = true) {
  if (authenticate) await qa.authenticate(page);
  return page.goto(`${qa.baseURL}${url}`, { waitUntil: "domcontentloaded" });
}

async function expectVisible(page, text, locator = "text") {
  if (locator === "label") return expect(page.getByLabel(text, { exact: true })).toBeVisible();
  if (locator === "title") return expect(page.getByTitle(text, { exact: true })).toBeVisible();
  if (["button", "combobox", "group", "img", "region", "heading", "table"].includes(locator)) return expect(page.getByRole(locator, { name: text, exact: true })).toBeVisible();
  if (typeof text === "string" && text.includes("%d")) return expect(page.getByText(new RegExp(text.replace("%d", "\\d+")), { exact: false }).first()).toBeVisible();
  return expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

/** Narrow same-path intercept for POST /api/auth/login; never touches other routes. */
async function installLoginIntercept(page, kind) {
  const handler = async (routeRequest) => {
    const request = routeRequest.request();
    if (new URL(request.url()).pathname !== "/api/auth/login") return routeRequest.fallback();
    if (kind === "rate-limit") {
      return routeRequest.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many failed attempts.", retryAfter: 30 }) });
    }
    return routeRequest.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ mustChangePassword: true, requiresPasswordChange: true, proof: "fixture-proof-token" }) });
  };
  await page.route("**/*", handler);
  return handler;
}

function defineRouteTest(route, variant) {
  const outcome = variant.expectedText ?? variant.expectedTextFrom ?? variant.expectedFinalText ?? variant.expectedHttpStatus ?? variant.destination ?? "observable";
  const label = `${route.id} ${variant.url || variant.urlFrom} -> ${outcome}`;
  const login429 = variant.injectLogin429 === true;
  const forcedChange = variant.injectForcedPasswordChange === true;
  const injectedStatus = login429 ? 429 : forcedChange ? 403 : null;

  // Listener lifetime must outlast every assertion so post-navigation
  // hydration errors remain observable rather than detaching at goto return.
  // Login routes carry password interaction, so trace/screenshot/video remain
  // disabled even when their variant has no injected error response.
  const test = route.id === "R36" ? authSensitiveTest : rawTest;
  test(label, async ({ page, qa }) => {
    const seed = await qa.seed(variant.seedScenario || route.fixture || "baseline");
    const url = resolveVariantUrl(variant, seed);

    if (route.id === "R36") await page.context().clearCookies();
    const loginHandler = login429 ? await installLoginIntercept(page, "rate-limit") : forcedChange ? await installLoginIntercept(page, "forced-change") : null;
    const errors = [];
    const onPageError = (error) => errors.push({ text: `pageerror: ${error.message}`, url: null });
    const onConsole = (message) => { if (message.type() === "error") errors.push({ text: `console: ${message.text()}`, url: message.location()?.url || null }); };
    page.on("pageerror", onPageError);
    page.on("console", onConsole);
    try {
      const response = await visit(page, qa, url, route.id !== "R36");
      if (login429 || forcedChange) {
        await page.locator("#dashboard-password").fill("fixture-password");
        await page.getByRole("button", { name: "Login", exact: true }).click();
      }
      if (variant.expectedHttpStatus === 404) {
        expect(response, `${route.id} ${url} navigation response is required for 404 proof`).not.toBeNull();
        expect(response.status(), `${route.id} ${url} must respond 404`).toBe(404);
        await expectVisible(page, "This page could not be found.");
      } else if (variant.destination) {
        await expect(page).toHaveURL(new RegExp(`${variant.destination.replace(/\//g, "\\/")}(?:[/?].*)?$`));
        if (route.id === "R18" || route.id === "R37") await expectVisible(page, "Date range", "group");
        if (variant.expectedFinalText || variant.expectedText) await expectVisible(page, variant.expectedFinalText || variant.expectedText);
      } else if (login429) {
        await expect(page.getByRole("button", { name: /Wait \d+s/ })).toBeVisible();
        await expect(page.getByText(/Locked\. Retry in \d+s\./)).toBeVisible();
      } else if (forcedChange) {
        await expect(page.getByRole("button", { name: "Set password", exact: true })).toBeVisible();
        await expect(page.locator("#new-password")).toBeVisible();
      } else {
        const expected = variant.expectedText ?? resolveExpectedText(variant, seed) ?? route.expectedText;
        if (!expected) throw new Error(`${route.id} ${url} has no observable assertion in the manifest`);
        const locator = variant.expectedLocator || route.expectedLocator || (variant.headingLocator ?? route.headingLocator ?? true ? "heading" : "text");
        await expectVisible(page, expected, locator);
        if (route.id === "R20") {
          await expect(page.locator("#profile-current-password")).toBeVisible();
          await expect(page.locator("#profile-new-password")).toBeVisible();
        }
        if (route.id === "R22") {
          await page.getByRole("combobox", { name: "Provider status", exact: true }).click();
          await page.getByRole("option", { name: "Not configured", exact: true }).click();
        }
        for (const secondary of variant.expectedSecondary || route.expectedSecondary || []) {
          await expectVisible(page, secondary, variant.expectedSecondaryLocator || route.expectedSecondaryLocator || "text");
        }
      }
      await qa.assertNoExternalEffects();
      const isSuppressedNoise = (entry) => {
        if (variant.expectedApiNotFound && entry.url && entry.text.includes("404")) {
          try { if (new URL(entry.url).pathname === variant.expectedApiNotFound) return true; } catch {}
        }
        if (injectedStatus && entry.url) {
          try {
            const pathname = new URL(entry.url).pathname;
            if (pathname === "/api/auth/login" && entry.text.includes(String(injectedStatus))) return true;
          } catch {}
        }
        if (variant.expectedHttpStatus === 404 && entry.url && entry.text.includes("404")) {
          try {
            if (new URL(entry.url).pathname === url) return true;
          } catch {}
        }
        return false;
      };
      const unexpected = errors.filter((entry) => !isSuppressedNoise(entry)).map((entry) => entry.text);
      expect(unexpected, `${route.id} ${url} unexpected browser console/page errors`).toEqual([]);
    } finally {
      if (loginHandler) await page.unroute("**/*", loginHandler);
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
    }
  });
}

for (const route of routes) {
  for (const variant of route.variants) {
    if (!variant.url && !variant.urlFrom) continue;
    if (route.id === "R36") {
      authSensitiveTest.describe(`${route.id} ${variant.branch || "login"}`, () => {
        authSensitiveTest.use({ storageState: { cookies: [], origins: [] } });
        defineRouteTest(route, variant);
      });
    } else {
      defineRouteTest(route, variant);
    }
  }
}

rawTest.describe("unauthenticated redirects", () => {
  rawTest.use({ storageState: { cookies: [], origins: [] } });

  rawTest("R18 unauthenticated guard reaches login", async ({ page, qa }) => {
    await page.goto(`${qa.baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByRole("button", { name: "Login", exact: true })).toBeVisible();
    await qa.assertNoExternalEffects();
  });

  rawTest("R37 unauthenticated root redirect chain reaches login", async ({ page, qa }) => {
    await page.goto(`${qa.baseURL}/`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByRole("button", { name: "Login", exact: true })).toBeVisible();
    await qa.assertNoExternalEffects();
  });
});
