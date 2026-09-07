import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.js";
import { artifactKey } from "../../scripts/check-storybook-coverage.mjs";
import { validateStorybookLifecycle } from "./storybook-lifecycle.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(path.join(root, "tests/e2e/storybook-surfaces.json"), "utf8"));
const candidateCommitSha = process.env.DURINDOOR_CANDIDATE_SHA;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AXE_SOURCE = (() => { const candidate = path.join(root, "node_modules/axe-core/axe.min.js"); return existsSync(candidate) ? candidate : null; })();
const hash = (data) => createHash("sha256").update(data).digest("hex");
const sourceDigest = (relativePath) => existsSync(path.join(root, relativePath)) ? hash(readFileSync(path.join(root, relativePath))) : null;
const sourceHashesFor = (sources) => Object.fromEntries(sources.filter((source) => existsSync(path.join(root, source.sourcePath))).map((source) => [source.sourcePath, sourceDigest(source.sourcePath)]));

const built = () => {
  const file = path.join(root, "storybook-static/index.json");
  if (!existsSync(file)) return new Map();
  const index = JSON.parse(readFileSync(file, "utf8"));
  return new Map(Object.entries(index.entries ?? index.stories ?? {}).filter(([, entry]) => entry.type === "story"));
};

async function installListener(page) {
  await page.addInitScript(() => {
    const state = { installed: false, events: [], failures: [], finished: null, phases: [] };
    window.__durindoorStoryEvidence = state;
    let channel = window.__STORYBOOK_ADDONS_CHANNEL__;
    const attach = (value) => {
      if (!value || state.installed || typeof value.on !== "function") return;
      state.installed = true;
      for (const name of ["storyRendered", "storyFinished", "storyRenderPhaseChanged", "storyThrewException", "playFunctionThrewException", "unhandledErrorsWhilePlaying"]) value.on(name, (payload) => {
        state.events.push({ name, payload });
        if (name === "storyRenderPhaseChanged") state.phases.push({ storyId: payload?.storyId, renderId: payload?.renderId, newPhase: payload?.newPhase });
        if (name === "storyFinished") state.finished = payload;
        if (name !== "storyRendered" && name !== "storyFinished" && name !== "storyRenderPhaseChanged") state.failures.push({ name, payload });
      });
    };
    attach(channel);
    Object.defineProperty(window, "__STORYBOOK_ADDONS_CHANNEL__", { configurable: true, get: () => channel, set: (value) => { channel = value; attach(value); } });
  });
}

async function proveStable(page, storyId) {
  await page.waitForFunction((id) => {
    const state = window.__durindoorStoryEvidence;
    if (!state?.installed) return false;
    if (state.failures.length) return true;
    if (state.finished && (state.finished.storyId === id || state.finished.id === id)) return true;
    return false;
  }, storyId, { timeout: 20_000 });
  return page.evaluate((id) => {
    const state = window.__durindoorStoryEvidence;
    if (state.failures.length) throw new Error(`Storybook failure event ${JSON.stringify(state.failures)}`);
    if (!state.finished || state.finished.storyId !== id) throw new Error(`Storybook storyFinished missing for ${id}`);
    if (state.finished.status !== "success") throw new Error(`Storybook storyFinished status=${state.finished.status} for ${id}`);
    return state.finished;
  }, storyId);
}

function detectScope(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const dialog = [...document.querySelectorAll("dialog, [role='dialog']")].find(visible);
    const root = document.querySelector("#storybook-root");
    if (!dialog && !root) throw new Error("Storybook render exposes neither visible dialog nor storybook-root");
    return dialog ? "dialog" : "storybook-root";
  });
}

async function runAxe(page) {
  const scope = await detectScope(page);
  if (!AXE_SOURCE) return { status: "fail", tags: TAGS, scope, standards: { violations: [], incomplete: [] }, enhanced: { violations: [], incomplete: [] }, unverifiedCriteria: ["axe-core source missing; runtime scan not executed"] };
  await page.addScriptTag({ path: AXE_SOURCE });
  const result = await page.evaluate(async (tags) => {
    const summarize = (entry) => ({ id: entry.id, impact: entry.impact, help: entry.help, nodes: entry.nodes.length, targets: entry.nodes.map((node) => node.target) });
    // Document-level navigation rules belong to the real-app gate, not an
    // isolated iframe. Include portal surfaces alongside the actual canvas.
    const context = { include: [["#storybook-root"], ["dialog"], ["[role='listbox']"], ["[role='tooltip']"]] };
    const standards = await window.axe.run(context, { runOnly: { type: "tag", values: tags } });
    const enhanced = await window.axe.run(context, { runOnly: { type: "rule", values: ["color-contrast-enhanced"] } });
    // axe resolves alpha/background stacks; retain its computed pairs instead
    // of misreading CSS color()/oklch() values with an RGB regex.
    const measured = new Map();
    for (const result of [standards, enhanced]) for (const outcome of ["passes", "violations", "incomplete"]) {
      for (const rule of result[outcome]) {
        if (!rule.id.startsWith("color-contrast")) continue;
        for (const node of rule.nodes) for (const check of [...node.any, ...node.all, ...node.none]) {
          const data = check.data;
          if (!data?.fgColor || !data?.bgColor || !Number.isFinite(data.contrastRatio)) continue;
          const fontSizePx = Number(data.fontSize?.match(/\(([\d.]+)px\)/)?.[1]);
          const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && data.fontWeight === "bold");
          measured.set(JSON.stringify(node.target), { target: node.target, text: node.html, foreground: data.fgColor, background: data.bgColor, contrastRatio: data.contrastRatio, fontSizePx, large, threshold: large ? 4.5 : 7 });
        }
      }
    }
    return {
      textSurfaces: [...measured.values()],
      violations: standards.violations.map(summarize),
      incomplete: standards.incomplete.map(summarize),
      standards: { violations: standards.violations.map(summarize), incomplete: standards.incomplete.map(summarize) },
      enhanced: { violations: enhanced.violations.map(summarize), incomplete: enhanced.incomplete.map(summarize) }
    };
  }, TAGS);
  const empty = !result.standards.violations.length && !result.standards.incomplete.length && !result.enhanced.violations.length && !result.enhanced.incomplete.length;
  return { status: empty ? "pass" : "fail", tags: TAGS, scope, ...result };
}

async function geometry(page) {
  return page.evaluate(async () => {
    const root = [...document.querySelectorAll("dialog:modal")].at(-1) ?? document.querySelector("#storybook-root");
    const controls = [];
    const opener = document.activeElement;
    for (const node of root.querySelectorAll("button, a[href], input, select, textarea, [tabindex]")) {
      if (!node.isConnected || node.tabIndex < 0 || node.matches(":disabled") || node.closest("[inert]")) continue;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible" || style.display === "none" || !node.getClientRects().length) continue;
      // Measure the surface a user actually points at. Checkboxes/radios are
      // operated through their label; a code editor is operated through its
      // focusable wrapper, not the offscreen textarea the editor positions at
      // the caret for keystrokes and IME composition (resizing that breaks
      // caret math, so the wrapper is the honest target).
      const editorHost = node.matches("textarea.inputarea")
        ? node.closest(".dd-monaco-surface[tabindex]")
        : null;
      const target = editorHost
        ?? (node.matches("input[type=checkbox],input[type=radio]") && node.labels?.length ? node.labels[0] : node);
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = target.getBoundingClientRect();
      const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const hitTest = center === target || target.contains(center);
      const inlineLink = node.tagName === "A" && getComputedStyle(node).display === "inline" && node.parentElement?.closest("p,li");
      const targetSize = !!inlineLink || (rect.width >= 44 && rect.height >= 44);
      node.focus({ preventScroll: true });
      const focused = document.activeElement === node || (!!editorHost && editorHost.contains(document.activeElement));
      controls.push({ name: node.getAttribute("aria-label") || node.textContent.trim(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hitTest, targetSize, focused, status: hitTest && targetSize && focused ? "pass" : "fail" });
    }
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    return controls;
  });
}

function save(artifactDir, entry) {
  const key = artifactKey(entry.runtimeArtifactId, entry.browser.name, entry.theme, entry.viewportLabel).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const raw = { ...entry }; delete raw.evidenceSha256; entry.evidenceSha256 = hash(JSON.stringify(raw));
  writeFileSync(path.join(artifactDir, `${key}.json`), JSON.stringify(entry, null, 2));
}

const stories = built();
const mappings = new Map();
for (const row of manifest.rows) for (const scenario of row.storyScenarios) mappings.set(scenario.storyId, [...(mappings.get(scenario.storyId) ?? []), { source: row, scenario }]);
const referenceCounts = new Map((manifest.referenceStories ?? []).map((reference) => [reference.storyId, 0]));
for (const reference of manifest.referenceStories ?? []) referenceCounts.set(reference.storyId, (referenceCounts.get(reference.storyId) ?? 0) + 1);
const references = new Map((manifest.referenceStories ?? []).filter((reference) => reference.reviewStatus === "approved" && referenceCounts.get(reference.storyId) === 1 && reference?.reviewedBy && typeof reference.reason === "string" && reference.reason.trim() && /\.stories\.[jt]sx?$/.test(reference?.sourcePath || "") && /^[a-f0-9]{64}$/.test(reference?.sourceSha256 || "") && stories.get(reference.storyId)?.importPath === reference?.sourcePath && sourceDigest(reference?.sourcePath) === reference?.sourceSha256 && !mappings.has(reference.storyId)).map((reference) => [reference.storyId, reference]));
if (!stories.size) test("built Storybook index is available", () => { throw new Error("missing built Storybook index at storybook-static/index.json"); });
const planned = [];
for (const [storyId, entry] of stories) {
  const storyMappings = mappings.get(storyId) ?? [];
  const rows = [...new Map(storyMappings.map(({ source }) => [source.id, source])).values()];
  const scenarios = storyMappings.map(({ scenario }) => scenario);
  const reference = references.get(storyId);
  const sources = reference && !rows.length ? [reference] : rows;
  planned.push({
    storyId,
    entry,
    hasPlay: (entry.tags ?? []).includes("play-fn"),
    rows,
    sourceHashes: sourceHashesFor(sources),
    scenario: {
      id: storyId,
      storyId,
      runtimeArtifactId: storyId,
      axes: [...new Set(scenarios.flatMap((scenario) => scenario.axes ?? []))],
      expectedVisibleTexts: [...new Set(scenarios.map((scenario) => scenario.expectedVisibleText).filter(Boolean))],
      // Error-path stories legitimately log through the production error handler. The
      // expectation is declared per scenario and is required, not merely tolerated.
      expectedConsoleErrors: [...new Set(scenarios.flatMap((scenario) => scenario.expectedConsoleErrors ?? []))],
    },
  });
}
for (const { storyId, rows, sourceHashes, scenario, hasPlay } of planned) test(storyId, async ({ page, qa, browserName }) => {
  if (!/^[a-f0-9]{40}$/.test(candidateCommitSha ?? "")) throw new Error("DURINDOOR_CANDIDATE_SHA 40-hex commit SHA required");
  const { browser, theme, viewport } = qa.project;
  if (browserName !== browser) throw new Error(`project browser ${browser} differs from Playwright engine ${browserName}`);
  const artifactDir = process.env.DURINDOOR_QA_ARTIFACT_DIR || qa.artifactDir;
  const storybookArtifactDir = path.join(artifactDir, "storybook");
  const failureArtifactDir = path.join(artifactDir, "failures");
  mkdirSync(storybookArtifactDir, { recursive: true });
  mkdirSync(failureArtifactDir, { recursive: true });
  const consoleErrors = []; const pageErrors = []; const networkFailures = []; const networkExternalEffects = [];
  const recordConsole = (message) => { if (message.type() === "error") consoleErrors.push(message.text()); };
  const recordPageError = (error) => pageErrors.push(error.message);
  const recordFailedRequest = (request) => networkFailures.push(`${request.url()}: ${request.failure()?.errorText}`);
  const recordRequest = (request) => { try { if (new URL(request.url()).origin !== new URL(qa.baseURL).origin) networkExternalEffects.push(request.url()); } catch { networkExternalEffects.push(request.url()); } };
  page.on("console", recordConsole); page.on("pageerror", recordPageError); page.on("requestfailed", recordFailedRequest); page.on("request", recordRequest);

  // Diagnostic-only capture. Coverage validator ignores subdirs; persisting
  // this snapshot cannot make a failing case pass. The snapshot is taken for
  const key = artifactKey(storyId, browser, theme, viewport).replace(/[^a-zA-Z0-9_.-]/g, "_");
  let version = null;
  const writeFailureDiagnostic = (error) => {
    try {
      writeFileSync(path.join(failureArtifactDir, `${key}-failure.json`), JSON.stringify({
        storyId,
        runtimeArtifactId: storyId,
        browser: { name: browserName, version },
        theme,
        viewportLabel: viewport,
        assertion: { message: String(error?.message ?? error), stack: error?.stack ?? null },
        axes: scenario.axes ?? [],
        expectedVisibleTexts: scenario.expectedVisibleTexts,
        expectedConsoleErrors: scenario.expectedConsoleErrors,
        a11y: typeof a11y !== "undefined" ? a11y : null,
        controls: typeof controls !== "undefined" ? controls : null,
        storybookFinished: typeof finalStorybookFinished !== "undefined" ? finalStorybookFinished.finished : null,
        consoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors],
        networkFailures: [...networkFailures],
        networkExternalEffects: [...networkExternalEffects],
        actualTheme: typeof actualTheme !== "undefined" ? actualTheme : null,
        actualThemeBefore: typeof beforeEvidence !== "undefined" ? beforeEvidence.actualTheme : null,
        capturedAt: new Date().toISOString(),
      }, null, 2));
    } catch { /* diagnostic best-effort; never mask the original failure */ }
  };

  let a11y;
  let controls;
  let image;
  let artifactRelativePath;
  let finalStorybookFinished;
  let actualTheme;
  let beforeEvidence;
  try {
    await installListener(page);
    const url = new URL(`/iframe.html?id=${storyId}&viewMode=story`, qa.baseURL);
    url.searchParams.set("globals", `theme:${theme}`);
    await page.goto(url.toString());
    await proveStable(page, storyId);
    beforeEvidence = await page.evaluate(() => ({ phases: window.__durindoorStoryEvidence?.phases, actualTheme: document.documentElement.classList.contains("dark") ? "dark" : "light" }));
    const beforePhaseErrors = validateStorybookLifecycle({ storyId, phases: beforeEvidence.phases, expectedHasPlay: hasPlay });
    if (beforePhaseErrors.length) throw new Error(`Storybook phase evidence failed before scans for ${storyId}: ${beforePhaseErrors.join("; ")}`);
    if (beforeEvidence.actualTheme !== theme) throw new Error(`Storybook stable theme is ${beforeEvidence.actualTheme}, expected ${theme}`);
    a11y = await runAxe(page);
    controls = await geometry(page);
    image = await page.screenshot({ fullPage: true });
    artifactRelativePath = path.join("storybook", `${key}.png`);
    writeFileSync(path.join(storybookArtifactDir, `${key}.png`), image);
    finalStorybookFinished = await page.evaluate((id) => {
      const state = window.__durindoorStoryEvidence;
      if (!state?.installed) throw new Error("Storybook addon channel listener did not install");
      if (state.failures.length) throw new Error(`Storybook failure event ${JSON.stringify(state.failures)}`);
      if (!state.finished || state.finished.storyId !== id || state.finished.status !== "success") throw new Error(`Storybook storyFinished changed or failed for ${id}`);
      return { finished: state.finished, phases: state.phases };
    }, storyId);
    version = await page.evaluate(() => navigator.userAgent.match(/(?:Chrome|Firefox|Version)\/([\d.]+)/)?.[1] ?? "unknown");
    const phaseErrors = validateStorybookLifecycle({ storyId, phases: finalStorybookFinished.phases, expectedHasPlay: hasPlay });
    if (phaseErrors.length) throw new Error(`Storybook phase evidence failed for ${storyId}: ${phaseErrors.join("; ")}`);
    actualTheme = await page.evaluate(() => document.documentElement.classList.contains("dark") ? "dark" : "light");
    const finalStorybookStatus = finalStorybookFinished.finished;
    await qa.assertNoExternalEffects();
    expect(a11y.status, `${storyId} standards+enhanced axe failures: standards=${JSON.stringify(a11y.standards)} enhanced=${JSON.stringify(a11y.enhanced)}`).toBe("pass");
    expect(controls.filter((c) => c.status === "fail"), `${storyId} rendered control geometry failures`).toEqual([]);
    for (const text of scenario.expectedVisibleTexts) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    const unconsumedConsoleErrors = [...consoleErrors];
    const missingConsoleErrors = [];
    for (const expected of scenario.expectedConsoleErrors) {
      const at = unconsumedConsoleErrors.findIndex((text) => text.includes(expected));
      if (at === -1) missingConsoleErrors.push(expected); else unconsumedConsoleErrors.splice(at, 1);
    }
    expect(unconsumedConsoleErrors, `${storyId} undeclared console errors`).toEqual([]);
    expect(missingConsoleErrors, `${storyId} declared console errors never logged`).toEqual([]);
    expect(pageErrors, `${storyId} page errors`).toEqual([]);
    expect(networkFailures, `${storyId} network failures`).toEqual([]);
    expect(networkExternalEffects, `${storyId} network external effects`).toEqual([]);
    expect(finalStorybookStatus?.status, `${storyId} final play status`).toBe("success");
    expect(finalStorybookStatus?.storyId, `${storyId} final finished story id`).toBe(storyId);
    expect(actualTheme, `${storyId} final theme`).toBe(theme);
    save(artifactDir, { runtimeArtifactId: storyId, storyId, scenarioId: storyId, sourceHashes, candidateCommitSha, artifactRelativePath, artifactSha256: hash(image), theme, actualThemeBefore: beforeEvidence.actualTheme, actualTheme, viewportLabel: viewport, browser: { name: browserName, version }, axes: scenario.axes ?? [], expectedConsoleErrors: scenario.expectedConsoleErrors, hasPlay, playStatus: "success", storybookFinished: finalStorybookStatus, renderId: finalStorybookFinished.phases[0]?.renderId, renderPhases: finalStorybookFinished.phases, consoleErrors, pageErrors, networkFailures, networkExternalEffects, a11y, geometry: { controls, textSurfaces: a11y.textSurfaces }, manifestMappings: rows.map((row) => ({ id: row.id, reviewStatus: row.reviewStatus, approvedClassification: row.approvedClassification, sourcePath: row.sourcePath })), unverifiedCriteria: a11y.unverifiedCriteria ?? [] });
  } catch (error) {
    writeFailureDiagnostic(error);
    throw error;
  } finally {
    page.off("console", recordConsole); page.off("pageerror", recordPageError); page.off("requestfailed", recordFailedRequest); page.off("request", recordRequest);
  }
});
for (const [storyId, rows] of mappings) if (!stories.has(storyId)) test(`${rows[0].scenario.id} has built Storybook story`, () => { throw new Error(`${storyId}: manifest scenario missing from built index`); });
