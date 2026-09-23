import { describe, expect, it } from "vitest";
import { isModelExposureAllowed, filterExposedModels } from "../../src/shared/utils/modelExposureList.js";

describe("isModelExposureAllowed", () => {
  it("allows everything when both lists are empty or missing", () => {
    expect(isModelExposureAllowed("openai", "gpt-5", null)).toBe(true);
    expect(isModelExposureAllowed("openai", "gpt-5", {})).toBe(true);
  });

  it("denies an exact bare-id denylist match", () => {
    const settings = { modelVisibilityDenylist: ["gpt-5"] };
    expect(isModelExposureAllowed("openai", "gpt-5", settings)).toBe(false);
  });

  it("denies an exact provider/model denylist match", () => {
    const settings = { modelVisibilityDenylist: ["openai/gpt-5"] };
    expect(isModelExposureAllowed("openai", "gpt-5", settings)).toBe(false);
    expect(isModelExposureAllowed("anthropic", "gpt-5", settings)).toBe(true);
  });

  it("denies a glob denylist match", () => {
    const settings = { modelVisibilityDenylist: ["openai/*-preview"] };
    expect(isModelExposureAllowed("openai", "gpt-5-preview", settings)).toBe(false);
    expect(isModelExposureAllowed("openai", "gpt-5", settings)).toBe(true);
  });

  it("restricts to a non-empty allowlist", () => {
    const settings = { modelVisibilityAllowlist: ["anthropic/*"] };
    expect(isModelExposureAllowed("anthropic", "claude-5", settings)).toBe(true);
    expect(isModelExposureAllowed("openai", "gpt-5", settings)).toBe(false);
  });

  it("denylist wins over an overlapping allowlist entry", () => {
    const settings = { modelVisibilityAllowlist: ["openai/*"], modelVisibilityDenylist: ["openai/gpt-5"] };
    expect(isModelExposureAllowed("openai", "gpt-5", settings)).toBe(false);
    expect(isModelExposureAllowed("openai", "gpt-6", settings)).toBe(true);
  });

  it("ignores non-array / malformed list values", () => {
    const settings = { modelVisibilityDenylist: "not-an-array", modelVisibilityAllowlist: [42, null, "  "] };
    expect(isModelExposureAllowed("openai", "gpt-5", settings)).toBe(true);
  });
});

describe("filterExposedModels", () => {
  it("returns the input unchanged when no lists are set", () => {
    const models = ["openai/gpt-5", "anthropic/claude-5"];
    expect(filterExposedModels(models, null)).toBe(models);
  });

  it("filters a list of provider/model strings", () => {
    const models = ["openai/gpt-5", "anthropic/claude-5", "openai/gpt-5-preview"];
    const settings = { modelVisibilityDenylist: ["*-preview"] };
    expect(filterExposedModels(models, settings)).toEqual(["openai/gpt-5", "anthropic/claude-5"]);
  });

  it("leaves an unparseable (no-slash) entry visible", () => {
    const models = ["bare-combo-name", "openai/gpt-5"];
    const settings = { modelVisibilityAllowlist: ["openai/*"] };
    expect(filterExposedModels(models, settings)).toEqual(["bare-combo-name", "openai/gpt-5"]);
  });
});
