// Port of decolua/9router #5094: a non-streaming Gemini body must map finishReason
// with the same table as the streaming translator (MAX_TOKENS → length, SAFETY →
// content_filter), and the client projections must inherit it.
import { describe, expect, it } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const gemini = (finishReason) => ({
  candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
});

describe("Gemini non-stream finishReason mapping (#5094)", () => {
  it.each([
    ["STOP", "stop"],
    ["MAX_TOKENS", "length"],
    ["SAFETY", "content_filter"],
  ])("%s → OpenAI finish_reason %s", (reason, expected) => {
    const out = translateNonStreamingResponse(gemini(reason), FORMATS.GEMINI, FORMATS.OPENAI);
    expect(out.choices[0].finish_reason).toBe(expected);
  });

  it("functionCall with STOP stays tool_calls", () => {
    const body = gemini("STOP");
    body.candidates[0].content.parts = [{ functionCall: { name: "f", args: {} } }];
    expect(translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI).choices[0].finish_reason).toBe("tool_calls");
  });

  it("Responses client: MAX_TOKENS yields an incomplete status, not a raw Gemini reason", () => {
    const out = translateNonStreamingResponse(gemini("MAX_TOKENS"), FORMATS.GEMINI, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out.status).not.toBe("max_tokens");
  });
});
