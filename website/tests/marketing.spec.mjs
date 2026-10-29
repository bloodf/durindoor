import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const screenshots = process.env.WEBSITE_REVIEW_SCREENSHOTS || "/tmp/durindoor-marketing-visant-screens";
async function readyHome(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  // This is a real interaction after hydration, not just a loaded HTML document.
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Language" })).toBeVisible();
  await page.keyboard.press("Escape");
}

test("short mobile navigation keeps every action reachable without document overflow", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 360 });
  await readyHome(page);
  await page.getByRole("button", { name: "Primary", exact: true }).click();
  const panel = page.locator("#home-nav-panel");
  const dimensions = await panel.evaluate((node) => ({ bottom: node.getBoundingClientRect().bottom, height: innerHeight, scroll: node.scrollHeight, client: node.clientHeight }));
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height + 1);
  expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
  await panel.getByRole("link", { name: "Live demo", exact: true }).scrollIntoViewIfNeeded();
  await expect(panel.getByRole("link", { name: "Live demo", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Primary", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("language picker dismisses when tabbing out and deployment tabs show matching commands", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await readyHome(page);
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const tabs = page.getByRole("tablist", { name: "Deployment method" });
  await tabs.getByRole("tab", { name: "npm", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const panel = page.getByRole("tabpanel", { name: "npx", exact: true });
  await expect(panel).toContainText('export JWT_SECRET="$(openssl rand -hex 32)"');
  await expect(panel).toContainText('export INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD"');
  await expect(panel).toContainText("npx durindoor --host 127.0.0.1");
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel", { name: "Source", exact: true })).toContainText("npm start");
});

test("clipboard denial is visible, retry succeeds, and the command stays readable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await readyHome(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } }));
  const install = page.locator(".gateway-install");
  await install.getByRole("button", { name: "Install to clipboard", exact: true }).click();
  await expect(install.getByRole("status")).toHaveText("Copy failed. Select the command and copy it manually.");
  await expect(install.locator("code")).toHaveText("npm install -g durindoor");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (value) => { window.__copiedMarketing = value; return Promise.resolve(); } } }));
  await install.getByRole("button", { name: "Install to clipboard", exact: true }).click();
  await expect(install.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__copiedMarketing)).toBe("npm install -g durindoor");
  const closing = page.locator(".final-command");
  await closing.getByRole("button", { name: "Copy to clipboard", exact: true }).click();
  const startup = await page.evaluate(() => window.__copiedMarketing);
  expect(startup).toBe(await closing.locator("code").innerText());
  expect(startup).toContain('export JWT_SECRET="$(openssl rand -hex 32)"');
  expect(startup).toContain('export INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD"');
  expect(startup).toContain("npx durindoor --host 127.0.0.1");
});

test("model examples can be paused and selected by keyboard without waiting for typing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await readyHome(page);
  const terminal = page.locator(".terminal");
  await terminal.scrollIntoViewIfNeeded();
  await terminal.getByRole("button", { name: "Pause examples", exact: true }).click();
  const frozen = await terminal.locator(".terminal-body").innerText();
  await page.waitForTimeout(600);
  expect(await terminal.locator(".terminal-body").innerText()).toBe(frozen);
  const tabs = terminal.getByRole("tablist");
  await tabs.getByRole("tab", { name: "Provider model", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "Combo", exact: true })).toBeFocused();
  await expect(terminal.getByRole("tabpanel", { name: "Combo", exact: true })).toContainText('"model": "coding-default"');
  await expect(terminal.locator(".terminal-output .is-shown")).toHaveCount(4);
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  expect(await page.locator(".marquee-track").first().evaluate((node) => getComputedStyle(node).animationPlayState)).toBe("paused");
});

test("docs keep English semantics and expose the mobile theme action while sidebar is closed", async ({ page, context }) => {
  await context.addCookies([{ name: "locale", value: "ja", url: test.info().project.use.baseURL }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/getting-started/installation", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const theme = page.locator(".dd-docs-reading-controls").getByRole("button", { name: "Switch to dark mode" });
  await expect(theme).toBeVisible();
  await theme.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.getByRole("button", { name: "Open Search", exact: false }).first().click();
  const input = page.getByPlaceholder("Search");
  await expect(input).toBeVisible();
  await input.fill("first request");
  await expect(page.locator('[aria-selected="true"]').first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("public metadata resolves deployed cards and publishes only public docs", async ({ page, request }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://durindoor.vercel.app/brand/durindoor-social.png");
  await page.goto("/docs/getting-started/installation", { waitUntil: "networkidle" });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://durindoor.vercel.app/docs/getting-started/installation");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://durindoor.vercel.app/brand/durindoor-social.png");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain("/docs/getting-started/installation");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
  expect(urls.length).toBeGreaterThan(1);
  for (const url of urls) {
    expect(url.origin).toBe("https://durindoor.vercel.app");
    expect(url.pathname).not.toMatch(/^\/(internal|dashboard|demo-preview|login)(\/|$)/);
  }
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /dashboard");
  expect(robots).toContain("Sitemap: https://durindoor.vercel.app/sitemap.xml");
});

test("sample dashboard entry recovers from initialization failure with a retry action", async ({ page }) => {
  await page.addInitScript(() => {
    let current = window.fetch;
    let failed = false;
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (next) => {
      current = (input, init) => {
        if (!failed && String(input).endsWith("/api/auth/login")) {
          failed = true;
          return Promise.resolve(new Response(JSON.stringify({ error: "sample failure" }), { status: 503 }));
        }
        return next(input, init);
      };
    } });
  });
  await page.goto("/demo-preview", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "The sample dashboard could not load", exact: true })).toBeVisible();
  await expect(page.locator(".demo-entry-state").getByRole("alert")).toContainText("Your sample data is still in this browser.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Endpoint", exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("marketing and docs layouts retain readable themes without serious accessibility issues", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  mkdirSync(screenshots, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/docs", "/docs/getting-started/installation"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${route} ${width}`).toBe(0);
      if (route === "/") {
        const total = page.locator(".kinds-total-n .sr-only");
        await expect(total).not.toHaveText("0");
        await expect(page.locator(".kinds-total-n [aria-hidden=true]")).toHaveText(await total.innerText());
      }
      if (route === "/" && width === 390) {
        const table = page.frameLocator('iframe[title="Live demo"]').getByRole("region", { name: "Provider health", exact: true });
        await table.focus();
        await expect(table).toBeFocused();
        await expect(table).toHaveAttribute("tabindex", "0");
      }
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)), `${route} ${width}`).toEqual([]);
      await page.screenshot({ path: join(screenshots, `${route.replaceAll("/", "-") || "home"}-${width}.png`), fullPage: false, animations: "disabled" });
      if (route.startsWith("/docs")) {
        await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
        });
        const dark = await new AxeBuilder({ page }).analyze();
        expect(dark.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)), `${route} ${width} dark`).toEqual([]);
        await page.screenshot({ path: join(screenshots, `${route.replaceAll("/", "-")}-${width}-dark.png`), fullPage: false, animations: "disabled" });
        await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
        });
      }
    }
  }
});
