import { describe, it, expect } from "vitest";
import {
  extractUsage,
  normalizeUsage,
  canonicalizeUsage,
  enrichUsageCost,
  addBufferToUsage,
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

describe("USD receipt normalization", () => {
  it.each([null, false, true, "", "0.25", [], {}, -1, Infinity].map((receipt) => ({ receipt })))("does not invent provider USD from $receipt", ({ receipt }) => {
    for (const field of ["cost_usd", "cost_in_usd", "cost_in_usd_ticks"]) {
      const usage = { prompt_tokens: 10, completion_tokens: 2, [field]: receipt };
      expect(normalizeUsage(usage)[field]).toBeUndefined();
      expect(canonicalizeUsage(usage)[field]).toBeUndefined();
    }
    expect(extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, cost: receipt } }).cost_usd).toBeUndefined();
  });

  it("preserves authoritative numeric zero and tick receipts through normalization", () => {
    const usage = { prompt_tokens: 10, completion_tokens: 2, cost_usd: 0, cost_in_usd_ticks: 250000000000 };
    expect(canonicalizeUsage(normalizeUsage(usage))).toMatchObject({ cost_usd: 0, cost_in_usd_ticks: 250000000000 });
    expect(enrichUsageCost({ prompt_tokens: 1000000, cost_in_usd_ticks: 250000000000 }, "openrouter", "glm-4.7-flashx").cost_usd).toBeUndefined();
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


describe("client cost estimate provenance", () => {
  it("labels a synthesized builtin cost and retains the label through each usage format", () => {
    const usage = { prompt_tokens: 1000000, completion_tokens: 1000000 };
    const estimated = enrichUsageCost(usage, "openai", "gpt-5.4");
    expect(estimated.cost_usd).toBe(17.5);
    expect(estimated.cost_details).toMatchObject({ status: "estimated", source: "builtin", basis: "response_token_counts", unit: "USD_per_million_tokens", rates: { input: 2.5, output: 15 } });
    for (const format of [FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE]) {
      expect(filterUsageForFormat(estimated, format).cost_details).toEqual(estimated.cost_details);
    }
    expect(usage).not.toHaveProperty("cost_details");
  });

  it("describes the buffered response basis without mutating raw accounting counts", () => {
    const raw = { prompt_tokens: 100, completion_tokens: 10 };
    const buffered = addBufferToUsage(raw);
    const estimated = enrichUsageCost(buffered, "openai", "gpt-5.4");
    expect(buffered.prompt_tokens).toBeGreaterThan(raw.prompt_tokens);
    expect(estimated.cost_usd).toBeCloseTo((buffered.prompt_tokens * 2.5 + 10 * 15) / 1e6, 12);
    expect(estimated.cost_details.basis).toBe("response_token_counts");
    expect(raw).toEqual({ prompt_tokens: 100, completion_tokens: 10 });
    const ticks = { ...buffered, cost_in_usd_ticks: 250000000000 };
    expect(enrichUsageCost(ticks, "openai", "gpt-5.4")).toBe(ticks);
    expect(ticks).not.toHaveProperty("cost_details");
  });

  it("keeps receipts authoritative and distinguishes a configured builtin zero estimate", () => {
    const receipt = { prompt_tokens: 1000000, cost_usd: 0 };
    expect(enrichUsageCost(receipt, "openai", "gpt-5.4")).toBe(receipt);
    expect(receipt).not.toHaveProperty("cost_details");
    const free = enrichUsageCost({ prompt_tokens: 10 }, "openai", "glm-4.7-flash");
    expect(free).toMatchObject({ cost_usd: 0, cost_details: { status: "estimated", source: "builtin" } });
  });
});
