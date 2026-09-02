import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";

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
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
    ]));
  });
});
