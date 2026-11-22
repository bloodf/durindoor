import { describe, expect, it } from "vitest";
import { filterExposedModels, isModelExposureAllowed } from "../../src/shared/utils/modelExposureList.js";

// OmniRoute #20977: catalog rows carry the provider alias (`cx/`) while the
// operator lists may name the registry id (`codex/`). Both spellings must hit.
describe("model exposure list provider spellings (OmniRoute #20977)", () => {
  it("denylist written with the registry id hides the alias-prefixed Codex row", () => {
    const settings = { modelVisibilityDenylist: ["codex/gpt-5"] };
    expect(isModelExposureAllowed("cx", "gpt-5", settings)).toBe(false);
    expect(isModelExposureAllowed("cx", "gpt-5-mini", settings)).toBe(true);
  });

  it("allowlist written with the registry id keeps the alias-prefixed Codex row", () => {
    const settings = { modelVisibilityAllowlist: ["codex/gpt-5"] };
    expect(isModelExposureAllowed("cx", "gpt-5", settings)).toBe(true);
    expect(isModelExposureAllowed("cx", "gpt-5-mini", settings)).toBe(false);
  });

  it("alias spelling in the list matches the registry-id row, and deny still wins", () => {
    expect(isModelExposureAllowed("codex", "gpt-5", { modelVisibilityDenylist: ["cx/gpt-5"] })).toBe(false);
    const both = { modelVisibilityAllowlist: ["cx/*"], modelVisibilityDenylist: ["codex/gpt-5"] };
    expect(isModelExposureAllowed("cx", "gpt-5", both)).toBe(false);
    expect(isModelExposureAllowed("cx", "gpt-5-mini", both)).toBe(true);
  });

  it("caller-supplied custom prefixes resolve to the provider id", () => {
    const settings = { modelVisibilityDenylist: ["codex/gpt-5"] };
    expect(isModelExposureAllowed("mycx", "gpt-5", settings)).toBe(true);
    expect(isModelExposureAllowed("mycx", "gpt-5", settings, (p) => (p === "mycx" ? "codex" : undefined))).toBe(false);
  });

  it("auto pool filter applies the same spellings", () => {
    const pool = ["cx/gpt-5", "cx/gpt-5-mini", "openrouter/vendor/model"];
    expect(filterExposedModels(pool, { modelVisibilityDenylist: ["codex/gpt-5"] })).toEqual([
      "cx/gpt-5-mini",
      "openrouter/vendor/model",
    ]);
  });

  it("empty lists still expose everything", () => {
    expect(isModelExposureAllowed("cx", "gpt-5", {})).toBe(true);
  });
});
