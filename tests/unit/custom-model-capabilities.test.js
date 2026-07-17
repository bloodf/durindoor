import { describe, it, expect } from "vitest";
import { buildCustomCapabilities } from "../../src/app/(dashboard)/dashboard/providers/[id]/customModelCapabilities.js";
import { normalizeCustomCapabilities } from "../../src/lib/db/repos/aliasRepo.js";

describe("buildCustomCapabilities", () => {
  it("emits null for cleared advanced fields", () => {
    const out = buildCustomCapabilities({
      booleanCaps: {},
      contextWindow: "",
      maxOutput: "",
      thinkingFormat: "",
      thinkingCanDisable: false,
      thinkingRangeMin: "",
      thinkingRangeMax: "",
    });
    expect(out.contextWindow).toBeNull();
    expect(out.maxOutput).toBeNull();
    expect(out.thinkingFormat).toBeNull();
    expect(out.thinkingRange).toBeNull();
    expect(out.thinkingCanDisable).toBe(false);
  });

  it("preserves explicit false boolean overrides", () => {
    const out = buildCustomCapabilities({
      booleanCaps: { vision: false, tools: false },
      contextWindow: "",
      maxOutput: "",
      thinkingFormat: "",
      thinkingCanDisable: false,
      thinkingRangeMin: "",
      thinkingRangeMax: "",
    });
    expect(out.vision).toBe(false);
    expect(out.tools).toBe(false);
    expect(out.thinkingCanDisable).toBe(false);
  });

  it("preserves explicit 0 inputs so normalize can reject them", () => {
    const out = buildCustomCapabilities({
      booleanCaps: {},
      contextWindow: "0",
      maxOutput: "0",
      thinkingFormat: "",
      thinkingCanDisable: false,
      thinkingRangeMin: "",
      thinkingRangeMax: "",
    });
    expect(out.contextWindow).toBe(0);
    expect(out.maxOutput).toBe(0);
    const norm = normalizeCustomCapabilities(out);
    expect(norm.ok).toBe(false);
  });
});

describe("normalizeCustomCapabilities", () => {
  it("accepts null as a deletion sentinel for advanced fields", () => {
    const norm = normalizeCustomCapabilities({
      contextWindow: null,
      maxOutput: null,
      thinkingFormat: null,
      thinkingRange: null,
    });
    expect(norm.ok).toBe(true);
    expect(norm.caps).toEqual({
      contextWindow: null,
      maxOutput: null,
      thinkingFormat: null,
      thinkingRange: null,
    });
  });

  it("rejects contextWindow 0", () => {
    const norm = normalizeCustomCapabilities({ contextWindow: 0 });
    expect(norm.ok).toBe(false);
    expect(norm.error).toMatch(/contextWindow must be a positive integer/);
  });

  it("preserves explicit false boolean overrides", () => {
    const norm = normalizeCustomCapabilities({ thinkingCanDisable: false });
    expect(norm.ok).toBe(true);
    expect(norm.caps).toEqual({ thinkingCanDisable: false });
  });
});

describe("custom model round trip", () => {
  it("PATCH deletes cleared fields and preserves false overrides", () => {
    const existing = { vision: true, tools: true, contextWindow: 128000, maxOutput: 8192 };
    const patch = normalizeCustomCapabilities({
      vision: false,
      contextWindow: null,
      tools: false,
    });
    expect(patch.ok).toBe(true);

    const merged = { ...existing };
    for (const key of Object.keys(patch.caps)) {
      const val = patch.caps[key];
      if (val === null) delete merged[key];
      else merged[key] = val;
    }

    expect(merged).toEqual({
      vision: false,
      tools: false,
      maxOutput: 8192,
    });
    expect(merged.contextWindow).toBeUndefined();
  });
});
