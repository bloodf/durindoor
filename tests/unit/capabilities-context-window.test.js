/**
 * Context-window resolution invariants.
 *
 * Exact provider limits belong in provider evidence, not copied test rows.
 */
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("capabilities contextWindow resolution", () => {
  it("resolves dashed thinking IDs through their canonical Claude capability rule", () => {
    for (const [dashed, canonical] of [
      ["claude-opus-4-6-thinking", "claude-opus-4.6-thinking"],
      ["claude-opus-4-7-thinking", "claude-opus-4.7-thinking"],
    ]) {
      expect(getCapabilitiesForModel("anthropic", dashed).contextWindow)
        .toBe(getCapabilitiesForModel("anthropic", canonical).contextWindow);
    }
  });

});
