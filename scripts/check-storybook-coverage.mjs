import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { isNumber, isObject, isString } from "../src/shared/utils/typeChecks.js";
import { validateStorybookLifecycle } from "../tests/e2e/storybook-lifecycle.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXT = /\.(?:js|jsx|mjs|ts|tsx)$/;
const TEST_FILE = /(?:test|spec)\./;
const WRAPPERS = new Set(["memo", "forwardRef", "lazy", "dynamic"]);
const BROWSERS = ["chromium", "firefox", "webkit"];
const MATRIX = BROWSERS.flatMap((browser) => [[browser, "light", "desktop"], [browser, "light", "mobile"], [browser, "dark", "desktop"], [browser, "dark", "mobile"]]);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const idFor = (sourcePath, symbol) => `${sourcePath}#${symbol}`;
export const artifactKey = (runtimeArtifactId, browser, theme, viewport) => `${runtimeArtifactId}::${browser}::${theme}::${viewport}`;

function visual(node) {
  let found = false;
  const boundary = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassDeclaration"]);
  const visit = (current, top) => {
    if (!current || !isObject(current) || found) return;
    if (!top && boundary.has(current.type)) return;
    if (["JSXElement", "JSXFragment"].includes(current.type) || (current.type === "CallExpression" && current.callee?.type === "MemberExpression" && current.callee.object?.name === "React" && current.callee.property?.name === "createElement")) { found = true; return; }
    for (const [key, value] of Object.entries(current)) if (!["loc", "start", "end", "comments", "tokens", "errors"].includes(key)) {
      if (Array.isArray(value)) value.forEach((item) => visit(item, false)); else visit(value, false);
    }
  };
  visit(node, true); return found;
}
function walk(node, visit) { if (!node || !isObject(node)) return; if (isString(node.type)) visit(node); for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens', 'errors'].includes(key)) { if (Array.isArray(value)) value.forEach((item) => walk(item, visit)); else walk(value, visit); } }
function calleeName(node) { return node?.type === "Identifier" ? node.name : node?.type === "MemberExpression" && !node.computed ? node.property?.name : null; }
export function scanSource(source, sourcePath = "fixture.jsx") {
  let ast; try { ast = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "typescript", "dynamicImport", "importAttributes", "classProperties", "decorators-legacy"] }); } catch (error) { return { candidates: [], unknownWrappers: [], parseError: `${sourcePath}: ${error.message}` }; }
  const candidates = new Set(); const unknownWrappers = new Set();
  walk(ast.program, (node) => {
    if (node.type === "FunctionDeclaration" && node.id && visual(node)) candidates.add(node.id.name);
    if (node.type === "ClassDeclaration" && node.id && node.body.body.some((item) => item.type === "ClassMethod" && item.key.name === "render" && visual(item))) candidates.add(node.id.name);
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
      if (visual(node.init)) candidates.add(node.id.name);
      if (node.init.type === "CallExpression" && node.init.arguments[0]) {
        const name = calleeName(node.init.callee);
        if (WRAPPERS.has(name)) candidates.add(node.id.name);
        else if (visual(node.init.arguments[0])) {
          // Hooks can memoize JSX-producing callbacks without declaring a component.
          if (name === "useCallback" || name === "useMemo") candidates.add(node.id.name);
          else unknownWrappers.add(node.id.name);
        }
      }
    }
    if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression" && !node.left.computed && node.left.object.type === "Identifier" && node.left.property.type === "Identifier" && visual(node.right)) candidates.add(`${node.left.object.name}.${node.left.property.name}`);
  });
  return { candidates: [...candidates].sort(), unknownWrappers: [...unknownWrappers].sort(), parseError: null };
}
// `src/legacy` is a frozen copy of the pre-rewrite dashboard, kept only so
// readers can compare it with the redesign before it becomes the default. It
// ships unchanged and is deleted when the preview retires, so it is not new
// surface that needs Durin DS story coverage. The mounted routes under
// `src/app/legacy-ui` stay in scope: they are live code, and they are thin
// re-export wrappers with nothing to cover.
const FROZEN_LEGACY = new Set(["src/legacy"]);
function discover(root) { const result = []; const visit = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((entry) => { const absolute = path.join(dir, entry.name); const relative = path.relative(root, absolute).replaceAll("\\", "/"); if (FROZEN_LEGACY.has(relative)) return; if (entry.isDirectory()) visit(absolute); else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.includes(".stories.")) result.push(relative); }); visit(path.join(root, "src")); return result; }
function digestFile(file) { return new Promise((resolve, reject) => { const digest = createHash("sha256"); const stream = createReadStream(file); stream.on("data", (chunk) => digest.update(chunk)); stream.on("end", () => resolve(digest.digest("hex"))); stream.on("error", reject); }); }
function readEvidence(dir, errors) {
  if (!dir || !existsSync(dir)) return new Map();
  const evidence = new Map();
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, name.name);
    if (name.isDirectory() || !name.name.endsWith(".json")) continue;
    let entry; try { entry = JSON.parse(readFileSync(file, "utf8")); } catch { errors.push(`runtime evidence ${file}: invalid JSON`); continue; }
    const key = artifactKey(entry.runtimeArtifactId, entry.browser?.name, entry.theme, entry.viewportLabel);
    if (evidence.has(key)) errors.push(`runtime evidence duplicate case ${key}`); else evidence.set(key, { entry, jsonFile: file });
  }
  return evidence;
}
function requiredAxes(scenario) { return Array.isArray(scenario.axes) ? scenario.axes : []; }
async function runtimeErrors(storyId, scenarios, sourceRows, browser, theme, viewport, found, artifactDir, candidateSha, root, expectedHasPlay) {
  const label = storyId;
  const errors = []; const key = artifactKey(storyId, browser, theme, viewport);
  if (!found) return [`${label}: missing runtime artifact ${key}`];
  const { entry: artifact, jsonFile } = found;
  if (artifact.runtimeArtifactId !== storyId || artifact.storyId !== storyId || artifact.scenarioId !== storyId || artifact.browser?.name !== browser || artifact.theme !== theme || artifact.viewportLabel !== viewport) errors.push(`${label}: runtime identity mismatch ${key}`);
  if (!GIT_SHA.test(artifact.candidateCommitSha || "") || artifact.candidateCommitSha !== candidateSha) errors.push(`${label}: candidateCommitSha must equal current 40-hex candidate ${key}`);
  if (!isObject(artifact.sourceHashes) || Array.isArray(artifact.sourceHashes)) errors.push(`${label}: sourceHashes object required ${key}`);
  else for (const { row } of sourceRows) {
    const source = path.join(root, row.sourcePath);
    const sourceHash = artifact.sourceHashes[row.sourcePath];
    if (!SHA256.test(sourceHash || "")) errors.push(`${label}: sourceHashes[${row.sourcePath}] missing or invalid ${key}`);
    else if (sourceHash !== row.sourceSha256) errors.push(`${label}: sourceHashes[${row.sourcePath}] drift from manifest ${key}`);
    else if (!existsSync(source) || sourceHash !== hash(readFileSync(source))) errors.push(`${label}: sourceHashes[${row.sourcePath}] drift from candidate source ${key}`);
  }
  if (!SHA256.test(artifact.artifactSha256 || "")) errors.push(`${label}: artifactSha256 invalid ${key}`);
  if (!SHA256.test(artifact.evidenceSha256 || "")) errors.push(`${label}: evidenceSha256 invalid ${key}`);
  else { const unsigned = { ...artifact }; delete unsigned.evidenceSha256; if (hash(JSON.stringify(unsigned)) !== artifact.evidenceSha256) errors.push(`${label}: evidenceSha256 drift ${key} ${jsonFile}`); }
  if (artifact.playStatus !== "success" || artifact.storybookFinished?.status !== "success" || artifact.storybookFinished?.storyId !== storyId) errors.push(`${label}: Storybook play did not finish successfully ${key}`);
  if (artifact.hasPlay !== expectedHasPlay) errors.push(`${label}: hasPlay must match built Storybook index ${key}`);
  const phaseErrors = validateStorybookLifecycle({ storyId, phases: artifact.renderPhases, expectedHasPlay });
  if (phaseErrors.length) errors.push(`${label}: invalid render phases ${key}: ${phaseErrors.join("; ")}`);
  if (!Number.isFinite(artifact.renderId) || artifact.renderId !== artifact.renderPhases?.[0]?.renderId) errors.push(`${label}: renderId missing or mismatched phase identity ${key}`);
  if (artifact.actualTheme !== theme) errors.push(`${label}: actual theme must match requested theme ${key}`);
  if (!artifact.browser?.version || artifact.browser.name !== browser) errors.push(`${label}: browser name/version not captured from runtime ${key}`);
  if (!Array.isArray(artifact.consoleErrors) || !Array.isArray(artifact.pageErrors) || artifact.pageErrors.length || !Array.isArray(artifact.networkFailures) || artifact.networkFailures.length || !Array.isArray(artifact.networkExternalEffects) || artifact.networkExternalEffects.length) errors.push(`${label}: runtime errors or network effects ${key}`);
  if (!artifact.a11y || artifact.a11y.status !== "pass" || !Array.isArray(artifact.a11y.violations) || artifact.a11y.violations.length || !Array.isArray(artifact.a11y.tags) || !["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"].every((tag) => artifact.a11y.tags.includes(tag))) errors.push(`${label}: a11y WCAG A/AA runtime scan missing or failed ${key}`);
  // Error-path stories legitimately log through the production error handler. Each
  // declared expectation must consume exactly one distinct runtime log, so a single
  // log cannot satisfy two expectations and undeclared logs still fail the gate.
  const declared = [...new Set(scenarios.flatMap(({ scenario }) => Array.isArray(scenario.expectedConsoleErrors) ? scenario.expectedConsoleErrors : []))];
  if (Array.isArray(artifact.consoleErrors)) {
    const remaining = [...artifact.consoleErrors];
    for (const expected of declared) {
      const at = remaining.findIndex((text) => isString(text) && text.includes(expected));
      if (at === -1) errors.push(`${label}: declared console error never logged ${key}: ${expected}`);
      else remaining.splice(at, 1);
    }
    if (remaining.length) errors.push(`${label}: undeclared console errors ${key}: ${JSON.stringify(remaining)}`);
    const artifactDeclared = Array.isArray(artifact.expectedConsoleErrors) ? artifact.expectedConsoleErrors : [];
    if (artifactDeclared.length !== declared.length || declared.some((expected) => !artifactDeclared.includes(expected))) errors.push(`${label}: runtime expectedConsoleErrors drift from manifest ${key}`);
  }
  const axes = [...new Set(scenarios.flatMap(({ scenario }) => requiredAxes(scenario)))];
  const requiresAAA = axes.some((axis) => /(?:wcag2aaa|aaa)/i.test(axis));
  const enhanced = artifact.a11y?.enhanced;
  if (!enhanced || !Array.isArray(enhanced.violations) || enhanced.violations.length || !Array.isArray(enhanced.incomplete) || enhanced.incomplete.length) errors.push(`${label}: enhanced contrast scan missing or failed ${key}`);
  if (!Array.isArray(artifact.a11y?.incomplete) || artifact.a11y.incomplete.length) errors.push(`${label}: unresolved accessibility checks ${key}`);
  if (requiresAAA && !artifact.manualAAAReview?.approvedBy) errors.push(`${label}: AAA scenario requires manual criteria review ${key}`);
  if (artifact.a11y?.fullAAA === true && !artifact.manualAAAReview?.approvedBy) errors.push(`${label}: full AAA claim requires manual review ${key}`);
  if (!Array.isArray(artifact.axes) || axes.some((axis) => !artifact.axes.includes(axis))) errors.push(`${label}: scenario axes missing ${key}`);
  if (artifact.unverifiedCriteria?.length) errors.push(`${label}: unsupported runtime criterion unverified ${key}`);
  if (!Array.isArray(artifact.geometry?.textSurfaces) || artifact.geometry.textSurfaces.some((surface) => !surface.foreground || !surface.background || !Number.isFinite(surface.contrastRatio) || !Number.isFinite(surface.fontSizePx) || surface.contrastRatio < (surface.large ? 4.5 : 7))) errors.push(`${label}: rendered text contrast evidence missing or failed ${key}`);
  if (axes.some((axis) => /text|contrast|aaa/i.test(axis)) && !artifact.geometry?.textSurfaces?.length) errors.push(`${label}: required rendered text has no contrast measurements ${key}`);
  if (!Array.isArray(artifact.geometry?.controls) || artifact.geometry.controls.some((control) => control.status !== "pass" || !control.hitTest || !control.focused || !control.targetSize || !isNumber(control.rect?.width) || !isNumber(control.rect?.height))) errors.push(`${label}: rendered control geometry missing or failed ${key}`);
  if (axes.some((axis) => /controls|keyboard/i.test(axis)) && (!Array.isArray(artifact.geometry?.controls) || !artifact.geometry.controls.length)) { const controlScenarios = scenarios.filter(({ scenario }) => requiredAxes(scenario).some((axis) => /controls|keyboard/i.test(axis))); const excused = controlScenarios.length > 0 && controlScenarios.every(({ scenario }) => requiredAxes(scenario).includes("closed-final") && isString(scenario.proposedSourceEvidence) && scenario.proposedSourceEvidence.trim()); if (!excused) errors.push(`${label}: required rendered controls have no geometry evidence ${key}`); }
  const png = artifactDir && artifact.artifactRelativePath ? path.resolve(artifactDir, artifact.artifactRelativePath) : "";
  if (!png || !png.startsWith(path.resolve(artifactDir || "") + path.sep) || !existsSync(png)) errors.push(`${label}: PNG artifact missing ${key}`);
  else { const digest = await digestFile(png); if (digest !== artifact.artifactSha256) errors.push(`${label}: PNG artifactSha256 drift ${key} got=${digest} expected=${artifact.artifactSha256}`); }
  return errors;
}

export async function validateCoverage({ manifest, index = null, artifactDir = null, root = ROOT, mode = "inventory", candidateSha = process.env.DURINDOOR_CANDIDATE_SHA }) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.rows)) return ["manifest: schemaVersion 1 and rows array required"];
  const errors = []; const rows = new Map(); const ids = new Set(); const candidates = new Set();
  for (const row of manifest.rows) { const label = row?.id || "unknown row"; if (row?.id !== idFor(row?.sourcePath, row?.symbol)) errors.push(`${label}: id must equal sourcePath#symbol`); if (ids.has(row?.id)) errors.push(`${label}: duplicate row id`); else ids.add(row?.id); rows.set(row?.id, row); if (!SOURCE_EXT.test(row?.sourcePath || "") || !row.sourcePath.startsWith("src/")) errors.push(`${label}: invalid production sourcePath`); if (!SHA256.test(row?.sourceSha256 || "")) errors.push(`${label}: sourceSha256 required`); if (!["pending", "approved"].includes(row?.reviewStatus)) errors.push(`${label}: reviewStatus must be pending or approved`); if (!["visual", "nonvisual", "retired"].includes(row?.proposedClassification)) errors.push(`${label}: proposedClassification required`); if (!Array.isArray(row?.requiredScenarioIds) || !Array.isArray(row?.storyScenarios)) errors.push(`${label}: scenario arrays required`); if (row?.reviewStatus === "approved") { if (!row.reviewedBy) errors.push(`${label}: approved row missing reviewer`); if (!["visual", "nonvisual", "retired"].includes(row.approvedClassification)) errors.push(`${label}: approvedClassification required`); if (["nonvisual", "retired"].includes(row.approvedClassification) && !row.approvedException?.reason) errors.push(`${label}: ${row.approvedClassification} classification requires proof reason`); for (const id of row.requiredScenarioIds) if (!new Set(row.approvedScenarioIds || []).has(id)) errors.push(`${label}: required scenario ${id} not approved`); if (row.approvedClassification === "visual") for (const scenario of row.storyScenarios) { if (!scenario.id || !scenario.storyId || !scenario.runtimeArtifactId || !requiredAxes(scenario).length) errors.push(`${label}: incomplete visual scenario`); else if (scenario.id !== scenario.storyId || scenario.runtimeArtifactId !== scenario.storyId) errors.push(`${label}: scenario identity must equal storyId`); } } }
  const references = new Map();
  const referenceRecords = [];
  const referenceCounts = new Map();
  if (manifest.referenceStories !== undefined && !Array.isArray(manifest.referenceStories)) errors.push("manifest: referenceStories must be an array");
  for (const reference of manifest.referenceStories ?? []) { const label = reference?.storyId || "unknown reference story"; referenceRecords.push(reference); if (!reference?.storyId) errors.push(`${label}: duplicate or missing reference storyId`); else referenceCounts.set(reference.storyId, (referenceCounts.get(reference.storyId) ?? 0) + 1); if (!/\.stories\.[jt]sx?$/.test(reference?.sourcePath || "")) errors.push(`${label}: reference sourcePath must be a .stories source file`); if (!SHA256.test(reference?.sourceSha256 || "")) errors.push(`${label}: reference sourceSha256 required`); if (!["pending", "approved"].includes(reference?.reviewStatus)) errors.push(`${label}: reference reviewStatus must be pending or approved`); if (!reference?.reviewedBy) errors.push(`${label}: reference reviewedBy required`); if (!isString(reference?.reason) || !reference.reason.trim()) errors.push(`${label}: reference reason required`); const source = path.join(root, reference?.sourcePath || ""); if (!existsSync(source)) errors.push(`${label}: reference orphan source`); else if (SHA256.test(reference?.sourceSha256 || "") && hash(readFileSync(source)) !== reference.sourceSha256) errors.push(`${label}: reference stale source hash`); }
  for (const [storyId, count] of referenceCounts) if (count > 1) errors.push(`${storyId}: duplicate or missing reference storyId`);
  for (const sourcePath of discover(root)) { const result = scanSource(readFileSync(path.join(root, sourcePath), "utf8"), sourcePath); if (result.parseError) { errors.push(result.parseError); continue; } for (const symbol of result.unknownWrappers) errors.push(`${idFor(sourcePath, symbol)}: unknown render wrapper`); for (const symbol of result.candidates) { const id = idFor(sourcePath, symbol); candidates.add(id); if (!rows.has(id)) errors.push(`${id}: missing manifest row`); } }
  for (const row of manifest.rows) { const source = path.join(root, row.sourcePath); if (!existsSync(source)) { errors.push(`${row.id}: orphan source`); continue; } if (hash(readFileSync(source)) !== row.sourceSha256) errors.push(`${row.id}: stale source hash`); if (row.reviewStatus === "approved" && row.approvedClassification === "visual" && !candidates.has(row.id)) errors.push(`${row.id}: approved visual absent from AST inventory`); }
  if (mode === "final" && !index) errors.push("final coverage requires --index built Storybook index"); if (mode === "final" && !artifactDir) errors.push("final coverage requires --artifact-dir runtime evidence directory"); if (mode === "final" && !GIT_SHA.test(candidateSha || "")) errors.push("final coverage requires DURINDOOR_CANDIDATE_SHA 40-hex commit SHA");
  const builtIndex = new Map(Object.entries(index?.entries ?? index?.stories ?? {}).filter(([, entry]) => entry.type === "story")); const built = new Set(builtIndex.keys()); const owned = new Set(manifest.rows.filter((row) => row.reviewStatus === "approved" && row.approvedClassification === "visual").flatMap((row) => row.storyScenarios.map((scenario) => scenario.storyId))); const productionMapped = new Set(manifest.rows.flatMap((row) => row.storyScenarios ?? []).map((scenario) => scenario.storyId)); for (const reference of referenceRecords) { const source = path.join(root, reference?.sourcePath || ""); const entry = builtIndex.get(reference?.storyId); const valid = reference.reviewStatus === "approved" && referenceCounts.get(reference?.storyId) === 1 && /\.stories\.[jt]sx?$/.test(reference?.sourcePath || "") && SHA256.test(reference?.sourceSha256 || "") && reference?.reviewedBy && isString(reference?.reason) && reference.reason.trim() && existsSync(source) && hash(readFileSync(source)) === reference.sourceSha256 && (!index || entry?.importPath === reference.sourcePath) && !productionMapped.has(reference.storyId); if (valid) references.set(reference.storyId, reference); } if (index) { for (const reference of referenceRecords) { const entry = builtIndex.get(reference?.storyId); if (entry && entry.importPath !== reference.sourcePath) errors.push(`${reference.storyId}: reference importPath must equal sourcePath`); else if (!entry) errors.push(`${reference.storyId}: reference story missing built index`); if (productionMapped.has(reference?.storyId)) errors.push(`${reference.storyId}: reference story cannot claim production coverage`); } for (const id of owned) if (!built.has(id)) errors.push(`${id}: manifest story missing built index`); for (const id of built) if (!owned.has(id) && !references.has(id)) errors.push(`${id}: built story orphaned from manifest`); }
  if (mode === "final") { for (const row of manifest.rows) if (row.reviewStatus === "pending") errors.push(`${row.id}: pending review cannot close coverage`); for (const reference of referenceRecords) if (reference?.reviewStatus === "pending") errors.push(`${reference.storyId}: pending reference review cannot close coverage`); if (!artifactDir) return errors; const evidence = readEvidence(artifactDir, errors); const byStory = new Map(); for (const row of manifest.rows) if (row.reviewStatus === "approved" && row.approvedClassification === "visual") for (const scenario of row.storyScenarios) { const cell = byStory.get(scenario.storyId) ?? { scenarios: [], sourceRows: new Map() }; cell.scenarios.push({ scenario }); cell.sourceRows.set(row.id, { row, scenario }); byStory.set(scenario.storyId, cell); } for (const reference of references.values()) if (reference.reviewStatus === "approved" && !byStory.has(reference.storyId)) byStory.set(reference.storyId, { scenarios: [], sourceRows: new Map([[reference.storyId, { row: reference, scenario: { axes: [] } }]]) }); for (const [storyId, { scenarios, sourceRows }] of byStory) for (const [browser, theme, viewport] of MATRIX) errors.push(...await runtimeErrors(storyId, scenarios, [...sourceRows.values()], browser, theme, viewport, evidence.get(artifactKey(storyId, browser, theme, viewport)), artifactDir, candidateSha, root, (builtIndex.get(storyId)?.tags ?? []).includes("play-fn"))); }
  return errors;
}
function args(argv) { const result = { manifest: path.join(ROOT, "tests/e2e/storybook-surfaces.json"), mode: "inventory" }; for (let i = 2; i < argv.length; i += 1) { const value = argv[++i]; if (argv[i - 1] === "--manifest") result.manifest = path.resolve(value); else if (argv[i - 1] === "--index") result.index = path.resolve(value); else if (argv[i - 1] === "--artifact-dir") result.artifactDir = path.resolve(value); else if (argv[i - 1] === "--candidate-sha") result.candidateSha = value; else if (argv[i - 1] === "--mode") result.mode = value; else throw new Error(`unknown argument: ${argv[i - 1]}`); } return result; }
if (process.argv[1] === fileURLToPath(import.meta.url)) (async () => { const input = args(process.argv); const errors = await validateCoverage({ manifest: JSON.parse(readFileSync(input.manifest)), index: input.index && JSON.parse(readFileSync(input.index)), artifactDir: input.artifactDir, mode: input.mode, candidateSha: input.candidateSha }); if (errors.length) throw new Error(errors.join("\n")); console.log(input.mode === "inventory" ? "Storybook inventory valid; pending rows remain unapproved and no coverage is claimed." : "Storybook coverage closed."); })().catch((error) => { console.error(error.message); process.exit(1); });
