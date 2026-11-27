import { describe, expect, it, vi } from "vitest";
import { extractUsage, canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(), appendRequestLog: vi.fn(), saveRequestDetail: vi.fn(), trackPendingRequest: vi.fn(),
}));

const chat = { prompt_tokens: 100, completion_tokens: 5, cached_tokens: 20 };
const responses = { input_tokens: 100, output_tokens: 5, cached_tokens: 20 };
const paths = [
  ["nonstream Chat", (extra) => extractUsageFromResponse({ usage: { ...chat, ...extra } })],
  ["nonstream Responses", (extra) => extractUsageFromResponse({ usage: { ...responses, ...extra } })],
  ["bare Responses", (extra) => canonicalizeUsage(extractUsage({ usage: { ...responses, ...extra } }))],
  ...["response.completed", "response.done", "response.incomplete"].map((type) => [
    type, (extra) => canonicalizeUsage(extractUsage({ type, response: { usage: { ...responses, ...extra } } })),
  ]),
];

describe.each(paths)("provider creation alias extraction: %s", (_name, extract) => {
  it("retains the inclusive prompt and cache creation alias", () => {
    expect(extract({ cache_creation_tokens: 30 })).toEqual({
      prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
      cached_tokens: 20, cache_creation_input_tokens: 30,
    });
  });
  it.each([0, 7])("keeps canonical creation %s ahead of the alias", (value) => {
    expect(extract({ cache_creation_input_tokens: value, cache_creation_tokens: 30 })).toEqual({
      prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
      cached_tokens: 20, cache_creation_input_tokens: value,
    });
  });
  it.each([0, 7])("keeps cache_write_tokens %s ahead of the alias", (value) => {
    expect(extract({ cache_write_tokens: value, cache_creation_tokens: 30 })).toMatchObject({
      prompt_tokens: 100, completion_tokens: 5, cached_tokens: 20, cache_creation_input_tokens: value,
    });
  });
  it.each(_name.startsWith("nonstream") ? ["prompt_tokens_details", "input_tokens_details"] : ["input_tokens_details"])("retains nested creation in %s", (field) => {
    expect(extract({ [field]: { cache_creation_tokens: 30 } })).toEqual({
      prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
      cached_tokens: 20, cache_creation_input_tokens: 30,
    });
  });
  it.each([-1, Infinity, -Infinity, NaN, "30", "bad", {}, true, null, undefined])("rejects invalid alias %s", (value) => {
    expect(extract({ cache_creation_tokens: value })).toEqual({
      prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
      cached_tokens: 20, cache_creation_input_tokens: 0,
    });
  });
  it("accepts explicit alias zero", () => {
    expect(extract({ cache_creation_tokens: 0, input_tokens_details: { cache_creation_tokens: 30 } }))
      .toMatchObject({ prompt_tokens: 100, cache_creation_input_tokens: 0 });
  });
});

it.each(["response.completed", "response.done", "response.incomplete"])("keeps canonical Responses creation inclusive without reads: %s", (type) => {
  expect(canonicalizeUsage(extractUsage({ type, response: { usage: {
    input_tokens: 100, output_tokens: 5, cache_creation_input_tokens: 30,
  } } }))).toEqual({
    prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
    cached_tokens: 0, cache_creation_input_tokens: 30,
  });
});
