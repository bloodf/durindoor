import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Regression contract for upstream #2247: Object.entries(modelAliases) can yield
// null alias values from a stale/corrupt alias DB, and calling .startsWith on a
// non-string throws. The fix guards every Object.entries(modelAliases) filter in
// ModelSelectModal with `typeof fullModel === "string" &&` BEFORE `.startsWith`.
//
// No DOM test stack is installed, so this asserts the exact guarded chains as a
// source contract — it fails if any of the three filters drops the type guard or
// reorders it after .startsWith (which would reintroduce the crash).

const MODAL_PATH = path.resolve(
  import.meta.dirname,
  "../../src/shared/components/ModelSelectModal.js"
);

describe("ModelSelectModal null modelAliases guard (#2247)", () => {
  it("every Object.entries(modelAliases) filter type-checks the value before .startsWith", () => {
    const src = fs.readFileSync(MODAL_PATH, "utf8");

    // There are exactly three filter callbacks over Object.entries(modelAliases):
    // alias models, provider-node models, and custom-alias models.
    const entriesCalls = src.match(/Object\.entries\(modelAliases\)/g) || [];
    expect(entriesCalls.length).toBe(3);

    // Each must be paired with a guarded predicate that checks typeof === "string"
    // AND calls .startsWith, with the typeof check lexically preceding .startsWith
    // so the guard actually short-circuits the crash. One guarded chain per
    // Object.entries(modelAliases) call — no more, no less.
    const guardedChains =
      src.match(/typeof fullModel === "string"\s*&&\s*fullModel\.startsWith/g) || [];
    expect(guardedChains.length).toBe(entriesCalls.length);
  });
});
