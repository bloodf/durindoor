import { describe, expect, it } from "vitest";
import { getCacheCreationTokens } from "@/app/(dashboard)/dashboard/usage/components/tokenDisplay.js";

describe("OmniRoute #21107 request-detail cache-write counts", () => {
  it.each([
    ["flat count", { cache_creation_input_tokens: 17 }, 17],
    ["nested Chat count", { prompt_tokens_details: { cache_creation_tokens: 17 } }, 17],
    ["nested Responses count", { input_tokens_details: { cache_creation_tokens: 17 } }, 17],
    ["explicit flat zero ahead of a nested count", { cache_creation_input_tokens: 0, prompt_tokens_details: { cache_creation_tokens: 17 } }, 0],
    ["flat count ahead of a nested count", { cache_creation_input_tokens: 23, prompt_tokens_details: { cache_creation_tokens: 17 } }, 23],
    ["no reported count", { prompt_tokens: 5 }, 0],
    ["no tokens", undefined, 0],
  ])("reads the %s", (_name, tokens, expected) => {
    expect(getCacheCreationTokens(tokens)).toBe(expected);
  });
});
