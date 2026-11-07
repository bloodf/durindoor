/** Reconcile source and built-catalog inventory proposals. This tool cannot approve
 * a surface, classify an exception, or produce runtime qualification evidence.
 * Run after `storybook:build`; --check is read-only and --write updates proposals.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./check-storybook-coverage.mjs";
import { isString } from "../src/shared/utils/typeChecks.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = /\.(?:js|jsx|mjs|ts|tsx)$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalized = (value) => value?.replace(/^\.\//, "").replaceAll("\\", "/");
function safeSource(source, allowStorybook = false) {
  if (!isString(source) || source.startsWith("/") || /^[a-z]:/i.test(source)) throw new Error("Inventory dependency must be a relative src/ path or .storybook/ path");
  const relative = normalized(source);
  if (!(relative.startsWith("src/") || allowStorybook && relative.startsWith(".storybook/")) || relative.split("/").some((part) => ["..", ".", ""].includes(part))) throw new Error(`Inventory dependency must be a normalized relative src/ path or .storybook/ path: ${source}`);
  return relative;
}
const bytes = (root, source) => readFileSync(path.join(root, safeSource(source, true)));
const digest = (root, source) => existsSync(path.join(root, safeSource(source, true))) ? hash(bytes(root, source)) : null;
function discover(root, directory = "src") {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const source = `${directory}/${entry.name}`;
    return entry.isDirectory() ? discover(root, source) : SOURCE.test(entry.name) && !/(?:test|spec)\./.test(entry.name) && !entry.name.includes(".stories.") ? [source] : [];
  }).sort();
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function historyFor(row) {
  const fields = ["sourceSha256", "reviewStatus", "reviewedBy", "approvedClassification", "approvedScenarioIds", "approvedException", "storyScenarios", "reviewEvidence", "sourceReviewStatus"];
  return Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
}
function withHistoricalApproval(row) {
  if (row.reviewStatus !== "approved") return row.historicalSourceApprovals || [];
  const entry = historyFor(row);
  const history = row.historicalSourceApprovals || [];
  return history.some((previous) => same(previous, entry)) ? history : [...history, entry];
}
/** A file-level built-index association is a proposal, never semantic ownership proof. */
export function reconcileStorybookInventory({ manifest, index, root = ROOT }) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.rows)) throw new Error("Expected schemaVersion 1 inventory");
  const entries = new Map(Object.entries(index?.entries || index?.stories || {}).filter(([, entry]) => entry.type === "story"));
  if (!entries.size) throw new Error("Built Storybook index contains no stories");
  // Validate every active dependency before a digest or read can follow it.
  for (const row of manifest.rows) {
    safeSource(row.sourcePath);
    for (const scenario of row.storyScenarios || []) for (const dependency of Object.keys(scenario.sourceHashes || {})) safeSource(dependency, true);
  }
  for (const reference of manifest.referenceStories || []) safeSource(reference.sourcePath);
  const oldRows = new Map(manifest.rows.map((row) => [row.id, row]));
  if (oldRows.size !== manifest.rows.length) throw new Error("Duplicate source inventory identities require manual reconciliation");
  const imports = new Map();
  for (const [id, entry] of entries) {
    if (!normalized(entry.importPath)?.startsWith("src/") || normalized(entry.importPath).split("/").includes("..") || !/\.stories\.[jt]sx?$/.test(entry.importPath || "") || !digest(root, entry.importPath)) throw new Error(`${id}: missing built story source`);
    const key = `${normalized(entry.importPath)}#${id.split("--").slice(1).join("--")}`;
    imports.set(key, [...(imports.get(key) || []), id]);
  }
  const remap = (scenario) => {
    if (entries.has(scenario.storyId)) return scenario.storyId;
    const suffix = scenario.storyId?.split("--").slice(1).join("--");
    const candidates = [...new Set(Object.keys(scenario.sourceHashes || {}).filter((source) => /\.stories\.[jt]sx?$/.test(source)).flatMap((source) => imports.get(`${normalized(source)}#${suffix}`) || []))];
    return candidates.length === 1 ? candidates[0] : null;
  };
  const scenariosFor = (sourcePath, previous) => {
    const resolved = [], unresolved = [...(previous?.unresolvedHistoricalScenarioIds || [])];
    for (const scenario of previous?.storyScenarios || []) {
      const id = remap(scenario);
      if (!id) { unresolved.push(scenario.storyId); continue; }
      const sourceHashes = Object.fromEntries(Object.keys(scenario.sourceHashes || {}).filter((source) => digest(root, source)).map((source) => [source, digest(root, source)]));
      sourceHashes[sourcePath] = digest(root, sourcePath);
      sourceHashes[normalized(entries.get(id).importPath)] = digest(root, entries.get(id).importPath);
      resolved.push({ ...scenario, id, storyId: id, runtimeArtifactId: id, sourceHashes });
    }
    // New exact componentPath associations are also pending until independently reviewed.
    if (!resolved.length) for (const [id, entry] of entries) if (normalized(entry.componentPath) === sourcePath) resolved.push({ id, storyId: id, runtimeArtifactId: id, axes: ["source-association-pending-review"], sourceHashes: { [sourcePath]: digest(root, sourcePath), [normalized(entry.importPath)]: digest(root, entry.importPath) }, proposedSourceEvidence: "Built componentPath associates this story with the source file. Branch and private-fragment coverage require independent review." });
    return { scenarios: [...new Map(resolved.map((scenario) => [scenario.storyId, scenario])).values()], unresolved: [...new Set(unresolved)] };
  };
  const rows = [], retired = [...(manifest.historicalInventoryRows || [])];
  for (const sourcePath of discover(root)) {
    const result = scanSource(bytes(root, sourcePath).toString(), sourcePath);
    if (result.parseError || result.unknownWrappers.length) throw new Error(result.parseError || `${sourcePath}: unknown render wrappers require manual inventory`);
    const symbols = new Set([...result.candidates, ...manifest.rows.filter((row) => row.sourcePath === sourcePath).map((row) => row.symbol)]);
    for (const symbol of [...symbols].sort()) {
      const id = `${sourcePath}#${symbol}`, previous = oldRows.get(id);
      const sourceSha256 = digest(root, sourcePath);
      const currentDependencies = (previous?.storyScenarios || []).every((scenario) => Object.entries(scenario.sourceHashes || {}).every(([source, sha]) => digest(root, source) === sha));
      const validApproval = previous?.reviewStatus === "approved" && previous.sourceSha256 === sourceSha256 && currentDependencies && (previous.storyScenarios || []).every((scenario) => entries.has(scenario.storyId)) && (previous.approvedClassification !== "visual" || result.candidates.includes(symbol));
      if (validApproval) { rows.push(previous); oldRows.delete(id); continue; }
      const { scenarios, unresolved } = scenariosFor(sourcePath, previous);
      const nextRow = { ...previous, id, sourcePath, symbol, sourceSha256,
        proposedClassification: result.candidates.includes(symbol) ? "visual" : "nonvisual",
        proposedCoverageRationale: "Automated current-source inventory proposal. Independent classification and scenario ownership review are pending.",
        reviewStatus: "pending", reviewedBy: null, approvedClassification: null, approvedScenarioIds: [], approvedException: null,
        requiredScenarioIds: scenarios.map((scenario) => scenario.storyId), storyScenarios: scenarios,
        unresolvedHistoricalScenarioIds: unresolved,
        reviewEvidence: null, sourceReviewStatus: "pending-independent-source-review", runtimeStatus: "pending",
      };
      nextRow.historicalSourceApprovals = previous ? withHistoricalApproval(previous) : [];
      rows.push(nextRow);
      oldRows.delete(id);
    }
  }
  for (const previous of oldRows.values()) if (!retired.some((row) => row.id === previous.id && row.sourceSha256 === previous.sourceSha256)) retired.push(previous);
  const mapped = new Set(rows.flatMap((row) => row.storyScenarios || []).map((scenario) => scenario.storyId));
  const previousReferences = new Map((manifest.referenceStories || []).map((reference) => [reference.storyId, reference]));
  const referenceStories = [];
  for (const [storyId, entry] of entries) if (!mapped.has(storyId)) {
    const previous = previousReferences.get(storyId);
    const sourcePath = entry.importPath;
    const sourceSha256 = digest(root, sourcePath);
    if (previous && previous.sourcePath === sourcePath && previous.sourceSha256 === sourceSha256) referenceStories.push(previous);
    else {
      const reference = { storyId, sourcePath, sourceSha256, reviewStatus: "pending", reviewedBy: null,
      reason: "Built Storybook source association only. Independent reference classification and runtime qualification are pending; this record grants no production coverage.", runtimeStatus: "pending", reviewEvidence: null,
      };
      if (previous) reference.historicalReferenceReview = previous;
      referenceStories.push(reference);
    }
  }
  const next = { ...manifest, status: "INVENTORY_RECONCILED_SOURCE_REVIEW_AND_RUNTIME_PENDING", rows, referenceStories, historicalInventoryRows: retired, runtimeStatus: "pending" };
  // Counts and source/catalog hashes are reproducible; no timestamps or approval identities are invented.
  next.inventoryReconciliation = { tool: "scripts/sync-storybook-inventory.mjs", builtIndexSha256: hash(JSON.stringify(index)), sourceCensusSha256: hash(JSON.stringify(rows.map((row) => [row.id, row.sourceSha256]))), pendingRows: rows.filter((row) => row.reviewStatus === "pending").length, retainedApprovedRows: rows.filter((row) => row.reviewStatus === "approved").length, pendingReferences: referenceStories.filter((reference) => reference.reviewStatus === "pending").length, runtimeStatus: "pending" };
  return next;
}
function argumentsFor(argv) {
  const options = { manifest: path.join(ROOT, "tests/e2e/storybook-surfaces.json"), index: path.join(ROOT, "storybook-static/index.json"), write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write") options.write = true;
    else if (argv[i] === "--check") options.write = false;
    else if (["--manifest", "--index"].includes(argv[i])) { const name = argv[i].slice(2); if (!argv[i + 1]) throw new Error(`Missing ${argv[i]} path`); options[name] = path.resolve(argv[++i]); }
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return options;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFor(process.argv.slice(2));
    const original = JSON.parse(readFileSync(options.manifest, "utf8"));
    const next = reconcileStorybookInventory({ manifest: original, index: JSON.parse(readFileSync(options.index, "utf8")) });
    if (options.write) writeFileSync(options.manifest, `${JSON.stringify(next, null, 2)}\n`);
    else if (!same(original, next)) { console.error("Storybook inventory differs. Rebuild, then run sync-storybook-inventory.mjs --write for pending proposals."); process.exitCode = 1; }
    console.log(JSON.stringify(next.inventoryReconciliation, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
