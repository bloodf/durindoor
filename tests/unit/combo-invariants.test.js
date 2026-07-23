import { describe, it, expect } from "vitest";
import { validateComboInvariant, ComboInvariantError } from "../../src/lib/combos/invariants.js";

// Port of OmniRoute #8304 — declarative combo provider/model-family invariants.
describe("validateComboInvariant", () => {
  it("no-ops when no constraint is declared", () => {
    expect(() =>
      validateComboInvariant({ name: "free", models: [{ provider: "zai", model: "glm-5" }] })
    ).not.toThrow();
  });

  it("rejects a target whose family is outside allowedModelFamilies", () => {
    expect(() =>
      validateComboInvariant({
        name: "gpt-only",
        allowedProviders: ["github", "codex"],
        allowedModelFamilies: ["gpt"],
        models: [{ provider: "zai", model: "glm-5" }],
      })
    ).toThrow(ComboInvariantError);
  });

  it("accepts a target that satisfies both provider and family", () => {
    expect(() =>
      validateComboInvariant({
        name: "gpt-only",
        allowedProviders: ["github", "codex"],
        allowedModelFamilies: ["gpt"],
        models: [{ provider: "github", model: "gpt-5.4" }],
      })
    ).not.toThrow();
  });

  it("derives the provider from a slash-qualified model id", () => {
    expect(() =>
      validateComboInvariant({
        name: "gpt-only",
        allowedProviders: ["github"],
        models: [{ model: "moonshot/kimi-k2" }],
      })
    ).toThrow(/moonshot.*kimi-k2.*violates/i);
  });

  it("reads constraints nested under invariant and skips combo-ref targets", () => {
    expect(() =>
      validateComboInvariant({
        name: "nested",
        invariant: { allowedModelFamilies: ["claude"] },
        models: [
          { kind: "combo-ref", model: "some-combo" },
          { provider: "anthropic", model: "claude-sonnet-4.6" },
        ],
      })
    ).not.toThrow();
  });

  it("rejects when the family is unknown but a family constraint exists", () => {
    expect(() =>
      validateComboInvariant({
        name: "fam",
        allowedModelFamilies: ["gpt"],
        models: [{ provider: "custom", model: "some-unknown-model" }],
      })
    ).toThrow(ComboInvariantError);
  });
});
