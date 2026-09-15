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

  it("downgrades a forced OpenAI tool choice, which Fable always rejects", () => {
    // Fable 5.1 is thinkingCanDisable:false — it reasons on every request, and
    // Anthropic refuses forced tool choice whenever thinking is on:
    //   tool_choice: type "tool" and "any" are not supported for this model.
    // This previously asserted {type:"tool"}, which is precisely the body that
    // produces that 400, so the translation was pinned to a broken shape.
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

    expect(translated.tool_choice).toEqual({ type: "auto" });
  });

  it("still converts a forced choice natively for a model that can stop thinking", () => {
    // The OpenAI → Claude tool_choice conversion itself is unchanged; only
    // models that cannot disable thinking get the downgrade.
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-sonnet-4-5",
      {
        max_tokens: 64,
        messages: [{ role: "user", content: "Record this." }],
        tools: [{ type: "function", function: { name: "record_summary", parameters: { type: "object", properties: {} } } }],
        tool_choice: { type: "function", function: { name: "record_summary" } },
      },
      false,
      null,
      "claude",
    );

    expect(translated.tool_choice).toEqual({ type: "tool", name: "record_summary" });
  });
});
