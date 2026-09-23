import { describe, expect, it } from "vitest";
import { sortComboModels, normalizeSortMethod, SORT_METHODS } from "../../src/lib/combos/comboSort.js";

describe("normalizeSortMethod", () => {
  it("passes through valid methods", () => {
    for (const method of SORT_METHODS) expect(normalizeSortMethod(method)).toBe(method);
  });

  it("falls back to manual for anything else", () => {
    expect(normalizeSortMethod("score")).toBe("manual");
    expect(normalizeSortMethod(undefined)).toBe("manual");
    expect(normalizeSortMethod("bogus")).toBe("manual");
  });
});

describe("sortComboModels", () => {
  const models = ["zprov/model-b", "aprov/model-z", "zprov/model-a", "combo-ref"];

  it("manual is a no-op", () => {
    expect(sortComboModels(models, "manual")).toBe(models);
  });

  it("sorts by provider, stable within a provider; a bare reference (no provider) sorts first", () => {
    expect(sortComboModels(models, "provider")).toEqual([
      "combo-ref",
      "aprov/model-z",
      "zprov/model-b",
      "zprov/model-a",
    ]);
  });

  it("treats a bare combo-name reference as provider '' (sorts first)", () => {
    const withRef = ["zprov/x", "combo-ref", "aprov/y"];
    expect(sortComboModels(withRef, "provider")).toEqual(["combo-ref", "aprov/y", "zprov/x"]);
  });

  it("sorts by full model name", () => {
    expect(sortComboModels(models, "name")).toEqual([
      "aprov/model-z",
      "combo-ref",
      "zprov/model-a",
      "zprov/model-b",
    ]);
  });

  it("returns non-array input unchanged", () => {
    expect(sortComboModels(undefined, "name")).toBeUndefined();
    expect(sortComboModels(null, "provider")).toBeNull();
  });
});
