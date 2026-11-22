// Port of decolua/9router #4484: configurable client usage margin via USAGE_BUFFER_TOKENS.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BUFFER_TOKENS,
  getBufferTokens,
  addBufferToUsage,
} from "../../open-sse/utils/usageTracking.js";
import { GEMINI_INTERACTIONS_ID } from "../../open-sse/providers/registry/gemini-interactions.js";

const originalEnv = process.env.USAGE_BUFFER_TOKENS;

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.USAGE_BUFFER_TOKENS;
  } else {
    process.env.USAGE_BUFFER_TOKENS = originalEnv;
  }
  vi.restoreAllMocks();
});

describe("USAGE_BUFFER_TOKENS (#4484)", () => {
  it("defaults to 2000 when unset or blank", () => {
    delete process.env.USAGE_BUFFER_TOKENS;
    expect(DEFAULT_BUFFER_TOKENS).toBe(2000);
    expect(getBufferTokens()).toBe(2000);

    process.env.USAGE_BUFFER_TOKENS = "   ";
    expect(getBufferTokens()).toBe(2000);
  });

  it("parses non-negative integers including 0", () => {
    process.env.USAGE_BUFFER_TOKENS = "0";
    expect(getBufferTokens()).toBe(0);

    process.env.USAGE_BUFFER_TOKENS = " 500 ";
    expect(getBufferTokens()).toBe(500);
  });

  it("falls back to 2000 and warns once per invalid value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const bad of ["-1", "12.5", "abc", "1e3", "0x10", "200px"]) {
      process.env.USAGE_BUFFER_TOKENS = bad;
      expect(getBufferTokens()).toBe(2000);
    }
    const callsAfterFirstPass = warnSpy.mock.calls.length;
    expect(callsAfterFirstPass).toBe(6);

    // Repeating an already-warned invalid value should not spam logs.
    process.env.USAGE_BUFFER_TOKENS = "abc";
    expect(getBufferTokens()).toBe(2000);
    expect(warnSpy.mock.calls.length).toBe(callsAfterFirstPass);
  });

  it("applies USAGE_BUFFER_TOKENS to OpenAI and Claude usage shapes without mutating input", () => {
    process.env.USAGE_BUFFER_TOKENS = "0";
    const openaiUsage = { prompt_tokens: 120, completion_tokens: 30 };
    expect(addBufferToUsage(openaiUsage, "openai")).toEqual({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    });
    expect(openaiUsage).toEqual({ prompt_tokens: 120, completion_tokens: 30 });

    process.env.USAGE_BUFFER_TOKENS = "400";
    expect(addBufferToUsage({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }, "openai")).toEqual({
      prompt_tokens: 520,
      completion_tokens: 30,
      total_tokens: 550,
    });

    expect(addBufferToUsage({ input_tokens: 80, output_tokens: 20 }, "claude")).toEqual({
      input_tokens: 480,
      output_tokens: 20,
    });
  });

  it("keeps Gemini Interactions receipts unbuffered regardless of USAGE_BUFFER_TOKENS", () => {
    process.env.USAGE_BUFFER_TOKENS = "500";
    const usage = { input_tokens: 100, output_tokens: 25 };
    expect(addBufferToUsage(usage, GEMINI_INTERACTIONS_ID)).toBe(usage);
  });
});
