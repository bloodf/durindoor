import { describe, expect, it } from "vitest";
import {
  attachTokensPerSecond,
  generationDurationMs,
  tokensPerSecond,
} from "../../open-sse/utils/generationThroughput.js";
import { filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("generationThroughput (port of OmniRoute #12631)", () => {
  it("computes tok/s excluding TTFT (200 tokens over 2s generation after 3s TTFT)", () => {
    const generationMs = generationDurationMs(5000, 3000);
    expect(generationMs).toBe(2000);
    expect(tokensPerSecond(200, generationMs)).toBe(100);
  });

  it("omits tok/s when TTFT is unknown (never uses tokens/total_latency)", () => {
    expect(generationDurationMs(5000, null)).toBeNull();
    expect(tokensPerSecond(200, null)).toBeNull();
    const usage = attachTokensPerSecond({ prompt_tokens: 10, completion_tokens: 200 }, null);
    expect(usage.tokens_per_second).toBeUndefined();
  });

  it("omits tok/s when generation duration is not positive", () => {
    expect(generationDurationMs(3000, 3000)).toBeNull();
    expect(generationDurationMs(2000, 3000)).toBeNull();
    expect(tokensPerSecond(0, 2000)).toBeNull();
  });

  it("omits tok/s when there are no output tokens", () => {
    const usage = attachTokensPerSecond({ prompt_tokens: 10, completion_tokens: 0 }, 2000);
    expect(usage.tokens_per_second).toBeUndefined();
  });

  it("attachTokensPerSecond is a no-op on non-object usage", () => {
    expect(attachTokensPerSecond(null, 2000)).toBeNull();
    expect(attachTokensPerSecond(undefined, 2000)).toBeUndefined();
    expect(attachTokensPerSecond([1, 2], 2000)).toEqual([1, 2]);
  });

  it("filterUsageForFormat keeps tokens_per_second for OpenAI, Claude, Gemini", () => {
    const openai = filterUsageForFormat(
      { prompt_tokens: 10, completion_tokens: 20, tokens_per_second: 42.5 },
      FORMATS.OPENAI
    );
    const claude = filterUsageForFormat(
      { input_tokens: 10, output_tokens: 20, tokens_per_second: 42.5 },
      FORMATS.CLAUDE
    );
    const gemini = filterUsageForFormat(
      { promptTokenCount: 10, candidatesTokenCount: 20, tokens_per_second: 42.5 },
      FORMATS.GEMINI
    );
    expect(openai.tokens_per_second).toBe(42.5);
    expect(claude.tokens_per_second).toBe(42.5);
    expect(gemini.tokens_per_second).toBe(42.5);
  });
});
