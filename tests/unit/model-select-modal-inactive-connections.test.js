import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Regression contract (port of decolua/9router#4073): filteredActiveProviders
// used to pass every entry in `activeProviders` straight through, so a
// deactivated provider connection still appeared as a selectable model source
// in every picker built on this component (combos, per-key allowed-models,
// aliases, ...). The fix filters out `isActive === false` connections before
// any kindFilter narrowing, so a disabled connection can never contribute
// models to the picker regardless of which caller passed it in.
//
// No DOM test stack renders this component's live-connection branches
// meaningfully without extensive fetch mocking (see the sibling noauth-freetier
// test for what that costs), so this asserts the guarded filter as a source
// contract, matching the style of the null-alias regression test.

const MODAL_PATH = path.resolve(
  import.meta.dirname,
  "../../src/shared/components/ModelSelectModal.js"
);

describe("ModelSelectModal excludes inactive connections (#4073)", () => {
  it("filteredActiveProviders drops isActive:false entries before kindFilter narrowing", () => {
    const src = fs.readFileSync(MODAL_PATH, "utf8");

    const memoMatch = src.match(
      /const filteredActiveProviders = useMemo\(\(\) => \{[\s\S]*?\}, \[activeProviders, kindFilter\]\);/
    );
    expect(memoMatch, "filteredActiveProviders memo not found").toBeTruthy();

    const memoBody = memoMatch[0];
    expect(memoBody).toMatch(/\.filter\(\(p\) => p && p\.isActive !== false\)/);

    // The isActive filter must run before any kindFilter-based narrowing, so a
    // kindFilter-less caller (the majority) still benefits from it.
    const activeOnlyIndex = memoBody.indexOf("p.isActive !== false");
    const kindFilterIndex = memoBody.indexOf("serviceKinds");
    expect(activeOnlyIndex).toBeGreaterThan(-1);
    expect(kindFilterIndex).toBeGreaterThan(activeOnlyIndex);
  });
});
