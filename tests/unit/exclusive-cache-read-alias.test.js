import { describe, expect, it } from "vitest";
import { canonicalizeUsage, normalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

const exclusive = { prompt_tokens: 100, completion_tokens: 5, cache_read_input_tokens: 20 };
const paths = [
  ["canonical", (usage) => canonicalizeUsage(usage)],
  ["nonstream", (usage) => extractUsageFromResponse({ usage })],
  ["normalized", (usage) => canonicalizeUsage(normalizeUsage(usage))],
];

describe.each(paths)("exclusive alias: %s", (_name, read) => {
  it.each([undefined, null])("resolves absent canonical creation %s", (canonical) => {
    expect(read({ ...exclusive, cache_creation_input_tokens: canonical, cache_creation_tokens: 30 })).toEqual({
      prompt_tokens: 150, completion_tokens: 5, total_tokens: 155, cached_tokens: 20, cache_creation_input_tokens: 30,
    });
  });
  it.each([0, 7])("preserves canonical precedence %s", (canonical) => {
    expect(read({ ...exclusive, cache_creation_input_tokens: canonical, cache_creation_tokens: 30 })).toEqual({
      prompt_tokens: canonical === 0 ? 120 : 127, completion_tokens: 5, total_tokens: canonical === 0 ? 125 : 132,
      cached_tokens: 20, cache_creation_input_tokens: canonical,
    });
  });
  it("preserves alias zero ahead of nested creation", () => {
    expect(read({ ...exclusive, cache_creation_tokens: 0, prompt_tokens_details: { cache_creation_tokens: 30 } })).toEqual({
      prompt_tokens: 120, completion_tokens: 5, total_tokens: 125, cached_tokens: 20, cache_creation_input_tokens: 0,
    });
  });
  it.each([-1, Infinity, NaN, "30", true, {}])("rejects malformed alias %s", (alias) => {
    expect(read({ ...exclusive, cache_creation_tokens: alias })).toEqual({
      prompt_tokens: 120, completion_tokens: 5, total_tokens: 125, cached_tokens: 20, cache_creation_input_tokens: 0,
    });
  });
  it("folds exclusive counters and replaces stale total", () => {
    expect(read({ ...exclusive, cache_creation_input_tokens: 30, total_tokens: 105 })).toEqual({
      prompt_tokens: 150, completion_tokens: 5, total_tokens: 155, cached_tokens: 20, cache_creation_input_tokens: 30,
    });
  });
});

it("keeps OpenAI chunks inclusive when their flat read is converted to cache details", () => {
  expect(canonicalizeUsage(extractUsage({ usage: { ...exclusive, cache_creation_input_tokens: null, cache_creation_tokens: 30 } }))).toEqual({
    prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, cached_tokens: 20, cache_creation_input_tokens: 30,
  });
});

it.each(["response.completed", "response.done", "response.incomplete"])("keeps Responses inclusive: %s", (type) => {
  expect(canonicalizeUsage(extractUsage({ type, response: { usage: {
    input_tokens: 100, output_tokens: 5, total_tokens: 110, input_tokens_details: { cached_tokens: 20 }, cache_creation_tokens: 30,
  } } }))).toEqual({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 110, cached_tokens: 20, cache_creation_input_tokens: 30 });
});

// Native Anthropic input excludes both cache counters; its stream receipt
// is normalized before canonical storage, while OpenAI details are inclusive.
it.each(["canonical", "nonstream", "message_start"])("folds native Anthropic cache counters: %s", (path) => {
  const usage = { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 };
  const result = path === "canonical" ? canonicalizeUsage(usage)
    : path === "nonstream" ? extractUsageFromResponse({ usage })
      : canonicalizeUsage(extractUsage({ type: "message_start", message: { usage } }));
  expect(result).toEqual({ prompt_tokens: 150, completion_tokens: 5, total_tokens: 155, cached_tokens: 20, cache_creation_input_tokens: 30 });
});

it("keeps direct OpenAI details inclusive and preserves an authoritative total", () => {
  expect(canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 20 }, cache_creation_input_tokens: null, cache_creation_tokens: 30,
  })).toEqual({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 110, cached_tokens: 20, cache_creation_input_tokens: 30 });
});
