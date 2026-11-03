import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("Anthropic and Claude Code model catalogs", () => {
  it("exposes Claude Fable 5.1 while retaining Fable 5 and Opus 5", () => {
    const ccIds = (PROVIDER_MODELS.cc || []).map((model) => model.id);
    const anthropicIds = (PROVIDER_MODELS.anthropic || []).map((model) => model.id);

    expect(ccIds).toEqual(expect.arrayContaining([
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5",
    ]));
    expect(ccIds).not.toContain("claude-opus-5-1");
    expect(ccIds).toEqual(expect.arrayContaining(["claude-opus-4-8", "claude-opus-4-7"]));
    expect(anthropicIds).toEqual(expect.arrayContaining([
      "claude-fable-5-1",
      "claude-mythos-5-1",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]));
    expect(ccIds).toContain("claude-sonnet-5-5");
    expect(ccIds).toContain("claude-haiku-5-5");
    expect(anthropicIds).toContain("claude-haiku-5-5");
    expect(ccIds).toContain("claude-haiku-4-5-20251001");
    expect(anthropicIds).toContain("claude-haiku-4-5");
    // Retired on the Claude API (model-deprecations page, 2026-09-29).
    expect(anthropicIds).not.toContain("claude-opus-4-20250514");
    expect(anthropicIds).not.toContain("claude-sonnet-4-20250514");
    expect(anthropicIds).not.toContain("claude-3-5-sonnet-20241022");
  });

  it("resolves Haiku 5.5 as an adaptive 1M-context model on both catalogs", () => {
    for (const provider of ["anthropic", "cc"]) {
      expect(getCapabilitiesForModel(provider, "claude-haiku-5-5")).toMatchObject({
        thinkingFormat: "claude-adaptive",
        vision: true,
        reasoning: true,
        contextWindow: 1000000,
        maxOutput: 128000,
      });
    }
  });
});
