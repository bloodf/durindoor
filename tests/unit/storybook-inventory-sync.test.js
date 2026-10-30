import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcileStorybookInventory } from "../../scripts/sync-storybook-inventory.mjs";
import { validateCoverage } from "../../scripts/check-storybook-coverage.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const panel = "export default function Panel(){return <section>Measured requests</section>;}";
const story = "import Panel from './Panel.jsx'; export default { component: Panel }; export const Default = {};";
const directories = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybook-inventory-sync-")); directories.push(root); mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src/Panel.jsx"), panel); writeFileSync(path.join(root, "src/Panel.stories.jsx"), story);
  const scenario = { id: "panel--default", storyId: "panel--default", runtimeArtifactId: "panel--default", axes: ["text"], sourceHashes: { "src/Panel.jsx": hash(panel), "src/Panel.stories.jsx": hash(story) } };
  const row = { id: "src/Panel.jsx#Panel", sourcePath: "src/Panel.jsx", symbol: "Panel", sourceSha256: hash(panel), proposedClassification: "visual", approvedClassification: "visual", reviewStatus: "approved", reviewedBy: "independent-test-reviewer", requiredScenarioIds: [scenario.id], approvedScenarioIds: [scenario.id], storyScenarios: [scenario], reviewEvidence: { scope: "source-only" } };
  return { root, manifest: { schemaVersion: 1, rows: [row], referenceStories: [] }, index: { entries: { "panel--default": { type: "story", importPath: "./src/Panel.stories.jsx", componentPath: "./src/Panel.jsx" } } } };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("reproducible pending Storybook inventory reconciliation", () => {
  it("retains unchanged exact-source approvals and is idempotent", () => {
    const input = fixture(); const next = reconcileStorybookInventory(input);
    expect(next.rows[0]).toEqual(input.manifest.rows[0]);
    expect(reconcileStorybookInventory({ ...input, manifest: next })).toEqual(next);
  });
  it("demotes changed source and archives its prior approval without approving new bytes", () => {
    const input = fixture(); writeFileSync(path.join(input.root, "src/Panel.jsx"), panel.replace("Measured requests", "Loading requests"));
    const next = reconcileStorybookInventory(input), row = next.rows[0];
    expect(row.reviewStatus).toBe("pending"); expect(row.reviewedBy).toBeNull(); expect(row.approvedClassification).toBeNull(); expect(row.approvedScenarioIds).toEqual([]);
    expect(row.historicalSourceApprovals[0]).toMatchObject({ reviewStatus: "approved", sourceSha256: hash(panel) });
    expect(row.sourceSha256).toBe(hash(readFileSync(path.join(input.root, "src/Panel.jsx"))));
    expect(reconcileStorybookInventory({ ...input, manifest: next })).toEqual(next);
  });
  it("demotes unchanged components when their story source changed", () => {
    const input = fixture(); writeFileSync(path.join(input.root, "src/Panel.stories.jsx"), `${story}\n// updated interaction`);
    const row = reconcileStorybookInventory(input).rows[0]; expect(row.sourceSha256).toBe(hash(panel)); expect(row.reviewStatus).toBe("pending"); expect(row.storyScenarios[0].sourceHashes["src/Panel.stories.jsx"]).not.toBe(hash(story));
  });
  it("remaps renamed stories only by exact story source and unambiguous export suffix, pending", () => {
    const input = fixture(); input.index.entries = { "new-panel--default": { type: "story", importPath: "./src/Panel.stories.jsx", componentPath: "./src/Panel.jsx" } };
    const row = reconcileStorybookInventory(input).rows[0]; expect(row.reviewStatus).toBe("pending"); expect(row.requiredScenarioIds).toEqual(["new-panel--default"]); expect(row.approvedScenarioIds).toEqual([]);
  });
  it("censuses new fragments and archives deleted source rows", () => {
    const input = fixture(); rmSync(path.join(input.root, "src/Panel.jsx")); writeFileSync(path.join(input.root, "src/New.jsx"), "export function New(){return <main/>;}");
    const next = reconcileStorybookInventory(input); expect(next.rows.map((row) => row.id)).toEqual(["src/New.jsx#New"]); expect(next.rows[0].reviewStatus).toBe("pending"); expect(next.historicalInventoryRows).toEqual(input.manifest.rows); expect(next.referenceStories[0].reviewStatus).toBe("pending");
    expect(JSON.stringify(reconcileStorybookInventory({ ...input, manifest: next }))).toBe(JSON.stringify(next));
  });
  it("records pending reference associations without inventing a reviewer and does not grow on rerun", () => {
    const input = fixture(); writeFileSync(path.join(input.root, "src/Foundation.stories.jsx"), "export const Palette={};"); input.index.entries["foundation--palette"] = { type: "story", importPath: "./src/Foundation.stories.jsx" };
    const next = reconcileStorybookInventory(input); expect(next.referenceStories[0]).toMatchObject({ reviewStatus: "pending", reviewedBy: null, runtimeStatus: "pending" }); expect(reconcileStorybookInventory({ ...input, manifest: next })).toEqual(next);
  });
  it("accepts complete pending inventory but refuses final acceptance of the identical proposals", async () => {
    const input = fixture(); writeFileSync(path.join(input.root, "src/Panel.jsx"), `${panel}\n// changed`); writeFileSync(path.join(input.root, "src/Foundation.stories.jsx"), "export const Palette={};"); input.index.entries["foundation--palette"] = { type: "story", importPath: "./src/Foundation.stories.jsx" };
    const manifest = reconcileStorybookInventory(input);
    expect(await validateCoverage({ ...input, manifest, mode: "inventory" })).toEqual([]);
    const final = await validateCoverage({ ...input, manifest, mode: "final", candidateSha: "1".repeat(40) });
    expect(final).toContain("src/Panel.jsx#Panel: pending review cannot close coverage"); expect(final).toContain("foundation--palette: pending reference review cannot close coverage");
  });
  it("binds legitimate Storybook boundary dependencies, demotes their drift, and inventories pending hashes", async () => {
    const input = fixture(); mkdirSync(path.join(input.root, ".storybook"));
    const source = "export const isolated=true;"; writeFileSync(path.join(input.root, ".storybook/network.js"), source);
    input.manifest.rows[0].storyScenarios[0].sourceHashes[".storybook/network.js"] = hash(source);
    expect(reconcileStorybookInventory(input).rows[0].reviewStatus).toBe("approved");
    writeFileSync(path.join(input.root, ".storybook/network.js"), `${source}\n// changed boundary`);
    const manifest = reconcileStorybookInventory(input);
    expect(manifest.rows[0].reviewStatus).toBe("pending");
    expect(manifest.rows[0].storyScenarios[0].sourceHashes[".storybook/network.js"]).toBe(hash(`${source}\n// changed boundary`));
    expect(await validateCoverage({ ...input, manifest, mode: "inventory" })).toEqual([]);
  });
  it.each(["../outside.jsx", "/tmp/outside.jsx", "src/../../outside.jsx", "C:\\outside.jsx", "src/./Panel.jsx", ".storybook/../../outside.jsx"])("rejects outside/non-normalized dependency %s before hashing", (dependency) => {
    const input = fixture(); input.manifest.rows[0].storyScenarios[0].sourceHashes[dependency] = "0".repeat(64);
    expect(() => reconcileStorybookInventory(input)).toThrow(/relative src\/ path/);
  });
  it("rejects current-hash pending dependencies outside src/ without granting inventory credit", async () => {
    const input = fixture(); writeFileSync(path.join(input.root, "src/Panel.jsx"), `${panel}\n// changed`);
    const manifest = reconcileStorybookInventory(input);
    writeFileSync(path.join(input.root, "outside.jsx"), "outside source");
    manifest.rows[0].storyScenarios[0].sourceHashes["src/../outside.jsx"] = hash("outside source");
    const errors = await validateCoverage({ ...input, manifest, mode: "inventory" });
    expect(errors.some((error) => error.includes("pending scenario requires current source hashes"))).toBe(true);
    expect(errors).toContain("panel--default: built story orphaned from manifest");
  });
  it("fails closed for missing/empty catalog source rather than fabricating associations", () => {
    const input = fixture(); expect(() => reconcileStorybookInventory({ ...input, index: { entries: {} } })).toThrow(/no stories/);
    input.index.entries["bad--default"] = { type: "story", importPath: "./src/Missing.stories.jsx" }; expect(() => reconcileStorybookInventory(input)).toThrow(/missing built story source/);
  });
});
