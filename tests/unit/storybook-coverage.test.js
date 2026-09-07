import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactKey, scanSource, validateCoverage } from "../../scripts/check-storybook-coverage.mjs";

const FIXTURES = {
  defaultExport: "export default function Panel(){return <section><h1>ok</h1></section>;}",
  named: "export const Card = () => <article data-test='card'/>;",
  memo: "import { memo } from 'react'; export const T = memo(function T(){return <div/>;});",
  forward: "import { forwardRef } from 'react'; export const F = forwardRef((p,ref)=><input ref={ref} {...p}/>);",
  lazy: "import { lazy } from 'react'; export const L = lazy(()=>import('./impl.js'));",
  compound: "export function Menu() { return <nav><Item/></nav>; } function Item() { return <span/>; }",
  compoundAssignment: "const Tabs = {}; Tabs.Panel = () => <section/>;",
  privateFragment: "export default function Card({children}){return <>{children}</>;}; function helper(){return <em>x</em>;};",
  privateBranch: "export default function A(){if(Math.random()>0) return null; return <main><Row/></main>;}",
  plain: "export function a(){return 1;}",
  class: "export class C { render(){return <div/>;} }",
  classMissingRender: "export class Q { ping(){ return 1; } }",
  badSource: "export const X = <broken",
  notRenderable: "export const calc = (a, b) => a + b;",
  constants: "export const PROV = { id: 'p', name: 'P' };",
  documentHelper: "export function makeNode(){return typeof document !== 'undefined' ? document.createElement('div') : null;}",
  provider: "export function ThemeProvider({children}){return <div data-theme='dark'>{children}</div>;};",
  dynamic: "import dynamic from 'next/dynamic'; const D = dynamic(()=>import('./X'));",
  prop: "export const Q = (p) => <span title={p.title}/>;",
  reactCreateElement: "export const R = () => React.createElement('section', null, 'ok');",
  jsxFragment: "export const Frag = () => <><span>a</span><span>b</span></>;",
  unknownWrapper: "export const Wrapped = observable(() => <section/>);",
};

it("discovers memoized render callbacks but not data-only hooks", () => {
  const result = scanSource("const detailTable = useCallback((row) => <table><tbody /></table>, []); const label = useCallback((row) => row.name, []); const value = useMemo(() => 42, []); const panel = useMemo(() => <section />, []);");
  expect(result.candidates).toEqual(["detailTable", "panel"]);
  expect(result.unknownWrappers).toEqual([]);
});
const SHA256 = (data) => createHash("sha256").update(data).digest("hex");
const CANDIDATE_SHA = "1".repeat(40);
const MATRIX = ["chromium", "firefox", "webkit"].flatMap((browser) => [[browser, "light", "desktop", { width: 1440, height: 960 }], [browser, "light", "mobile", { width: 390, height: 844 }], [browser, "dark", "desktop", { width: 1440, height: 960 }], [browser, "dark", "mobile", { width: 390, height: 844 }]]);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function approvedSpec({ sourcePath = "src/Panel.jsx", symbol = "Panel", source = FIXTURES.defaultExport, axes = ["text", "controls"], storyId = "approved-story" } = {}) {
  const sourceSha256 = SHA256(source);
  const scenario = { storyId, id: storyId, runtimeArtifactId: storyId, expectedVisibleText: "ok", expectedSha256: sourceSha256, axes };
  return { id: `${sourcePath}#${symbol}`, sourcePath, symbol, source, sourceSha256, proposedClassification: "visual", approvedClassification: "visual", reviewStatus: "approved", reviewedBy: "qa", requiredScenarioIds: [storyId], approvedScenarioIds: [storyId], storyScenarios: [scenario], approvedException: null, reviewEvidence: null };
}
function pendingSpec({ sourcePath, symbol, source } = {}) { return { id: `${sourcePath}#${symbol}`, sourcePath, symbol, source, sourceSha256: SHA256(source), proposedClassification: "visual", approvedClassification: null, reviewStatus: "pending", reviewedBy: null, requiredScenarioIds: [], approvedScenarioIds: [], storyScenarios: [], approvedException: null, reviewEvidence: null }; }
function referenceSpec({ storyId = "foundation-palette--default", sourcePath = "src/Foundation.stories.jsx", source = "export const Default = {};", reviewStatus = "approved" } = {}) { return { storyId, sourcePath, source, sourceSha256: SHA256(source), reviewStatus, reviewedBy: "qa", reason: "Reference-only Storybook style demonstration." }; }
function buildFixture({ rows = [], referenceStories = [] } = {}) { const dir = mkdtempSync(path.join(os.tmpdir(), "storybook-coverage-")); mkdirSync(path.join(dir, "src"), { recursive: true }); for (const item of [...rows, ...referenceStories]) writeFileSync(path.join(dir, item.sourcePath), item.source); return { dir, manifest: { schemaVersion: 1, rows: rows.map((row) => { const { source, ...rest } = row; return { ...rest, sourceSha256: SHA256(source) }; }), referenceStories: referenceStories.map((reference) => { const { source, ...rest } = reference; return { ...rest, sourceSha256: SHA256(source) }; }) } }; }
function caseEntry({ dir, scenario, rows, sourcePaths, browser, theme, viewportLabel, viewport, candidate, extraA11yViolations, missingConsole, missingNetwork, missingArtifactSha, fullAAA, axes, unverified, browserOverride, enhancedFailure, incompleteContrast, badTarget, emptyText, consoleErrors, expectedConsoleErrors, hasPlay = true, renderId = 1788668601581, renderPhases, actualTheme = theme }) {
  const storyId = scenario.storyId;
  const relativePath = `${storyId}__${browser}__${theme}__${viewportLabel}.png`;
  const png = Buffer.from(`fixture-${storyId}-${browser}-${theme}-${viewportLabel}`);
  const a11y = { status: "pass", tags: TAGS, violations: [], incomplete: [], enhanced: { violations: enhancedFailure ? [{ id: "color-contrast-enhanced" }] : [], incomplete: incompleteContrast ? [{ id: "color-contrast-enhanced" }] : [] } };
  const expectedPhases = renderPhases ?? (hasPlay ? ["loading", "rendering", "playing", "played", "completing", "completed", "afterEach", "finished"] : ["loading", "rendering", "completing", "completed", "afterEach", "finished"]);
  for (let i = 0; i < (extraA11yViolations || 0); i += 1) a11y.violations.push({ id: `rule-${i}`, impact: "serious", help: "x", nodes: 1 });
  if (fullAAA) a11y.fullAAA = true;
  const sourceHashes = Object.fromEntries((sourcePaths ?? rows.map((row) => row.sourcePath)).map((sourcePath) => [sourcePath, SHA256(readFileSync(path.join(dir, sourcePath)))]));
  const entry = {
    runtimeArtifactId: storyId,
    storyId,
    scenarioId: storyId,
    sourceHashes,
    candidateCommitSha: candidate,
    artifactRelativePath: relativePath,
    artifactSha256: SHA256(png),
    theme,
    viewportLabel,
    viewport,
    browser: { name: browserOverride ?? browser, version: "120.0" },
    axes: axes ?? scenario.axes,
    playStatus: "success",
    hasPlay,
    renderId,
    renderPhases: expectedPhases.map((newPhase) => ({ storyId, renderId, newPhase })),
    actualTheme,
    storybookFinished: { storyId, status: "success", reporters: [] },
    consoleErrors: consoleErrors ?? (missingConsole ? ["pageerror: oops"] : []),
    expectedConsoleErrors: expectedConsoleErrors ?? [],
    pageErrors: [],
    networkFailures: [],
    networkExternalEffects: missingNetwork ? ["https://external/track"] : [],
    a11y,
    geometry: { textSurfaces: [{ foreground: "#ffffff", background: "#000000", contrastRatio: 21, fontSizePx: 16, large: false }], controls: [{ status: badTarget ? "fail" : "pass", rect: { x: 0, y: 0, width: badTarget ? 20 : 44, height: 44 }, targetSize: !badTarget, focused: true, hitTest: true }] },
    unverifiedCriteria: unverified ?? [],
  };
  if (emptyText) entry.geometry.textSurfaces = [];
  if (missingArtifactSha) entry.artifactSha256 = "0".repeat(64);
  return { entry, png, relativePath };
}
function writeMatrixEvidence({ dir, manifest, candidate = CANDIDATE_SHA, mutateCase = () => ({}) } = {}) {
  const artifactDir = mkdtempSync(path.join(dir, "artifacts-"));
  const byStory = new Map();
  for (const row of manifest.rows) if (row.approvedClassification === "visual") for (const scenario of row.storyScenarios) {
    const cell = byStory.get(scenario.storyId) ?? { scenarios: [], rows: new Map() };
    cell.scenarios.push(scenario); cell.rows.set(row.id, row); byStory.set(scenario.storyId, cell);
  }
  for (const reference of manifest.referenceStories ?? []) if (reference.reviewStatus === "approved" && !byStory.has(reference.storyId)) byStory.set(reference.storyId, { scenarios: [{ storyId: reference.storyId, axes: [] }], rows: new Map([[reference.storyId, reference]]) });
  for (const [, { scenarios, rows }] of byStory) for (const [browser, theme, viewportLabel, viewport] of MATRIX) {
    const scenario = { storyId: scenarios[0].storyId, axes: [...new Set(scenarios.flatMap((item) => item.axes ?? []))], expectedConsoleErrors: [...new Set(scenarios.flatMap((item) => item.expectedConsoleErrors ?? []))] };
    const mutation = mutateCase({ browser, theme, viewportLabel, viewport, scenario, rows: [...rows.values()] }) || {};
    const { entry, png, relativePath } = caseEntry({ dir, scenario, rows: [...rows.values()], browser, theme, viewportLabel, viewport, candidate, expectedConsoleErrors: scenario.expectedConsoleErrors, consoleErrors: scenario.expectedConsoleErrors.length ? [...scenario.expectedConsoleErrors] : undefined, ...mutation });
    const unsigned = { ...entry }; delete unsigned.evidenceSha256; entry.evidenceSha256 = SHA256(JSON.stringify(unsigned));
    if (!mutation.drop) { writeFileSync(path.join(artifactDir, relativePath), png); const key = artifactKey(entry.runtimeArtifactId, entry.browser.name, theme, viewportLabel).replace(/[^a-zA-Z0-9_.-]/g, "_"); writeFileSync(path.join(artifactDir, `${key}.json`), JSON.stringify(entry, null, 2)); }
  }
  return artifactDir;
}

describe("scanSource", () => {
  for (const [name, source] of Object.entries(FIXTURES)) it(`parses ${name} without parse error`, () => { const result = scanSource(source, `${name}.jsx`); if (name === "badSource") { expect(result.parseError).toMatch(/badSource/); return; } expect(result.parseError).toBeNull(); });
  const positive = { defaultExport: ["Panel"], named: ["Card"], memo: ["T"], forward: ["F"], lazy: ["L"], dynamic: ["D"], class: ["C"], compound: ["Menu", "Item"], compoundAssignment: ["Tabs.Panel"], privateFragment: ["Card"], privateBranch: ["A"], provider: ["ThemeProvider"], prop: ["Q"], reactCreateElement: ["R"], jsxFragment: ["Frag"] };
  for (const [name, expected] of Object.entries(positive)) it(`extracts renderable candidates from ${name}`, () => { const result = scanSource(FIXTURES[name], `${name}.jsx`); for (const symbol of expected) expect(result.candidates, `${name} missing ${symbol}`).toContain(symbol); });
  for (const name of ["plain", "classMissingRender", "notRenderable", "constants", "documentHelper", "badSource"]) it(`does not emit renderable candidates from ${name}`, () => { expect(scanSource(FIXTURES[name], `${name}.jsx`).candidates).toEqual([]); });
  it("detects unknown render wrapper call", () => { expect(scanSource(FIXTURES.unknownWrapper, "u.jsx").unknownWrappers).toContain("Wrapped"); });
});

describe("validateCoverage inventory on isolated fixtures", () => {
  it("passes the isolated pending manifest without claiming coverage", async () => { const { dir, manifest } = buildFixture({ rows: [pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport })] }); expect(await validateCoverage({ manifest, root: dir, mode: "inventory" })).toEqual([]); rmSync(dir, { recursive: true, force: true }); });
  it("rejects when an inventory row is missing for a discovered candidate", async () => { const panel = pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport }); const sidebar = pendingSpec({ sourcePath: "src/Sidebar.jsx", symbol: "Sidebar", source: "export default function Sidebar(){return <aside>x</aside>;}\n" }); const { dir, manifest } = buildFixture({ rows: [panel, sidebar] }); const errors = await validateCoverage({ manifest: { ...manifest, rows: manifest.rows.slice(1) }, root: dir, mode: "inventory" }); expect(errors.some((error) => /src\/Panel.jsx#Panel: missing manifest row/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
  it("rejects premature approval that omits approvedClassification", async () => { const { dir, manifest } = buildFixture({ rows: [pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport })] }); const approved = { ...manifest, rows: [{ ...manifest.rows[0], reviewStatus: "approved", reviewedBy: "qa", storyScenarios: [{ storyId: "s", id: "i", runtimeArtifactId: "a", expectedVisibleText: "x", expectedSha256: "0".repeat(64), axes: ["text"] }], approvedScenarioIds: ["i"] }] }; const errors = await validateCoverage({ manifest: approved, root: dir, mode: "inventory" }); expect(errors.some((error) => /approvedClassification required/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
  it("rejects orphan built stories against isolated manifest", async () => { const { dir, manifest } = buildFixture({ rows: [pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport })] }); const index = { entries: { "storybook-ui--orphan": { type: "story" } } }; const errors = await validateCoverage({ manifest, index, root: dir, mode: "inventory" }); expect(errors.some((error) => /built story orphaned/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
  it("rejects invalid reference records without granting built-story credit", async () => { const reference = referenceSpec(); const { dir, manifest } = buildFixture({ rows: [pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport })], referenceStories: [reference] }); const index = { entries: { [reference.storyId]: { type: "story", importPath: reference.sourcePath } } }; for (const invalid of [{ sourceSha256: "0".repeat(64) }, { sourcePath: "src/Wrong.stories.jsx" }, { reviewStatus: "pending" }]) { const errors = await validateCoverage({ manifest: { ...manifest, referenceStories: [{ ...manifest.referenceStories[0], ...invalid }] }, index, root: dir, mode: "inventory" }); expect(errors.some((error) => /built story orphaned/.test(error))).toBe(true); } const missing = await validateCoverage({ manifest: { ...manifest, rows: [] }, index, root: dir, mode: "inventory" }); expect(missing.some((error) => /src\/Panel.jsx#Panel: missing manifest row/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
  it("rejects reference story ID that also has a pending production scenario", async () => { const reference = referenceSpec(); const row = pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport }); row.storyScenarios = [{ id: reference.storyId, storyId: reference.storyId, runtimeArtifactId: reference.storyId, axes: ["text"] }]; const { dir, manifest } = buildFixture({ rows: [row], referenceStories: [reference] }); const errors = await validateCoverage({ manifest, index: { entries: { [reference.storyId]: { type: "story", importPath: reference.sourcePath } } }, root: dir, mode: "inventory" }); expect(errors).toContain(`${reference.storyId}: reference story cannot claim production coverage`); expect(errors.some((error) => /built story orphaned/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
});

describe("validateCoverage final matrix on isolated root", () => {
  const fixture = () => buildFixture({ rows: [approvedSpec()] });
  const index = { entries: { "approved-story": { type: "story", tags: ["play-fn"] } } };

  it("passes final with exact twelve browser-theme-viewport cases", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest }); expect(await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA })).toEqual([]); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("closes reference-only story evidence without production credit", async () => { const reference = referenceSpec(); const { dir, manifest } = buildFixture({ referenceStories: [reference] }); const index = { entries: { [reference.storyId]: { type: "story", importPath: reference.sourcePath, tags: ["play-fn"] } } }; const artifactDir = writeMatrixEvidence({ dir, manifest }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors).toEqual([]); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects absent firefox dark-mobile case", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "firefox" && theme === "dark" && viewportLabel === "mobile" ? { drop: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::firefox::dark::mobile/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects absent chromium light-mobile case", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "light" && viewportLabel === "mobile" ? { drop: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::chromium::light::mobile/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects absent webkit dark-desktop case", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "webkit" && theme === "dark" && viewportLabel === "desktop" ? { drop: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::webkit::dark::desktop/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects PNG artifactSha256 drift", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "light" && viewportLabel === "desktop" ? { missingArtifactSha: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /PNG artifactSha256 drift/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects candidateCommitSha mismatch", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, candidate: "f".repeat(40) }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /candidateCommitSha must equal current 40-hex candidate/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects WCAG 2.2 AA scan violations", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "dark" && viewportLabel === "desktop" ? { extraA11yViolations: 1 } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /a11y WCAG A\/AA runtime scan missing or failed/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  for (const mutation of ["enhancedFailure", "incompleteContrast", "badTarget", "emptyText"]) it(`rejects ${mutation} despite successful play`, async () => {
    const { dir, manifest } = fixture();
    try {
      const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: () => ({ [mutation]: true }) });
      const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
      expect(errors.some((error) => /enhanced contrast scan|control geometry|no contrast measurements/.test(error))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects scenario axes missing from evidence", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "webkit" && theme === "light" && viewportLabel === "mobile" ? { axes: ["other"] } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /scenario axes missing/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects console error captured during runtime", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "light" && viewportLabel === "desktop" ? { missingConsole: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /undeclared console errors/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects external network effect captured during runtime", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "firefox" && theme === "dark" && viewportLabel === "mobile" ? { missingNetwork: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /runtime errors or network effects/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  describe("declared error-path console expectations", () => {
    const errorFixture = () => buildFixture({ rows: [{ ...approvedSpec(), storyScenarios: [{ storyId: "approved-story", id: "approved-story", runtimeArtifactId: "approved-story", expectedVisibleText: "ok", expectedSha256: SHA256(FIXTURES.defaultExport), axes: ["text", "controls"], expectedConsoleErrors: ["Failed to load provider limits"] }] }] });
    const run = async (mutateCase) => { const { dir, manifest } = errorFixture(); try { const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase }); return await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); } finally { rmSync(dir, { recursive: true, force: true }); } };

    it("accepts exactly the declared production error log", async () => {
      expect(await run(() => ({}))).toEqual([]);
    });
    it("rejects a declared error that never logged", async () => {
      const errors = await run(() => ({ consoleErrors: [] }));
      expect(errors.some((error) => /declared console error never logged/.test(error))).toBe(true);
    });
    it("rejects an extra undeclared error beside the declared one", async () => {
      const errors = await run(() => ({ consoleErrors: ["Failed to load provider limits", "TypeError: boom"] }));
      expect(errors.some((error) => /undeclared console errors/.test(error))).toBe(true);
    });
    it("rejects runtime evidence whose declared list drifts from the manifest", async () => {
      const errors = await run(() => ({ expectedConsoleErrors: [] }));
      expect(errors.some((error) => /runtime expectedConsoleErrors drift from manifest/.test(error))).toBe(true);
    });
  });
  it("requires one distinct log per duplicate-prefix expectation", async () => {
    const scenario = { storyId: "approved-story", id: "approved-story", runtimeArtifactId: "approved-story", expectedVisibleText: "ok", expectedSha256: SHA256(FIXTURES.defaultExport), axes: ["text", "controls"], expectedConsoleErrors: ["Request failed for codex", "Request failed for kiro"] };
    const { dir, manifest } = buildFixture({ rows: [{ ...approvedSpec(), storyScenarios: [scenario] }] });
    try {
      // One log mentioning both providers must not satisfy both expectations.
      const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: () => ({ consoleErrors: ["Request failed for codex and Request failed for kiro"] }) });
      const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
      expect(errors.some((error) => /declared console error never logged/.test(error))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects AAA flag set without manual review", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "light" && viewportLabel === "desktop" ? { fullAAA: true } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /full AAA claim requires manual review/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects artifact whose renderPhases drop played despite successful finished status", async () => {
    const { dir, manifest } = fixture();
    const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "light" && viewportLabel === "desktop" ? { renderPhases: ["loading", "rendering", "playing", "completing", "completed", "afterEach", "finished"] } : {} });
    const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
    expect(errors.some((error) => /invalid render phases/.test(error))).toBe(true);
    rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  });
  it("rejects restarted rendering despite successful finished status", async () => {
    const { dir, manifest } = fixture();
    try {
      const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: () => ({ renderPhases: ["loading", "rendering", "playing", "loading", "rendering", "completing", "completed", "afterEach", "finished"] }) });
      const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
      expect(errors.some((error) => /invalid render phases/.test(error))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects the wrong rendered theme despite valid play evidence", async () => {
    const { dir, manifest } = fixture();
    try {
      const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ theme }) => ({ actualTheme: theme === "dark" ? "light" : "dark" }) });
      const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
      expect(errors.some((error) => /actual theme must match/.test(error))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects hasPlay claim that disagrees with built Storybook index tags", async () => {
    const { dir, manifest } = fixture();
    const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: () => ({ hasPlay: false, renderPhases: ["loading", "rendering", "completing", "completed", "afterEach", "finished"] }) });
    const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
    expect(errors.some((error) => /hasPlay must match built Storybook index/.test(error))).toBe(true);
    rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  });
  it("rejects unverified criteria reported without manual review", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "webkit" && theme === "dark" && viewportLabel === "mobile" ? { unverified: ["wcag2aaa"] } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /unsupported runtime criterion unverified/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects tampered evidence JSON", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest }); const target = path.join(artifactDir, "approved-story__chromium__light__desktop.json"); const entry = JSON.parse(readFileSync(target, "utf8")); entry.artifactSha256 = "0".repeat(64); writeFileSync(target, JSON.stringify(entry, null, 2)); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /evidenceSha256 drift/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects firefox evidence claiming the chromium browser engine", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "firefox" && theme === "light" && viewportLabel === "desktop" ? { browserOverride: "chromium" } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::firefox::light::desktop/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects webkit evidence claiming the firefox browser engine", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "webkit" && theme === "light" && viewportLabel === "desktop" ? { browserOverride: "firefox" } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::webkit::light::desktop/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects chromium evidence claiming the webkit browser engine", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "chromium" && theme === "light" && viewportLabel === "desktop" ? { browserOverride: "webkit" } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::chromium::light::desktop/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects evidence that rewrites its browser name to fill another case", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest, mutateCase: ({ browser, theme, viewportLabel }) => browser === "firefox" && theme === "light" && viewportLabel === "desktop" ? { browserOverride: "unknown" } : {} }); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /missing runtime artifact approved-story::firefox::light::desktop/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("rejects duplicate evidence for the same case", async () => { const { dir, manifest } = fixture(); const artifactDir = writeMatrixEvidence({ dir, manifest }); const source = path.join(artifactDir, "approved-story__chromium__light__desktop.json"); const entry = JSON.parse(readFileSync(source, "utf8")); const twin = { ...entry, artifactRelativePath: "approved-story__chromium__light__desktop__twin.png" }; const twinUnsigned = { ...twin }; delete twinUnsigned.evidenceSha256; twin.evidenceSha256 = SHA256(JSON.stringify(twinUnsigned)); writeFileSync(path.join(artifactDir, "approved-story__chromium__light__desktop__twin.json"), JSON.stringify(twin, null, 2)); writeFileSync(path.join(artifactDir, "approved-story__chromium__light__desktop__twin.png"), Buffer.from("twin")); const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /runtime evidence duplicate case approved-story::chromium::light::desktop/.test(error))).toBe(true); rmSync(artifactDir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });
  it("closes final with two source rows sharing one story and one artifact per case", async () => {
    const rowA = approvedSpec({ sourcePath: "src/PanelA.jsx", symbol: "Card", source: FIXTURES.named, storyId: "shared-story" });
    const rowB = approvedSpec({ sourcePath: "src/PanelB.jsx", symbol: "T", source: FIXTURES.memo, storyId: "shared-story" });
    const { dir, manifest } = buildFixture({ rows: [rowA, rowB] });
    const index = { entries: { "shared-story": { type: "story", tags: ["play-fn"] } } };
    try {
      const artifactDir = writeMatrixEvidence({ dir, manifest });
      const written = readdirSync(artifactDir).filter((name) => name.endsWith(".json"));
      expect(written.length).toBe(12);
      const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
      expect(errors).toEqual([]);
      rmSync(artifactDir, { recursive: true, force: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects when one shared source hash drifts on a single artifact", async () => {
    const rowA = approvedSpec({ sourcePath: "src/PanelA.jsx", symbol: "Card", source: FIXTURES.named, storyId: "shared-story" });
    const rowB = approvedSpec({ sourcePath: "src/PanelB.jsx", symbol: "T", source: FIXTURES.memo, storyId: "shared-story" });
    const { dir, manifest } = buildFixture({ rows: [rowA, rowB] });
    const index = { entries: { "shared-story": { type: "story", tags: ["play-fn"] } } };
    try {
      const artifactDir = writeMatrixEvidence({ dir, manifest });
      const target = path.join(artifactDir, "shared-story__chromium__light__desktop.json");
      const entry = JSON.parse(readFileSync(target, "utf8"));
      entry.sourceHashes["src/PanelA.jsx"] = "0".repeat(64);
      const unsigned = { ...entry }; delete unsigned.evidenceSha256;
      entry.evidenceSha256 = SHA256(JSON.stringify(unsigned));
      writeFileSync(target, JSON.stringify(entry, null, 2));
      const errors = await validateCoverage({ manifest, index, artifactDir, root: dir, mode: "final", candidateSha: CANDIDATE_SHA });
      expect(errors.some((error) => /sourceHashes\[src\/PanelA\.jsx\] drift from manifest/.test(error))).toBe(true);
      rmSync(artifactDir, { recursive: true, force: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects pending rows during final closure", async () => { const { dir, manifest } = buildFixture({ rows: [pendingSpec({ sourcePath: "src/Panel.jsx", symbol: "Panel", source: FIXTURES.defaultExport })] }); const errors = await validateCoverage({ manifest, index: { entries: {} }, artifactDir: mkdtempSync(path.join(dir, "artifacts-")), root: dir, mode: "final", candidateSha: CANDIDATE_SHA }); expect(errors.some((error) => /pending review cannot close coverage/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
  it("requires index, artifact dir, and 40-hex candidate SHA for final mode", async () => { const { dir, manifest } = fixture(); const errors = await validateCoverage({ manifest, root: dir, mode: "final" }); expect(errors.some((error) => /requires --index/.test(error))).toBe(true); expect(errors.some((error) => /requires --artifact-dir/.test(error))).toBe(true); expect(errors.some((error) => /requires DURINDOOR_CANDIDATE_SHA/.test(error))).toBe(true); rmSync(dir, { recursive: true, force: true }); });
});
