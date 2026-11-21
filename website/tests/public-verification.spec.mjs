import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The sitemap is the website's authoritative inventory of indexable public pages.
test("all public pages have screenshots and no console or axe violations", async ({ page, request }) => {
  test.skip(!process.env.WEBSITE_VERIFY_SCREENSHOTS, "Docker verification only");
  test.setTimeout(10 * 60 * 1000);
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  const routes = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  expect(routes).toContain("/");
  expect(routes).toContain("/docs");
  expect(new Set(routes).size).toBe(routes.length);
  const output = process.env.WEBSITE_VERIFY_SCREENSHOTS;
  mkdirSync(output, { recursive: true });
  const failures = [];
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of routes) {
      const errors = [];
      const onConsole = (message) => { if (message.type() === "error") errors.push(message.text()); };
      const onPageError = (error) => errors.push(error.message);
      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      try {
        const result = await page.goto(route, { waitUntil: "networkidle" });
        expect(result?.status(), route).toBe(200);
        await expect(page.locator("h1").first()).toBeVisible();
        const axe = await new AxeBuilder({ page }).analyze();
        if (axe.violations.length) failures.push(`${route} ${width}: axe ${JSON.stringify(axe.violations.map(({ id, impact }) => ({ id, impact })))}`);
        await page.screenshot({ path: join(output, `${encodeURIComponent(route)}-${width}.png`), fullPage: true, animations: "disabled" });
      } catch (error) {
        failures.push(`${route} ${width}: ${error.message}`);
      } finally {
        if (errors.length) failures.push(`${route} ${width}: console ${errors.join(" | ")}`);
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
