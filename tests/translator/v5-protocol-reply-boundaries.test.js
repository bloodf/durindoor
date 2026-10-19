import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { GEMINI_FINISH, GEMINI_ROLE, OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

// Issue #1089: parent reproduced N1; post-repair verification remains parent-owned.
describe("v5 registered reply boundaries", () => {
  it("emits one length terminal with cached usage for an incomplete Responses reply", () => {
    const state = initState(FORMATS.OPENAI);
    const terminal = {
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 4 } },
      },
    };
    const result = translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, terminal, state);
    expect(result).toHaveLength(1);
    expect(result[0].choices[0].finish_reason).toBe(OPENAI_FINISH.LENGTH);
    expect(result[0].usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } });
    expect(translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, terminal, state)).toEqual([]);
  });

  it("projects a Chat non-stream reply into the Gemini client envelope", () => {
    const result = translateNonStreamingResponse({
      id: "chatcmpl-evidence",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: "answer" }, finish_reason: OPENAI_FINISH.STOP }],
    }, FORMATS.OPENAI, FORMATS.GEMINI);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "answer" }] },
        finishReason: GEMINI_FINISH.STOP,
      }),
    ]);
    expect(result).not.toHaveProperty("choices");
    expect(result).not.toHaveProperty("response");
  });

  it("preserves Gemini tool identities and token usage without changing native bodies", () => {
    const result = translateNonStreamingResponse({
      id: "chatcmpl-tools",
      model: "m",
      choices: [{ index: 0, message: {
        role: ROLE.ASSISTANT,
        content: null,
        tool_calls: ["call_a", "call_b"].map((id) => ({
          id, type: "function", function: { name: "search", arguments: '{"query":"trees"}' },
        })),
      }, finish_reason: OPENAI_FINISH.TOOL_CALLS }],
      usage: {
        prompt_tokens: 10, completion_tokens: 3, total_tokens: 13,
        prompt_tokens_details: { cached_tokens: 4 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    }, FORMATS.OPENAI, FORMATS.GEMINI);
    expect(result).toEqual({
      candidates: [{ index: 0, finishReason: GEMINI_FINISH.STOP, content: {
        role: GEMINI_ROLE.MODEL,
        parts: ["call_a", "call_b"].map((id) => ({ functionCall: { id, name: "search", args: { query: "trees" } } })),
      } }],
      usageMetadata: {
        promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 13,
        cachedContentTokenCount: 4, thoughtsTokenCount: 2,
      },
      modelVersion: "m", responseId: "chatcmpl-tools",
    });
    expect(translateNonStreamingResponse(result, FORMATS.GEMINI, FORMATS.GEMINI)).toBe(result);
  });
});
