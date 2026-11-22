// Port of decolua/9router#4874: price filters for compatible-model imports.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterModelsForImport } from "../../src/shared/utils/modelImportFilter.js";

describe("filterModelsForImport (#4874)", () => {
  const free = [{ id: "a:free" }, { id: "b", tier: "free" }, { id: "c", pricing: { prompt: "0", completion: 0 } }];
  const paid = [{ id: "d", pricing: { prompt: "0.000001", completion: "0" } }, { id: "e", tier: "paid" }, { id: "f:free", pricing: { prompt: 0, completion: 0, request: "0.01" } }];
  const unknown = [{ id: "g" }, { id: "h", pricing: { prompt: 0 } }, { id: "i", pricing: { prompt: -1, completion: -1 } }, null];

  it("selects free, paid and never guesses unknown", () => {
    const all = [...free, ...paid, ...unknown];
    expect(filterModelsForImport(all, "free")).toEqual(free);
    expect(filterModelsForImport(all, "paid")).toEqual(paid);
  });

  it("returns the same list for all/default and [] for non-arrays", () => {
    const all = [...free, ...paid];
    expect(filterModelsForImport(all)).toBe(all);
    expect(filterModelsForImport(all, "all")).toBe(all);
    for (const bad of [undefined, null, {}]) expect(filterModelsForImport(bad, "free")).toEqual([]);
  });

  it("is wired into the CompatibleModelsSection import handler", () => {
    const src = readFileSync("../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js", "utf8");
    expect(src).toContain("filterModelsForImport(data.models, importFilter)");
    expect(src).toContain("compatible-model-import-filter");
  });
});
