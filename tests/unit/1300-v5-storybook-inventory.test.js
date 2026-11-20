import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCoverage } from "../../scripts/check-storybook-coverage.mjs";
import { REVIEW_SURFACES } from "../../src/shared/ui/v5/review-manifest.js";

const manifest = JSON.parse(readFileSync(new URL("../e2e/storybook-surfaces.json", import.meta.url), "utf8"));
const pendingRows = manifest.rows.filter((row) => row.reviewStatus === "pending");
const pendingReferences = manifest.referenceStories.filter((reference) => reference.reviewStatus === "pending");

describe("V5 Storybook surface inventory", () => {
  it("matches the current production source census and scenario hashes", async () => {
    expect(await validateCoverage({ manifest, mode: "inventory" })).toEqual([]);
    expect(manifest.inventoryReconciliation).toMatchObject({
      pendingRows: pendingRows.length,
      retainedApprovedRows: manifest.rows.length - pendingRows.length,
      pendingReferences: pendingReferences.length,
    });
  });

  it("accounts for every generated review scenario in the surface manifest", () => {
    const inventoriedStories = new Set([
      ...manifest.rows.flatMap((row) => row.storyScenarios.map((scenario) => scenario.storyId)),
      ...manifest.referenceStories.map((reference) => reference.storyId),
    ]);
    const reviewStoryIds = REVIEW_SURFACES.flatMap((surface) => surface.storyIds);
    expect(reviewStoryIds.length).toBeGreaterThan(0);
    expect(reviewStoryIds.filter((id) => !inventoriedStories.has(id))).toEqual([]);
  });

  it("rejects pending production rows and reference stories in final coverage", async () => {
    expect(pendingRows.length).toBeGreaterThan(0);
    expect(pendingReferences.length).toBeGreaterThan(0);
    expect(pendingRows.filter((row) => row.reviewedBy || row.approvedClassification ||
      row.approvedScenarioIds.length || row.approvedException || row.reviewEvidence)).toEqual([]);
    expect(pendingReferences.filter((reference) => reference.reviewedBy ||
      reference.reviewEvidence || reference.runtimeStatus !== "pending")).toEqual([]);

    const errors = new Set(await validateCoverage({ manifest, mode: "final" }));
    const pendingErrors = [
      ...pendingRows.map((row) => `${row.id}: pending review cannot close coverage`),
      ...pendingReferences.map((reference) => `${reference.storyId}: pending reference review cannot close coverage`),
    ];
    expect(pendingErrors.filter((error) => !errors.has(error))).toEqual([]);
  });
});
