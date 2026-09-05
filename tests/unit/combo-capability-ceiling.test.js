import { describe, expect, it } from "vitest";
import {
  aggregateComboCapabilities,
  normalizeComboCapabilities,
  overlayComboCapabilities,
} from "../../open-sse/providers/capabilities.js";

describe("normalizeComboCapabilities — authenticated boundary validation", () => {
  it("rejects unknown keys with the exact field name", () => {
    const result = normalizeComboCapabilities({ nope: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown capability key: nope/);
  });

  it("rejects non-boolean modality values", () => {
    const result = normalizeComboCapabilities({ vision: "yes" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/vision must be a boolean/);
  });

  it("rejects non-positive safe-integer limits", () => {
    expect(normalizeComboCapabilities({ contextWindow: 0 }).ok).toBe(false);
    expect(normalizeComboCapabilities({ contextWindow: -1 }).ok).toBe(false);
    expect(normalizeComboCapabilities({ contextWindow: 0.5 }).ok).toBe(false);
    expect(normalizeComboCapabilities({ contextWindow: "1000" }).ok).toBe(false);
    expect(normalizeComboCapabilities({ maxOutput: Number.NaN }).ok).toBe(false);
  });

  it("accepts a complete valid cap", () => {
    const result = normalizeComboCapabilities({
      vision: true,
      tools: false,
      contextWindow: 100000,
      maxOutput: 32000,
    });
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({
      vision: true,
      tools: false,
      contextWindow: 100000,
      maxOutput: 32000,
    });
  });

  it("treats null and undefined as a no-op clear", () => {
    expect(normalizeComboCapabilities(null)).toEqual({ ok: true, capabilities: null });
    expect(normalizeComboCapabilities(undefined)).toEqual({ ok: true, capabilities: null });
  });

  it("treats an empty object as an explicit no-op cap", () => {
    const result = normalizeComboCapabilities({});
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({});
  });
});

describe("overlayComboCapabilities — member-safe minimum intersection", () => {
  it("returns the derived caps unchanged when the cap is missing or malformed", () => {
    const derived = { vision: true, contextWindow: 100000, maxOutput: 32000 };
    expect(overlayComboCapabilities(derived, null)).toBe(derived);
    expect(overlayComboCapabilities(derived, undefined)).toBe(derived);
    expect(overlayComboCapabilities(derived, "nope")).toBe(derived);
    expect(overlayComboCapabilities(derived, [1, 2])).toBe(derived);
  });

  it("never enables a capability the derivation would not already permit", () => {
    const derived = { vision: false, search: false, audioInput: false };
    const cap = { vision: true, search: true, audioInput: true };
    const out = overlayComboCapabilities(derived, cap);
    expect(out.vision).toBe(false);
    expect(out.search).toBe(false);
    expect(out.audioInput).toBe(false);
  });

  it("disables a derived capability when the operator opts in to false", () => {
    const derived = { vision: true, search: true };
    const out = overlayComboCapabilities(derived, { vision: false });
    expect(out.vision).toBe(false);
    expect(out.search).toBe(true);
  });

  it("lowers derived numeric limits but leaves unknown ones unknown", () => {
    const derived = { contextWindow: 500000, maxOutput: 64000 };
    const out = overlayComboCapabilities(derived, { contextWindow: 100000, maxOutput: 1000000 });
    expect(out.contextWindow).toBe(100000);
    expect(out.maxOutput).toBe(64000);
  });

  it("does not introduce a numeric limit that was unknown in the derivation", () => {
    const derived = { contextWindow: undefined, maxOutput: undefined };
    const out = overlayComboCapabilities(derived, { contextWindow: 100000, maxOutput: 32000 });
    expect(out.contextWindow).toBeUndefined();
    expect(out.maxOutput).toBeUndefined();
  });

  it("clears thinking metadata when the cap forces reasoning:false", () => {
    const derived = {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      thinkingRange: { min: 0, max: 1000 },
    };
    const out = overlayComboCapabilities(derived, { reasoning: false });
    expect(out.reasoning).toBe(false);
    expect(out.thinkingFormat).toBeNull();
    expect(out.thinkingCanDisable).toBe(true);
    expect(out.thinkingRange).toBeNull();
  });
});

describe("overlayComboCapabilities — end-to-end against aggregateComboCapabilities", () => {

  it("preserves a nested combo ceiling in an outer combo", () => {
    const lookup = {
      inner: { models: ["opencode-go/mimo-v2.5"], capabilities: { vision: false, maxOutput: 1024 } },
    };
    const out = aggregateComboCapabilities(["inner"], lookup);
    expect(out.vision).toBe(false);
    expect(out.maxOutput).toBe(1024);
  });
  it("clamps aggregated output ceiling to the operator cap", () => {
    const derived = aggregateComboCapabilities(["opencode-go/mimo-v2.5", "opencode-go/kimi-k2.5"]);
    const out = overlayComboCapabilities(derived, { maxOutput: 1024 });
    expect(out.maxOutput).toBe(1024);
    expect(out.contextWindow).toBe(262144);
  });

  it("disables derived vision even when one member has it", () => {
    const derived = aggregateComboCapabilities(["opencode-go/mimo-v2.5", "openai/gpt-5"]);
    expect(derived.vision).toBe(true);
    const out = overlayComboCapabilities(derived, { vision: false });
    expect(out.vision).toBe(false);
  });
});
