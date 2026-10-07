import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = join(websiteRoot, "..", "docs");
const notesDir = join(
  websiteRoot,
  "..",
  ".omc",
  "plans",
  "docs-fumadocs",
  "notes",
);
const shotDir = join(notesDir, "26-screenshots");

const MOCK_INSTALLED = "durindoor.demo.network";

const AXE_PAGES = [
  "/docs",
  "/docs/getting-started",
  "/docs/reference/api",
  "/docs/providers/catalog",
  "/docs/contributing",
];

function collectDocUrls() {
  const files = readdirSync(docsRoot, { recursive: true, encoding: "utf8" });
  return files
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => {
      const rel = String(name)
        .replaceAll("\\", "/")
        .replace(/\.mdx$/, "");
      if (rel === "index") return "/docs";
      if (rel.endsWith("/index"))
        return `/docs/${rel.slice(0, -"/index".length)}`;
      return `/docs/${rel}`;
    })
    .sort();
}

const docUrls = collectDocUrls();

function isNetworkNoise(text) {
  if (
    /Failed to load resource: the server responded with a status of 404/.test(
      text,
    )
  )
    return true;
  if (/net::ERR_ABORTED/.test(text)) return true;
  return false;
}

function attachConsole(page) {
  const errors = [];
  const onConsole = (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isNetworkNoise(text)) return;
    errors.push(text);
  };
  const onPageError = (error) => {
    errors.push(error.message);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    detach() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

test("every docs route returns 200 with no console errors", async ({
  page,
}) => {
  test.setTimeout(10 * 60 * 1000);
  const failures = [];
  for (const url of docUrls) {
    const log = attachConsole(page);
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      await expect(page.locator("h1").first()).toBeVisible();
      if (status !== 200) failures.push(`${url} status ${status}`);
      if (log.errors.length)
        failures.push(`${url} console.error: ${log.errors.join(" | ")}`);
    } catch (error) {
      failures.push(`${url} ${error.message}`);
    } finally {
      log.detach();
    }
  }
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(
    join(notesDir, "26-urls.json"),
    `${JSON.stringify({ count: docUrls.length, urls: docUrls, failures }, null, 2)}\n`,
  );
  expect(failures, failures.join("\n")).toEqual([]);
  expect(docUrls.length).toBeGreaterThan(0);
});

test("search returns combo hits after visiting the demo", async ({ page }) => {
  test.setTimeout(90_000);
  const searchUrls = [];
  page.on("request", (request) => {
    if (request.url().includes("search")) searchUrls.push(request.url());
  });

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // A fresh demo session redirects to login. Wait before evaluating in its document.
  await page.waitForURL("**/login");
  await page.waitForFunction(
    (key) => Boolean(globalThis[Symbol.for(key)]),
    MOCK_INSTALLED,
    { timeout: 20_000 },
  );

  const fromMockedPage = await page.evaluate(async () => {
    const response = await fetch("/docs-search?query=combo");
    const body = await response.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      json = body;
    }
    return { status: response.status, json };
  });
  expect(fromMockedPage.status, "mocked page fetch /docs-search").toBe(200);
  expect(Array.isArray(fromMockedPage.json), "search JSON is an array").toBe(
    true,
  );
  expect(fromMockedPage.json.length, "search hits for combo").toBeGreaterThan(
    0,
  );

  await page.goto("/docs", { waitUntil: "networkidle" });
  await expect(page.locator("h1").first()).toBeVisible();
  await page.getByRole("button", { name: "Open search", exact: true }).click();

  const input = page.getByPlaceholder("Search");
  await expect(input).toBeVisible();
  const waitSearch = page.waitForResponse(
    (response) =>
      response.url().includes("/docs-search") &&
      response.request().method() === "GET",
    { timeout: 15_000 },
  );
  await input.fill("combo");
  const searchResponse = await waitSearch;
  expect(searchResponse.status(), "UI /docs-search").toBe(200);
  const uiJson = await searchResponse.json();
  expect(
    Array.isArray(uiJson) && uiJson.length,
    "UI search hits for combo",
  ).toBeGreaterThan(0);
  await expect(page.locator("[aria-selected]").first()).toBeVisible();

  mkdirSync(notesDir, { recursive: true });
  writeFileSync(
    join(notesDir, "26-search.json"),
    `${JSON.stringify(
      {
        mockedFetchStatus: fromMockedPage.status,
        mockedHitCount: fromMockedPage.json.length,
        mockedSample: fromMockedPage.json.slice(0, 3),
        uiHitCount: uiJson.length,
        uiSample: uiJson.slice(0, 3),
        observedSearchUrls: searchUrls,
      },
      null,
      2,
    )}\n`,
  );
});

test("axe serious/critical are zero; phone view has no horizontal scroll", async ({
  page,
}) => {
  test.setTimeout(5 * 60 * 1000);
  mkdirSync(shotDir, { recursive: true });
  const summary = [];

  for (const url of AXE_PAGES) {
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(response?.status(), url).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();

    const axe = await new AxeBuilder({ page })
      .exclude('a[href="https://github.com/bloodf/durindoor"] svg[role="img"]')
      .exclude("div.prose-no-margin.overflow-auto")
      .analyze();
    const blockers = axe.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    summary.push({
      url,
      violationCount: axe.violations.length,
      serious: axe.violations.filter(
        (violation) => violation.impact === "serious",
      ).length,
      critical: axe.violations.filter(
        (violation) => violation.impact === "critical",
      ).length,
      blockers: blockers.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
      })),
      other: axe.violations
        .filter(
          (violation) =>
            violation.impact !== "serious" && violation.impact !== "critical",
        )
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        })),
    });
    expect(blockers, `${url} axe serious/critical`).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    const file = `${url.replace(/^\//, "").replaceAll("/", "-") || "docs"}.png`;
    await page.screenshot({
      path: join(shotDir, file),
      fullPage: false,
      animations: "disabled",
    });
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noHorizontalScroll, `${url} horizontal scroll at 390x844`).toBe(
      true,
    );
  }

  writeFileSync(
    join(notesDir, "26-axe.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
});

test("homepage opens its gate and embeds the production dashboard", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const hero = page.locator("#top");
  await expect(hero).not.toContainText("localhost");
  await expect(hero).toContainText("OpenAI and Anthropic");
  const gate = page.getByRole("button", { name: "Open the door", exact: true });
  await gate.click();
  await expect(
    page.getByRole("button", { name: "Close the door", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Close the door", exact: true })
    .click();
  await expect(gate).toHaveAttribute("aria-pressed", "false");
  await page.locator("#demo").scrollIntoViewIfNeeded();
  const preview = page.frameLocator('iframe[title="Live demo"]');
  await expect(
    preview.getByRole("heading", { name: "Endpoint", exact: true }),
  ).toBeVisible();
  await expect(preview.getByText("HTTP 501", { exact: true })).toHaveCount(0);
  await preview.getByRole("link", { name: "Providers", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Providers", exact: true }).first(),
  ).toBeVisible();
  await expect(
    preview.getByRole("link", { name: "Combos", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const previewWidth = (
    await page.locator('iframe[title="Live demo"]').boundingBox()
  ).width;
  expect(previewWidth).toBeLessThanOrEqual(390);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".gate-toggle")).toHaveCount(0);
  await expect(hero.locator(".gateway-poster")).toHaveCount(1);
});

test("embedded navigation scrolls its links while brand and settings stay visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1007, height: 950 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#demo").scrollIntoViewIfNeeded();
  const preview = page.frameLocator('iframe[title="Live demo"]');
  await preview
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const menu = preview.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(menu).toBeVisible();
  const dimensions = await menu.evaluate((el) => {
    const rail = el.querySelector("aside");
    const nav = rail.querySelector("nav");
    const body = el.querySelector("section > div");
    return {
      rail: rail.clientHeight,
      body: body.clientHeight,
      bodyScroll: body.scrollHeight,
      nav: nav.clientHeight,
      navScroll: nav.scrollHeight,
    };
  });
  expect(dimensions.rail).toBeLessThanOrEqual(dimensions.body);
  expect(dimensions.bodyScroll).toBeLessThanOrEqual(dimensions.body + 1);
  expect(dimensions.navScroll).toBeGreaterThan(dimensions.nav);
  const translator = menu.getByRole("link", {
    name: "Translator",
    exact: true,
  });
  await translator.scrollIntoViewIfNeeded();
  await expect(
    menu.getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
  await translator.click();
  await expect(
    preview
      .getByRole("heading", { name: "Translator Debug", exact: true })
      .first(),
  ).toBeVisible();
  await expect(preview.getByRole("dialog", { name: "Navigation" })).toHaveCount(
    0,
  );
  await page.locator("#kinds").scrollIntoViewIfNeeded();
  const docs = page.locator("#kinds .docs-cta");
  const note = page.locator("#kinds .kinds-note");
  const [buttonRect, noteRect] = await Promise.all([
    docs.boundingBox(),
    note.boundingBox(),
  ]);
  expect(buttonRect.y - (noteRect.y + noteRect.height)).toBeGreaterThanOrEqual(
    27,
  );
  await page.locator("#how").scrollIntoViewIfNeeded();
  await expect(page.locator(".request-path")).toContainText("Compatible tools");
  await expect(page.locator(".combo-explanation")).toContainText(
    "You choose the fallback order",
  );
  await expect(page.locator(".combo-explanation")).not.toContainText("200 OK");
  await page.setViewportSize({ width: 443, height: 850 });
  const facts = page.locator(".constellation-facts");
  await facts.scrollIntoViewIfNeeded();
  const spacing = await facts.evaluate((el) => {
    const cards = [...el.children];
    const first = cards[0].getBoundingClientRect();
    const second = cards[1].getBoundingClientRect();
    const cta = document.querySelector(".constellation-copy .docs-cta");
    return {
      stacked: second.top >= first.bottom,
      padding: getComputedStyle(cards[0]).paddingLeft,
      buttonGap:
        cta.getBoundingClientRect().top - el.getBoundingClientRect().bottom,
    };
  });
  expect(spacing.stacked).toBe(true);
  expect(spacing.padding).toBe("16px");
  expect(spacing.buttonGap).toBeGreaterThanOrEqual(27);
});

test("docs onboarding links, API tabs, and reading themes work", async ({
  page,
}) => {
  await page.goto("/docs", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "DurinDoor documentation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".dd-docs-hero-pitch")).toContainText(
    "OpenAI and Anthropic APIs",
  );
  await page.getByRole("link", { name: /Step 2 Connect a provider/ }).click();
  await expect(page).toHaveURL(/\/docs\/providers\/connecting-accounts$/);
  await page.goto("/docs/getting-started/first-request");
  await page
    .getByRole("tab", { name: "Anthropic Messages", exact: true })
    .click();
  const panel = page.getByRole("tabpanel", {
    name: "Anthropic Messages",
    exact: true,
  });
  await expect(panel).toContainText("/v1/messages");
  await expect(panel).toContainText('"max_tokens": 64');
  const copy = panel.getByRole("button", { name: "Copy Text", exact: true });
  await expect(copy).toBeVisible();
  await page
    .getByRole("tab", { name: "OpenAI Responses", exact: true })
    .click();
  await expect(
    page.getByRole("tabpanel", { name: "OpenAI Responses", exact: true }),
  ).toContainText("/v1/responses");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const width = await page.evaluate(() => ({
    view: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.view);
  await expect(
    page.getByRole("link", { name: /Step 1 Install and sign in/ }),
  ).toBeVisible();
});
