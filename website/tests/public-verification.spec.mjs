import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { batches, verifySitemap } from "./sitemap-inventory.mjs";

// Every sitemap route is checked at both widths in independent batches.
test.describe("all public pages have screenshots and no console or axe violations", () => {
  test.describe.configure({ mode: "parallel" });
  for (const width of [1280, 360]) {
    for (const [index, routes] of batches.entries()) {
      test(`${width}px batch ${index + 1}`, async ({ page, request }) => {
        test.setTimeout(300_000);
        await verifySitemap(request);
        const output = process.env.WEBSITE_VERIFY_SCREENSHOTS || "/tmp/durindoor-public-verification";
        mkdirSync(output, { recursive: true });
        const failures = [];
        await page.setViewportSize({ width, height: 800 });
        for (const route of routes) {
          const errors = [];
          const onConsole = (message) => { if (message.type() === "error") errors.push(message.text()); };
          const onPageError = (error) => errors.push(error.message);
          page.on("console", onConsole);
          page.on("pageerror", onPageError);
          try {
            const result = await page.goto(route, { waitUntil: "networkidle", timeout: 30_000 });
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
        expect(failures, failures.join("\n")).toEqual([]);
      });
    }
  }
});
