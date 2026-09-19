import { describe, it, expect } from "vitest";
import {
  extractUsage,
  enrichUsageCost,
  filterUsageForFormat,
} from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("extractUsage - provider-reported cost (upstream #4074)", () => {
  it("preserves OpenRouter's bare usage.cost as cost_usd", () => {
    const usage = extractUsage({
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0042 },
    });
    expect(usage.cost_usd).toBe(0.0042);
  });

  it("leaves cost_usd unset when the provider sends no cost", () => {
    const usage = extractUsage({
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    expect(usage.cost_usd).toBeUndefined();
  });
});

describe("enrichUsageCost", () => {
  it("is a no-op when cost_usd is already present", () => {
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 0, cost_usd: 0.0009 };
    const out = enrichUsageCost(usage, "openrouter", "z-ai/glm-5.3-flash");
    expect(out.cost_usd).toBe(0.0009);
  });

  it("estimates cost_usd from MODEL_PRICING when the provider omits it", () => {
    const out = enrichUsageCost(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      "openrouter",
      "glm-4.7-flashx"
    );
    // glm-4.7-flashx input rate is $0.07 / 1M tokens.
    expect(out.cost_usd).toBeCloseTo(0.07, 6);
  });

  it("returns the usage unchanged when no pricing entry matches", () => {
    const usage = { prompt_tokens: 10, completion_tokens: 5 };
    const out = enrichUsageCost(usage, "unknown-provider", "totally-unknown-model-xyz");
    expect(out).toBe(usage);
  });

  it("passes non-object usage through untouched", () => {
    expect(enrichUsageCost(null, "openrouter", "glm-4.7")).toBeNull();
  });
});

describe("cost_usd survives the client-facing filter", () => {
  it("keeps cost_usd for OpenAI-shaped usage", () => {
    const out = filterUsageForFormat(
      { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost_usd: 0.001 },
      FORMATS.OPENAI
    );
    expect(out.cost_usd).toBe(0.001);
    expect(out.prompt_tokens).toBe(10);
  });

  it("keeps cost_usd for Claude-shaped usage", () => {
    const out = filterUsageForFormat(
      { input_tokens: 10, output_tokens: 2, cost_usd: 0.001 },
      FORMATS.CLAUDE
    );
    expect(out.cost_usd).toBe(0.001);
  });
});
