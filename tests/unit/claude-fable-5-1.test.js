import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Claude Fable 5.1 public contract", () => {
  it("resolves its exact public price through the pricing resolver", () => {
    expect(getPricingForModel("claude", "claude-fable-5-1")).toMatchObject({
      input: 10,
      output: 50,
      cached: 0.25,
      cache_creation: 12.5,
    });
  });

  it("converts a forced OpenAI tool choice to its Claude-native equivalent", () => {
    const toolChoice = { type: "function", function: { name: "record_summary" } };
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-fable-5-1",
      {
        max_tokens: 64,
        messages: [{ role: "user", content: "Record this." }],
        tools: [{ type: "function", function: { name: "record_summary", parameters: { type: "object", properties: {} } } }],
        tool_choice: toolChoice,
      },
      false,
      null,
      "claude",
    );

    expect(translated.tool_choice).toEqual({ type: "tool", name: "record_summary" });
  });
});
