import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("Anthropic and Claude Code model catalogs", () => {
  it("exposes Claude Opus 5 and keeps legacy Claude entries", () => {
    const ccIds = (PROVIDER_MODELS.cc || []).map((model) => model.id);
    const anthropicIds = (PROVIDER_MODELS.anthropic || []).map((model) => model.id);

    expect(ccIds).toContain("claude-opus-5");
    expect(ccIds).toContain("claude-opus-4-8");
    expect(ccIds).toContain("claude-opus-4-7");

    expect(anthropicIds).toEqual(expect.arrayContaining([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
    ]));
  });
});
