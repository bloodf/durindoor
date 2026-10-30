import { describe, expect, it } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { REVIEW_SURFACES } from "../../src/shared/ui/v5/review-manifest.js";
import AxeBuilder from "@axe-core/playwright";

const enabled = process.env.RUN_V5_STORYBOOK === "1";
const baseURL = process.env.V5_STORYBOOK_URL || "http://localhost:6006";
const root = resolve(import.meta.dirname, "../..");
const reportDir = resolve(root, ".impeccable/review/v5");
const firefoxDriver = process.env.V5_FIREFOX_DRIVER
  ? (await import(process.env.V5_FIREFOX_DRIVER)).firefox
  : firefox;
const engines = { chromium, firefox: firefoxDriver, webkit };
const launch = (name) =>
  engines[name].launch({
    executablePath:
      process.env[`V5_${name.toUpperCase()}_EXECUTABLE`] || undefined,
  });

async function installEvidence(page) {
  await page.addInitScript(() => {
    let channel;
    window.__v5StoryResult = null;
    const attach = (value) => {
      if (!value?.on || value.__v5Attached) return;
      value.__v5Attached = true;
      value.on("storyFinished", (payload) => {
        window.__v5StoryResult = payload;
      });
      for (const name of [
        "storyThrewException",
        "playFunctionThrewException",
        "unhandledErrorsWhilePlaying",
      ])
        value.on(name, (payload) => {
          window.__v5StoryResult = { status: "error", event: name, payload };
        });
    };
    Object.defineProperty(window, "__STORYBOOK_ADDONS_CHANNEL__", {
      configurable: true,
      get: () => channel,
      set: (value) => {
        channel = value;
        attach(value);
      },
    });
  });
}

/** React Flow measures nodes before its 200ms auto-fit animation. Check the
 * settled rectangles, rather than mistaking the initial transform for clipping. */
async function settleTopology(page) {
  await page.evaluate(async () => {
    const graphs = [...document.querySelectorAll(".react-flow")].filter((graph) => graph.getClientRects().length && getComputedStyle(graph).visibility !== "hidden");
    if (!graphs.length) return;
    const start = performance.now();
    let previous = "";
    let stableFrames = 0;
    while (performance.now() - start < 3_000) {
      const nodes = graphs.flatMap((graph) => [...graph.querySelectorAll(".react-flow__node")]);
      const measured = nodes.length > 0 && nodes.every((node) => {
        const rect = node.getBoundingClientRect();
        const graph = node.closest(".react-flow").getBoundingClientRect();
        return getComputedStyle(node).visibility === "visible" && rect.width > 0 && rect.height > 0
          && rect.left >= graph.left - 2 && rect.right <= graph.right + 2
          && rect.top >= graph.top - 2 && rect.bottom <= graph.bottom + 2;
      });
      const signature = nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.left, rect.top, rect.width, rect.height].map((value) => value.toFixed(2)).join(",");
      }).join(";");
      stableFrames = measured && signature === previous ? stableFrames + 1 : 0;
      if (performance.now() - start >= 300 && stableFrames >= 5) return;
      previous = signature;
      await new Promise(requestAnimationFrame);
    }
    throw new Error("Provider topology did not finish measuring and fitting within 3 seconds");
  });
}

/** Inspect rendered control geometry, not only accessibility roles or page overflow.
 * Hidden form proxies and offscreen/inert stories do not participate. */
async function layoutDefects(page) {
  return page.evaluate(() => {
    const failures = [];
    const visible = (element) => {
      if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]') || !element.getClientRects().length) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const label = (element) => element.getAttribute("aria-label") || element.id || element.tagName;
    const within = (inner, outer) => inner.left >= outer.left - 2 && inner.right <= outer.right + 2 && inner.top >= outer.top - 2 && inner.bottom <= outer.bottom + 2;
    for (const element of document.querySelectorAll('[aria-label]')) {
      const labelledCheckbox = element.matches('input[type="checkbox"], input[type="radio"]') && visible(element.closest("label"));
      if ((visible(element) || labelledCheckbox) && /\[object Object\]/.test(element.getAttribute("aria-label"))) failures.push(`Invalid accessible name: ${element.tagName} ${element.getAttribute("aria-label")}`);
    }
    for (const input of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea')) {
      if (!visible(input)) continue;
      const wrapper = input.parentElement;
      const icon = wrapper?.querySelector(':scope > span[aria-hidden="true"] .material-symbols-outlined');
      if (!icon || !icon.getClientRects().length || getComputedStyle(icon).visibility === "hidden") continue;
      const fieldRect = input.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      const delta = Math.abs((iconRect.top + iconRect.bottom - fieldRect.top - fieldRect.bottom) / 2);
      if (delta > 2) failures.push(`Input icon is ${delta.toFixed(1)}px off center: ${label(input)}`);
      if (!within(iconRect, fieldRect)) failures.push(`Input icon escapes field: ${label(input)}`);
      const iconSize = Number.parseFloat(getComputedStyle(icon).fontSize);
      if (Math.abs(iconSize - 18) > .1) failures.push(`Input icon has ${iconSize}px font size; expected 18px: ${label(input)}`);
      const textStart = fieldRect.left + Number.parseFloat(getComputedStyle(input).paddingLeft);
      if (textStart - iconRect.right < 4 - 1) failures.push(`Input icon overlaps text padding: ${label(input)}`);
    }
    // A table may scroll locally; its provider names and individual values
    // still need enough width to avoid breaking into character fragments.
    for (const table of document.querySelectorAll("table")) {
      const caption = table.querySelector("caption")?.textContent || table.getAttribute("aria-label") || "";
      if (!visible(table) || !/Configured provider connections and their reachability probes|Pricing rates per provider and model/.test(caption)) continue;
      const headers = table.querySelectorAll("thead th").length;
      if (table.getBoundingClientRect().width < headers * 96 - 2) failures.push(`Table columns are too narrow to read: ${caption}`);
      const region = table.closest('[role="region"]');
      if (region && table.getBoundingClientRect().width > region.clientWidth + 2 && !["auto", "scroll"].includes(getComputedStyle(region).overflowX)) failures.push(`Wide table lacks its own scroll region: ${caption}`);
      const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!/^(?:openai|Healthy|Degraded|gpt-4o|claude-3-5-sonnet)$/.test(node.textContent.trim())) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = [...range.getClientRects()].map((rect) => Math.round(rect.top));
        if (new Set(lines).size > 1) failures.push(`Table value splits across lines: ${node.textContent.trim()}`);
      }
    }
    const rpmInput = document.querySelector('input[id="provider-rpm-limit"]');
    if (visible(rpmInput) && ![...(rpmInput.labels || [])].some(visible)) failures.push("Provider RPM input has no visible label");
    // Wrapping must move each provider strategy label with its switch; a track
    // beneath another label is geometrically present but points to the wrong setting.
    if (visible(rpmInput)) for (const [name, text] of [["Toggle round robin", "Round Robin"], ["Toggle cache affinity", "Cache Affinity"]]) {
      const control = document.querySelector(`[role="switch"][aria-label="${name}"]`);
      if (!visible(control)) continue;
      let group = control.parentElement;
      let caption;
      while (group && !caption) {
        caption = [...group.querySelectorAll("span, label")].find((element) => visible(element) && element.textContent.trim() === text);
        group = group.parentElement;
      }
      if (caption) {
        const track = control.getBoundingClientRect();
        const title = caption.getBoundingClientRect();
        if (Math.abs((track.top + track.bottom - title.top - title.bottom) / 2) > 2) failures.push(`Provider strategy label is detached from its switch: ${text}`);
      }
    }
    for (const graph of document.querySelectorAll(".react-flow")) {
      if (!visible(graph)) continue;
      const bounds = graph.getBoundingClientRect();
      for (const node of graph.querySelectorAll(".react-flow__node")) {
        if (visible(node) && !within(node.getBoundingClientRect(), bounds)) failures.push(`Provider topology node is clipped after auto-fit: ${node.getAttribute("data-id")}`);
      }
    }
    for (const summary of document.querySelectorAll('[aria-label="PXPIPE status summary"]')) {
      if (!visible(summary)) continue;
      const minimum = Math.min(140, summary.getBoundingClientRect().width);
      for (const cell of summary.children) {
        if (cell.getBoundingClientRect().width < minimum - 2) failures.push(`PXPIPE status cell is ${cell.getBoundingClientRect().width.toFixed(1)}px wide; needs ${minimum.toFixed(1)}px`);
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!/^(?:v?\d\S*)$/.test(node.textContent.trim())) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const lines = [...range.getClientRects()].map((rect) => Math.round(rect.top));
          if (new Set(lines).size > 1) failures.push(`PXPIPE numeric value splits across lines: ${node.textContent.trim()}`);
        }
      }
    }
    for (const picker of document.querySelectorAll('.v5-model-picker')) {
      const search = picker.querySelector('[aria-label="Search models"]');
      const provider = picker.querySelector('[aria-label="Filter provider"]');
      if (window.innerWidth > 640 && visible(search) && visible(provider)) {
        const field = search.getBoundingClientRect();
        const filter = provider.getBoundingClientRect();
        if (Math.abs(field.top - filter.top) > 2 || Math.abs(field.height - filter.height) > 2) failures.push(`Model filters are misaligned: search top=${field.top.toFixed(1)}, provider top=${filter.top.toFixed(1)}, heights=${field.height.toFixed(1)}/${filter.height.toFixed(1)}`);
      }
      const selection = picker.querySelector('.v5-model-picker-selection');
      const list = selection?.querySelector('ol');
      if (list && visible(list)) {
        const style = getComputedStyle(list);
        const body = picker.querySelector(':scope > .overflow-y-auto');
        if (body && list.getBoundingClientRect().height > body.clientHeight + 2) failures.push("Selected models list exceeds modal body height");
        if (list.scrollHeight > list.clientHeight + 2 && !["auto", "scroll"].includes(style.overflowY)) failures.push("Selected models list has no bounded scroll region");
        for (const button of list.querySelectorAll('button')) {
          const rect = button.getBoundingClientRect();
          if (visible(button) && (rect.width < 44 - 1 || rect.height < 44 - 1)) failures.push(`Selected-model remove target is ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}: ${label(button)}`);
        }
      }
    }
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (const surface of document.querySelectorAll('dialog[open] > [role="document"]')) {
      if (!visible(surface)) continue;
      const rect = surface.getBoundingClientRect();
      if (!within(rect, viewport)) failures.push("Modal surface escapes viewport");
      const body = surface.querySelector(':scope > .overflow-y-auto');
      if (body && body.scrollWidth > body.clientWidth + 2) failures.push(`Modal body has ${body.scrollWidth - body.clientWidth}px horizontal overflow`);
      const footer = surface.querySelector(':scope > footer');
      for (const control of footer?.querySelectorAll('button, [role="combobox"], input') || []) {
        if (visible(control) && !within(control.getBoundingClientRect(), rect)) failures.push(`Modal footer control escapes surface: ${label(control)}`);
      }
    }
    return [...new Set(failures)];
  });
}

async function render(page, id, theme) {
  await page.goto(
    `${baseURL}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
  );
  await page.waitForFunction(() => window.__v5StoryResult !== null, null, {
    timeout: 20_000,
  });
  const result = await page.evaluate(() => window.__v5StoryResult);
  expect(result.status, `${id}: ${JSON.stringify(result)}`).toBe("success");
  await page.evaluate(() => document.fonts.ready);
  await settleTopology(page);
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    review: document.documentElement.dataset.v5Review,
  }));
  expect(geometry.scrollWidth, `${id} overflow`).toBeLessThanOrEqual(
    geometry.width + 1,
  );
  expect(geometry.review, `${id} review scope`).toBe("true");
  const defects = await layoutDefects(page);
  expect(defects, `${id} layout: ${JSON.stringify(defects)}`).toEqual([]);
}

describe.skipIf(!enabled)("v5 Storybook runtime", () => {
  it("keeps quota filters and compression settings inside review navigation", async () => {
    const browser = await launch("chromium");
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await installEvidence(page);
      const quota = REVIEW_SURFACES.find((surface) => surface.source.endsWith("/quota/page.stories.jsx"));
      await render(page, quota.storyId, "light");
      expect(new URL(page.url()).pathname).toBe("/iframe.html");
      await page.getByRole("link", { name: "Health", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/iframe.html" && /health/.test(url.searchParams.get("id") || ""));
      await page.getByRole("heading", { name: "Provider Health", exact: true }).waitFor();
      await render(page, "v5-review-workflows-token-saver-overview--overview", "light");
      await page.getByRole("link", { name: "Compression settings" }).click();
      await page.waitForURL((url) => url.pathname === "/iframe.html" && /token-saver-settings/.test(url.searchParams.get("id") || ""));
      await page.getByRole("heading", { name: "Token Saver settings", exact: true }).waitFor();
      await page.waitForFunction(() => window.__v5StoryResult?.status === "success");
      const settingsDialog = page.getByRole("dialog");
      if (await settingsDialog.count()) await settingsDialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("link", { name: "Open full page", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/iframe.html" && /headroom/.test(url.searchParams.get("id") || ""));
      await page.waitForFunction(() => window.__v5StoryResult?.status === "success");
      expect(await page.locator("#error-message").isVisible()).toBe(false);
    } finally { await browser.close(); }
  }, 60_000);

  it("explains icons and preserves modal keyboard actions across browsers and themes", async () => {
    const cases = [];
    try {
      for (const name of Object.keys(engines)) {
        const browser = await launch(name);
        try {
          for (const viewport of [{ width: 957, height: 847 }, { width: 390, height: 844 }]) {
            const page = await browser.newPage({ viewport });
            await installEvidence(page);
            for (const theme of ["light", "dark"]) {
              await render(page, "v5-review-workflows-v5-redesign-combos--model-picker", theme);
              const tooltip = page.locator("[data-v5-icon-tooltip]");
              const modelName = page.getByText("Augment Prism", { exact: true });
              await modelName.hover();
              await tooltip.waitFor({ state: "hidden" });
              await modelName.click();
              await tooltip.waitFor({ state: "hidden" });
              const unanimated = await page.locator(".material-symbols-outlined").evaluateAll((elements) => elements.filter((element) => !element.querySelector("[data-v5-animated-icon] svg") && !element.closest(".v5-login-scene")).map((element) => element.textContent));
              expect(unanimated).toEqual([]);
              const vision = page.locator('.v5-capability-mark[aria-label="vision"]').first();
              await vision.hover();
              await page.waitForFunction(() => [...document.querySelector('.v5-capability-mark[aria-label="vision"] [data-v5-animated-icon]').querySelectorAll("g,circle")].some((element) => {
                const transform = getComputedStyle(element).transform;
                return transform !== "none" && transform !== "matrix(1, 0, 0, 1, 0, 0)";
              }));
              await page.waitForFunction(() => document.querySelector("[data-v5-icon-tooltip]")?.textContent === "Accepts images as input");
              expect(await tooltip.isVisible()).toBe(true);
              const bounds = await tooltip.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, topLayer: element.matches(":popover-open") };
              });
              expect(bounds.topLayer).toBe(true);
              expect(bounds.left).toBeGreaterThanOrEqual(7);
              expect(bounds.right).toBeLessThanOrEqual(bounds.width - 7);
              expect(bounds.top).toBeGreaterThanOrEqual(7);
              expect(bounds.bottom).toBeLessThanOrEqual(bounds.height - 7);
              const provider = page.getByRole("img", { name: "Augment Auggie CLI provider", exact: true });
              await provider.hover();
              await page.waitForFunction(() => document.querySelector("[data-v5-icon-tooltip]")?.textContent === "Augment Auggie CLI provider");
              expect(await tooltip.isVisible()).toBe(true);
              if (name === "chromium" && viewport.width === 957 && theme === "light") await page.screenshot({ path: resolve(reportDir, "oct09-animated-icons-final.png") });
              await page.mouse.move(1, 1);
              const done = page.getByRole("button", { name: "Done", exact: true });
              expect(await done.locator('[data-icon-name="check"]').count()).toBe(1);
              await page.keyboard.press("Tab");
              await done.focus();
              await page.waitForFunction(() => document.querySelector("[data-v5-icon-tooltip]")?.textContent === "Done");
              expect(await done.getAttribute("aria-describedby")).toContain(await tooltip.getAttribute("id"));
              await page.keyboard.press("Escape");
              await tooltip.waitFor({ state: "hidden" });
              expect(await page.getByRole("dialog").isVisible()).toBe(true);
              const search = page.getByPlaceholder("Search models or providers");
              await search.focus();
              await tooltip.waitFor({ state: "visible" });
              expect(await tooltip.textContent()).toBe("Search the available items");
              await page.mouse.move(1, 1);
              await search.blur();
              const searchIcon = search.locator('..').locator('[data-icon-name="search"]').first();
              await searchIcon.hover();
              await tooltip.waitFor({ state: "visible" });
              expect(await tooltip.textContent()).toBe("Search the available items");
              await searchIcon.click();
              expect(await search.evaluate((input) => input === document.activeElement)).toBe(true);
              const close = page.getByRole("button", { name: "Close", exact: true });
              await close.hover();
              await close.focus();
              await tooltip.waitFor({ state: "hidden" });
              expect(await close.getAttribute("title")).toBeNull();
              expect(await close.locator("[data-v5-icon-help]").count()).toBe(0);
              await page.keyboard.press("Escape");
              await page.getByRole("dialog").waitFor({ state: "hidden" });
              await render(page, "v5-review-workflows-v5-redesign-combos--capability-ceiling", theme);
              const save = page.getByRole("button", { name: "Save", exact: true });
              expect(await save.locator('[data-icon-name="save"]').count()).toBe(1);
              await save.hover();
              await save.focus();
              expect(await save.locator("[data-v5-icon-help]").count()).toBe(0);
              expect(await page.locator('[role="tooltip"]:visible').count()).toBe(0);
              expect(await layoutDefects(page)).toEqual([]);
              await render(page, "v5-review-workflows-motion-actions--save-and-readback", theme);
              const unavailable = page.getByRole("button", { name: "Sync unavailable", exact: true });
              expect(await unavailable.isEnabled()).toBe(false);
              await unavailable.locator('[data-icon-name="sync"]').hover();
              await page.waitForFunction(() => document.querySelector("[data-v5-icon-tooltip]")?.textContent === "Sync unavailable");
              expect(await page.locator("[data-v5-icon-tooltip]").isVisible()).toBe(true);
              await page.emulateMedia({ reducedMotion: "reduce" });
              await render(page, "v5-review-workflows-motion-actions--save-and-readback", theme);
              const pending = page.locator('[data-icon-name="progress_activity"]');
              expect(await pending.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
              await page.emulateMedia({ reducedMotion: "no-preference" });
              await render(page, "v5-review-workflows-monitoring--runtime", theme);
              for (const meaning of ["Provider servers", "Usage statistics", "Processing speed", "Storage usage"])
                expect(await page.getByRole("img", { name: meaning, exact: true }).count()).toBe(1);
              expect(await page.getByRole("img", { name: "Page content", exact: true }).count()).toBe(0);
              cases.push({ browser: name, viewport, theme, icons: "passed" });
            }
            await page.close();
          }
        } finally { await browser.close(); }
      }
    } finally {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(resolve(reportDir, "icon-help.json"), JSON.stringify(cases, null, 2));
    }
  }, 180_000);

  it("preserves mixed-color logo contrast and weight editing focus in every browser", async () => {
    const cases = [];
    for (const name of Object.keys(engines)) {
      const browser = await launch(name);
      try {
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
          const page = await browser.newPage({ viewport });
          await installEvidence(page);
          for (const theme of ["light", "dark"]) {
            await render(page, "v5-review-pages-media-weblisting--default", theme);
            const mark = page.locator('img[src="/providers/kimi.svg"]').first();
            await mark.evaluate((element) => element.decode());
            const appearance = await mark.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, filter: getComputedStyle(element).filter }));
            expect(appearance.filter, "Kimi blue accent retains its source color").toBe("none");
            if (theme === "light") {
              const channels = appearance.background.match(/[\d.]+/g).map(Number);
              expect(channels.slice(0, 3).every((channel) => channel < 100), "White Kimi body needs a dark icon well").toBe(true);
              if (channels.length === 4) expect(channels[3]).toBe(1);
            }
            await render(page, "v5-review-workflows-v5-redesign-combos--capability-ceiling", theme);
            const weight = page.getByRole("spinbutton", { name: "Weight", exact: true }).first();
            await weight.fill("");
            expect(await weight.evaluate((element) => document.activeElement === element)).toBe(true);
            expect(await weight.getAttribute("aria-invalid")).toBe("true");
            expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(false);
            await weight.fill("3");
            expect(await weight.evaluate((element) => document.activeElement === element)).toBe(true);
            expect(await weight.getAttribute("aria-invalid")).toBeNull();
            expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
            cases.push({ browser: name, viewport, theme, layout: "passed" });
          }
          await page.close();
        }
      } finally { await browser.close(); }
    }
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(resolve(reportDir, "logo-and-focus.json"), JSON.stringify(cases, null, 2));
  }, 180_000);

  it("keeps audited provider, table, widget and long dashboard-name states readable", async () => {
    const browser = await launch("chromium");
    const cases = [];
    const ids = [
      "v5-review-pages-health--default",
      "v5-review-pages-profile-pricingsettingspage--default",
      "v5-review-pages-providers-providerdetailpage--open-ai-detail",
      "v5-review-workflows-token-saver-overview--overview",
      "v5-review-workflows-your-dashboards--operations",
    ];
    try {
      for (const viewport of [{ width: 957, height: 847 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        await installEvidence(page);
        for (const theme of ["light", "dark"]) {
          for (const id of ids) {
            try {
              await render(page, id, theme);
              if (id === "v5-review-pages-health--default") expect(await page.getByRole("combobox", { name: "Rows per page" }).textContent()).toContain("20");
              if (id.includes("providerdetailpage")) {
                const logo = page.locator('img[src="/providers/openai.svg"]').first();
                await logo.evaluate((element) => element.decode());
                // Draw the real white source mark with its rendered CSS filter
                // to prove light-theme ink, rather than merely checking a class.
                const luminance = await logo.evaluate((element) => {
                  const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
                  const context = canvas.getContext("2d");
                  context.filter = getComputedStyle(element).filter;
                  context.drawImage(element, 0, 0, 32, 32);
                  const pixels = context.getImageData(0, 0, 32, 32).data;
                  const ink = [];
                  for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 200) ink.push((.2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2]) / 255);
                  return { samples: ink.length, average: ink.reduce((total, value) => total + value, 0) / ink.length };
                });
                expect(luminance.samples).toBeGreaterThan(10);
                if (theme === "light") expect(luminance.average, "OpenAI white asset must become visible ink on light surfaces").toBeLessThan(.25);
                else expect(luminance.average, "OpenAI mark must remain visible on dark surfaces").toBeGreaterThan(.75);
              }
              if (id === "v5-review-workflows-your-dashboards--operations") {
                const name = "W".repeat(80);
                await page.getByRole("button", { name: "Rename dashboard", exact: true }).click();
                const dialog = page.getByRole("dialog", { name: "Rename dashboard" });
                await dialog.getByLabel("Dashboard name").fill(name);
                await dialog.getByRole("button", { name: "Save name", exact: true }).click();
                const heading = page.getByRole("heading", { name, exact: true });
                await heading.waitFor({ state: "visible" });
                expect(await page.getByRole("combobox", { name: "Active dashboard" }).textContent()).toContain(name);
                const geometry = await heading.evaluate((element) => ({ right: element.getBoundingClientRect().right, viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, width: element.clientWidth, content: element.scrollWidth }));
                expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 2);
                expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);
                expect(geometry.content).toBeLessThanOrEqual(geometry.width + 2);
              }
              const defects = await layoutDefects(page);
              expect(defects, `${id} audited layout: ${JSON.stringify(defects)}`).toEqual([]);
              cases.push({ id, theme, viewport, layout: "passed" });
            } catch (error) { cases.push({ id, theme, viewport, layout: "failed", error: error.message, defects: await layoutDefects(page) }); }
          }
        }
        await page.close();
      }
      expect(cases.filter((entry) => entry.layout === "failed")).toEqual([]);
    } finally {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(resolve(reportDir, "audited-layout-geometry.json"), JSON.stringify(cases, null, 2));
      await browser.close();
    }
  }, 180_000);

  it("keeps modal controls aligned at the reported intermediate viewport and mobile", async () => {
    const browser = await launch("chromium");
    const cases = [];
    const ids = [
      "v5-review-workflows-v5-redesign-combos--model-picker",
      "v5-review-workflows-v5-redesign-combos--capability-ceiling",
    ];
    try {
      for (const viewport of [{ width: 957, height: 847 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        await installEvidence(page);
        for (const theme of ["light", "dark"]) {
          for (const id of ids) {
            try {
              await render(page, id, theme);
              if (id.endsWith("--model-picker")) {
                const choices = await page.locator('.v5-model-picker-row[aria-pressed="false"]').evaluateAll((rows) => rows.slice(0, 20).map((row) => row.getAttribute("aria-label")));
                expect(choices.length).toBe(20);
                for (const name of choices) await page.getByRole("button", { name, exact: true }).click();
                const remove = page.locator('.v5-model-picker-selection button').last();
                await remove.scrollIntoViewIfNeeded();
                await expect(remove.isVisible()).resolves.toBe(true);
                const defects = await layoutDefects(page);
                expect(defects, `${id} with 21 selected models: ${JSON.stringify(defects)}`).toEqual([]);
              }
              cases.push({ id, theme, viewport, layout: "passed" });
            }
            catch (error) { cases.push({ id, theme, viewport, layout: "failed", error: error.message, defects: await layoutDefects(page) }); }
          }
        }
        await page.close();
      }
      expect(cases.filter((entry) => entry.layout === "failed")).toEqual([]);
    } finally {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(resolve(reportDir, "modal-geometry.json"), JSON.stringify(cases, null, 2));
      await browser.close();
    }
  }, 120_000);

  it.concurrent("renders every v5 story and proves its play function completed", async () => {
    const index = JSON.parse(
      readFileSync(resolve(root, "storybook-static/index.json"), "utf8"),
    );
    const stories = Object.values(index.entries).filter(
      (entry) => entry.type === "story" && entry.title.startsWith("V5 review/"),
    );
    expect(stories.length).toBe(REVIEW_SURFACES.reduce((count, surface) => count + surface.states.length, 0) + 1);
    mkdirSync(reportDir, { recursive: true });
    const browser = await launch("chromium");
    const errors = [];
    const completed = [];
    try {
      const failures = [];
      let next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
        await installEvidence(page);
        page.on("pageerror", (error) => errors.push(error.message));
        while (next < stories.length) {
          const story = stories[next++];
          try { await render(page, story.id, "light"); completed.push(story.id); }
          catch (error) { failures.push({ id: story.id, error: error.message }); }
        }
        await page.close();
      }));
      writeFileSync(resolve(reportDir, "story-failures.json"), JSON.stringify(failures, null, 2));
      expect(failures).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      writeFileSync(
        resolve(reportDir, "all-stories.json"),
        JSON.stringify({ completed, total: stories.length, errors }, null, 2),
      );
      await browser.close();
    }
  }, 600_000);

  for (const name of Object.keys(engines))
    it.concurrent(`${name} has accessible page layouts and interactions across both themes and sizes`, async () => {
      const browser = await launch(name);
      const cases = [];
      const errors = [];
      const representativeSources = [
        "src/app/(dashboard)/dashboard/providers/page.stories.jsx",
        "src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx",
        "src/app/(dashboard)/dashboard/profile/page.stories.jsx",
        "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx",
        "src/app/(dashboard)/dashboard/quota/page.stories.jsx",
        "src/shared/ui/v5/routes/Monitoring.stories.jsx",
        "src/shared/ui/v5/combos/Combos.stories.jsx",
        "src/shared/ui/v5/login/Login.stories.jsx",
        "src/shared/ui/v5/providers/AutoSync.stories.jsx",
        "src/shared/ui/v5/routes/SaverOverview.stories.jsx",
        "src/shared/ui/v5/dashboards/Workspaces.stories.jsx",
      ];
      const representatives = ["v5-review-start-here--explore-workspace", ...REVIEW_SURFACES.filter((surface) => representativeSources.includes(surface.source)).map((surface) => surface.storyId)];
      const interactions = REVIEW_SURFACES.filter((surface) => /\/v5\/(?:usage|combos|login|providers|dashboards)\//.test(surface.source) || surface.source.endsWith("/SaverOverview.stories.jsx")).flatMap((surface) => surface.storyIds);
      try {
        for (const theme of ["light", "dark"])
          for (const [size, viewport] of Object.entries({
            desktop: { width: 1440, height: 1000 },
            mobile: { width: 390, height: 844 },
          })) {
            const context = await browser.newContext({ viewport, ...(name === "chromium" ? { permissions: ["clipboard-read", "clipboard-write"] } : {}) });
            const page = await context.newPage();
            await installEvidence(page);
            page.on("pageerror", (error) => errors.push(error.message));
            for (const id of representatives) {
              try {
                await render(page, id, theme);
                const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
                const violations = axe.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) }));
                cases.push({ id, theme, size, axe: violations.length ? "failed" : "passed", violations });
              } catch (error) { cases.push({ id, theme, size, axe: "failed", error: error.message }); }
            }
            for (const id of interactions) {
              try { await render(page, id, theme); cases.push({ id, theme, size, play: "passed" }); }
              catch (error) { cases.push({ id, theme, size, play: "failed", error: error.message }); }
            }
            await context.close();
          }
        expect(cases.filter((entry) => entry.axe === "failed" || entry.play === "failed")).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        mkdirSync(reportDir, { recursive: true });
        writeFileSync(
          resolve(reportDir, `${name}-matrix.json`),
          JSON.stringify(
            {
              cases,
              errors,
              version: browser.version(),
              executable:
                process.env[`V5_${name.toUpperCase()}_EXECUTABLE`] ||
                "Playwright default",
            },
            null,
            2,
          ),
        );
        await browser.close();
      }
    }, 600_000);
});
