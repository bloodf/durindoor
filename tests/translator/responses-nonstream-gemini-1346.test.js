import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openAIResponsesBodyToGemini } from "../../open-sse/translator/response/openai-responses-nonstream.js";
import {
  GEMINI_FINISH,
  GEMINI_ROLE,
  RESPONSES_ITEM,
} from "../../open-sse/translator/schema/index.js";

const responses = FORMATS.OPENAI_RESPONSES;
const gemini = FORMATS.GEMINI;

/** Responses upstream body → Gemini client via the non-stream handler. */
const project = (body) =>
  translateNonStreamingResponse(structuredClone(body), responses, gemini);

describe("#1346 Responses non-stream → Gemini projection", () => {
  it("projects text output into a Gemini candidate part", () => {
    const out = project({
      id: "resp_text",
      model: "gpt-test",
      status: "completed",
      output: [{
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "hello gemini" }],
      }],
    });

    expect(out).not.toHaveProperty("status");
    expect(out).not.toHaveProperty("response");
    expect(out.candidates[0]).toMatchObject({
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "hello gemini" }] },
      finishReason: GEMINI_FINISH.STOP,
    });
    expect(openAIResponsesBodyToGemini({
      id: "resp_text",
      status: "completed",
      output: [{
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "hello gemini" }],
      }],
    }).candidates[0].content.parts[0].text).toBe("hello gemini");
  });

  it("projects function_call items into Gemini functionCall parts", () => {
    const out = project({
      id: "resp_tool",
      status: "completed",
      output: [{
        type: RESPONSES_ITEM.FUNCTION_CALL,
        call_id: "c1",
        name: "lookup",
        arguments: "{\"q\":\"a\"}",
      }],
    });

    expect(out.candidates[0].content.parts[0].functionCall).toMatchObject({
      name: "lookup",
      args: { q: "a" },
    });
    expect(out.candidates[0].finishReason).toBe(GEMINI_FINISH.STOP);
  });

  it("maps Responses usage onto Gemini usageMetadata", () => {
    const out = project({
      id: "resp_usage",
      status: "completed",
      output: [{
        type: RESPONSES_ITEM.MESSAGE,
        content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "ok" }],
      }],
      usage: {
        input_tokens: 11,
        output_tokens: 4,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 3 },
      },
    });

    expect(out.usageMetadata).toMatchObject({
      promptTokenCount: 11,
      candidatesTokenCount: 4,
      totalTokenCount: 15,
      cachedContentTokenCount: 3,
    });
  });

  it("maps incomplete max_output_tokens to MAX_TOKENS and keeps the tool call", () => {
    const out = project({
      id: "r",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{
        type: RESPONSES_ITEM.FUNCTION_CALL,
        call_id: "c1",
        name: "lookup",
        arguments: "{\"q\":\"a\"}",
      }],
    });

    expect(out).not.toHaveProperty("status");
    expect(out.candidates[0].finishReason).toBe(GEMINI_FINISH.MAX_TOKENS);
    expect(out.candidates[0].content.parts[0].functionCall).toMatchObject({
      name: "lookup",
      args: { q: "a" },
    });
  });
});
