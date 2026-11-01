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

describe("#1389 Responses → Gemini parity", () => {
  const call = (extra) => ({ type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "lookup", ...extra });

  it("carries call_id into functionCall.id and always emits object args", () => {
    for (const [args, expected] of [["{\"q\":1}", { q: 1 }], ["null", {}], ["[1]", {}], ["7", {}], ["{bad", {}]]) {
      const fc = project({ id: "r", status: "completed", output: [call({ arguments: args })] })
        .candidates[0].content.parts[0].functionCall;
      expect(fc).toEqual({ id: "c1", name: "lookup", args: expected });
    }
  });

  it("maps reasoning tokens to thoughtsTokenCount and keeps total", () => {
    const out = project({
      id: "r", status: "completed", output: [],
      usage: { input_tokens: 10, output_tokens: 9, total_tokens: 19, output_tokens_details: { reasoning_tokens: 6 } },
    });
    expect(out.usageMetadata).toEqual({
      promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 19, thoughtsTokenCount: 6,
    });
  });

  it("emits explicit zero cachedContentTokenCount and zero usage", () => {
    const out = project({
      id: "r", status: "completed", output: [],
      usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6, input_tokens_details: { cached_tokens: 0 } },
    });
    expect(out.usageMetadata.cachedContentTokenCount).toBe(0);
    expect(project({ id: "r", status: "completed", output: [] }).usageMetadata).toEqual({
      promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0,
    });
  });

  it("treats incomplete content_filter as a refusal in Gemini, OpenAI and Claude", () => {
    const body = { id: "r", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] };
    expect(project(body).candidates[0].finishReason).toBe(GEMINI_FINISH.SAFETY);
    expect(translateNonStreamingResponse(structuredClone(body), responses, FORMATS.OPENAI).choices[0].finish_reason).toBe("content_filter");
    expect(translateNonStreamingResponse(structuredClone(body), responses, FORMATS.CLAUDE).stop_reason).toBe("refusal");
  });
});

describe("#1389 stream Gemini functionCall.id", () => {
  it("carries the tool call id into the emitted functionCall", async () => {
    const { openaiToAntigravityResponse } = await import("../../open-sse/translator/response/openai-to-antigravity.js");
    const state = {};
    openaiToAntigravityResponse({ id: "r", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":1}" } }] } }] }, state);
    const out = openaiToAntigravityResponse({ id: "r", choices: [{ delta: {}, finish_reason: "tool_calls" }] }, state);
    const fc = (out.response ?? out).candidates[0].content.parts[0].functionCall;
    expect(fc).toEqual({ id: "call_1", name: "lookup", args: { q: 1 } });
  });
});
