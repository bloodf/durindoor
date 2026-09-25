import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

/**
 * Port of OmniRoute#14673: GitHub Copilot's /responses endpoint rejects a body
 * that carries neither a non-empty `input` nor previous_response_id / prompt /
 * conversation_id:
 *   400 One of "input" or "previous_response_id" or 'prompt' or 'conversation'
 *       must be provided.
 * System-only turns, empty messages arrays, and orphan-filtered tool results
 * can all leave `input: []` on the chat -> Responses translation. Without a
 * placeholder, that body reaches Copilot and 400s.
 */
function hasContinuity(body) {
  const input = body.input;
  const inputOk = Array.isArray(input) && input.length > 0;
  const hasId = typeof body.previous_response_id === "string" && body.previous_response_id.length > 0;
  const hasConversation = typeof body.conversation_id === "string" && body.conversation_id.length > 0;
  const hasPrompt = typeof body.prompt === "string" && body.prompt.length > 0;
  return inputOk || hasId || hasConversation || hasPrompt;
}

describe("port(omniroute): #14673 chat -> Responses empty-input continuity", () => {
  it("injects a placeholder user item for a system-only turn", () => {
    const result = openaiToOpenAIResponsesRequest(
      "gpt-5.5",
      { messages: [{ role: "system", content: "You are helpful." }] },
      true,
      null
    );

    expect(hasContinuity(result)).toBe(true);
    expect(result.instructions).toBe("You are helpful.");
    expect(result.input.length).toBeGreaterThan(0);
    expect(result.input[0].role).toBe("user");
  });

  it("injects a placeholder for an empty messages array", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5.5", { messages: [] }, true, null);
    expect(hasContinuity(result)).toBe(true);
  });

  it("injects a placeholder when orphaned tool results filter to empty input", () => {
    const result = openaiToOpenAIResponsesRequest(
      "gpt-5.5",
      {
        messages: [
          { role: "system", content: "Rules" },
          { role: "tool", tool_call_id: "call_orphan_x", content: "stale" },
        ],
      },
      true,
      null
    );

    expect(hasContinuity(result)).toBe(true);
  });

  it("keeps an existing previous_response_id instead of injecting a placeholder", () => {
    const result = openaiToOpenAIResponsesRequest(
      "gpt-5.5",
      {
        input: [],
        previous_response_id: "resp_prev_abc",
      },
      true,
      null
    );

    expect(result.previous_response_id).toBe("resp_prev_abc");
    expect(result.input).toEqual([]);
  });

  it("does not touch input when it already carries content", () => {
    const result = openaiToOpenAIResponsesRequest(
      "gpt-5.5",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      null
    );

    expect(result.input).toHaveLength(1);
    expect(result.input[0].content[0].text).toBe("hi");
  });
});
