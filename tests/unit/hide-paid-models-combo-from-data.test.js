import { describe, expect, it } from "vitest";

// #6495 / F-4 — fetch/search combo expansion uses the synchronous
// `getComboModelsFromData` helper (handlers wrap it with filterPaidModels).
// These tests pin the helper's raw contract and the handler filter pattern so
// the all-paid `[]` semantics stay identical to the async getComboModels path:
// off === original reference; on === filtered array; all-paid === empty array
// that is still truthy so `if (comboModels)` enters combo routing.

import { getComboModelsFromData } from "../../open-sse/services/combo.js";
import { filterPaidModels } from "../../open-sse/providers/pricing.js";

const PAID = "anthropic/claude-sonnet-5";
const FREE = "aug/claude-sonnet-4.6";
const UNKNOWN = "mystery/never-seen-before";

const combos = [
  { name: "mixed", models: [PAID, FREE, UNKNOWN] },
  { name: "all-paid", models: [PAID] },
  { name: "free-only", models: [FREE] },
];
describe("getComboModelsFromData + filterPaidModels (fetch/search path)", () => {
  it("returns null for provider-slash input", () => {
    expect(getComboModelsFromData("anthropic/claude-sonnet-5", combos)).toBe(null);
  });

  it("returns null for unknown combo name", () => {
    expect(getComboModelsFromData("nope", combos)).toBe(null);
  });

  it("raw helper returns the original member array (off path passthrough)", () => {
    const raw = getComboModelsFromData("mixed", combos);
    expect(raw).toBe(combos[0].models); // same reference
  });

  it("handler pattern toggle off: filterPaidModels(raw, false) preserves identity", () => {
    const raw = getComboModelsFromData("mixed", combos);
    const result = filterPaidModels(raw, false);
    expect(result).toBe(raw);
  });

  it("handler pattern toggle on: mixed → paid + unknown dropped, free kept", () => {
    const raw = getComboModelsFromData("mixed", combos);
    const result = filterPaidModels(raw, true);
    expect(result).toEqual([FREE]);
  });

  it("handler pattern toggle on: all-paid → empty array, still truthy", () => {
    const raw = getComboModelsFromData("all-paid", combos);
    const result = filterPaidModels(raw, true);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
    expect(result).toBeTruthy(); // handlers route via combo, runner returns terminal unavailable
  });

  it("handler pattern toggle on: null stays null (non-combo input unaffected)", () => {
    const raw = getComboModelsFromData("nope", combos);
    expect(filterPaidModels(raw, true)).toBe(null);
  });
});
