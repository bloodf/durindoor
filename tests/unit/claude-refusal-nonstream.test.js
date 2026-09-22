// A refusal from the Anthropic API in a non-streaming JSON body (stop_reason
// "refusal", zero content blocks) must reach an OpenAI-format client as
// finish_reason "content_filter" carrying Anthropic's explanation, not as a
// clean "stop" with an empty message that the empty-content 502 guard rejects.
import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const EXPLANATION =
  "This request was blocked as it seems to violate Anthropic's Terms of Service restrictions on reverse engineering or duplicating model outputs.";

describe("nonStreamingHandler: Claude refusal JSON -> OpenAI", () => {
  it("maps stop_reason refusal to finish_reason content_filter", () => {
    const out = translateNonStreamingResponse(
      {
        id: "msg_refusal",
        model: "claude-opus-5",
        role: "assistant",
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", explanation: EXPLANATION },
        usage: { input_tokens: 637, output_tokens: 0 }
      },
      FORMATS.CLAUDE,
      FORMATS.OPENAI
    );
    expect(out.choices[0].finish_reason).toBe("content_filter");
    expect(out.choices[0].message.content).toBe(EXPLANATION);
  });

  it("still emits empty string content when there is no explanation", () => {
    const out = translateNonStreamingResponse(
      {
        id: "msg_empty",
        model: "claude-opus-5",
        role: "assistant",
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 0 }
      },
      FORMATS.CLAUDE,
      FORMATS.OPENAI
    );
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.choices[0].message.content).toBe("");
  });
});
