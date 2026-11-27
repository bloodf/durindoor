import { describe, expect, it } from "vitest";
import { normalizeLedgerTokens } from "@/lib/db/helpers/ledgerTokens.js";

const COUNT_ERROR = "Usage token counts must be finite nonnegative numbers";
const TOTAL_ERROR = "Usage total_tokens must equal input and output components";

describe("normalizeLedgerTokens", () => {
  it("defaults an empty or missing usage object to zero components", () => {
    const zero = {
      prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
      cached_tokens: 0, reasoning_tokens: 0, cache_creation_input_tokens: 0,
    };
    expect(normalizeLedgerTokens()).toEqual(zero);
    expect(normalizeLedgerTokens({})).toEqual(zero);
  });

  it("maps OpenAI, Responses/Anthropic and Gemini aliases to one shape", () => {
    const expected = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 };
    expect(normalizeLedgerTokens({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }))
      .toMatchObject(expected);
    expect(normalizeLedgerTokens({ input_tokens: 10, output_tokens: 4 })).toMatchObject(expected);
    expect(normalizeLedgerTokens({ promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 }))
      .toMatchObject(expected);
  });

  it("prefers the first non-null alias and ignores null placeholders", () => {
    const out = normalizeLedgerTokens({ prompt_tokens: null, input_tokens: 7, completion_tokens: 2, output_tokens: 9 });
    expect(out).toMatchObject({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 });
  });

  it("reads cached, reasoning and cache-creation counts from nested details", () => {
    expect(normalizeLedgerTokens({
      input_tokens: 20, output_tokens: 5,
      input_tokens_details: { cached_tokens: 6, cache_creation_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
    })).toMatchObject({ cached_tokens: 6, cache_creation_input_tokens: 3, reasoning_tokens: 2 });
    expect(normalizeLedgerTokens({
      prompt_tokens: 20, completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 4, cache_creation_tokens: 1 },
      completion_tokens_details: { reasoning_tokens: 3 },
    })).toMatchObject({ cached_tokens: 4, cache_creation_input_tokens: 1, reasoning_tokens: 3 });
    expect(normalizeLedgerTokens({ cache_read_input_tokens: 8, thoughtsTokenCount: 5 }))
      .toMatchObject({ cached_tokens: 8, reasoning_tokens: 5 });
  });

  it("rounds fractional estimates up, including the supplied total", () => {
    expect(normalizeLedgerTokens({ prompt_tokens: 1.2, completion_tokens: 2.01, cached_tokens: 0.5, total_tokens: 4.1 }))
      .toMatchObject({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cached_tokens: 1 });
  });

  it("keeps the 1h cache-creation field only when positive", () => {
    expect(normalizeLedgerTokens({ cache_creation_1h_input_tokens: 2.5 }).cache_creation_1h_input_tokens).toBe(3);
    expect(normalizeLedgerTokens({ cache_creation_1h_input_tokens: 0 })).not.toHaveProperty("cache_creation_1h_input_tokens");
  });

  it("passes through own cost and credit fields untouched and drops unknown keys", () => {
    const out = normalizeLedgerTokens({
      prompt_tokens: 1, cost_usd: 0.25, cost_in_usd_ticks: 7, kiro_credits: 1.5, kiro_credit_unit: "credit",
      estimated: true, unrelated: "x",
    });
    expect(out).toMatchObject({ cost_usd: 0.25, cost_in_usd_ticks: 7, kiro_credits: 1.5, kiro_credit_unit: "credit", estimated: true });
    expect(out).not.toHaveProperty("unrelated");
    expect(out).not.toHaveProperty("cost_in_usd");
    expect(normalizeLedgerTokens(Object.create({ cost_usd: 9 }))).not.toHaveProperty("cost_usd");
  });

  it("rejects totals that disagree with input plus output", () => {
    expect(() => normalizeLedgerTokens({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 15 })).toThrow(TOTAL_ERROR);
    expect(() => normalizeLedgerTokens({ total_tokens: 3 })).toThrow(TOTAL_ERROR);
    expect(() => normalizeLedgerTokens({ promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 1 })).toThrow(TypeError);
  });

  it("rejects a sum that is no longer a safe integer", () => {
    expect(() => normalizeLedgerTokens({ prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 })).toThrow(TOTAL_ERROR);
  });

  it.each([
    ["negative", { prompt_tokens: -1 }],
    ["NaN", { completion_tokens: Number.NaN }],
    ["Infinity", { total_tokens: Infinity }],
    ["numeric string", { prompt_tokens: "5" }],
    ["boxed number", { prompt_tokens: new Number(5) }],
    ["unsafe integer", { cached_tokens: 2 ** 60 }],
    ["invalid shadowed alias", { prompt_tokens: 3, input_tokens: -2 }],
    ["invalid 1h creation", { cache_creation_1h_input_tokens: "1" }],
  ])("rejects %s counts", (_label, tokens) => {
    expect(() => normalizeLedgerTokens(tokens)).toThrow(new TypeError(COUNT_ERROR));
  });
});
