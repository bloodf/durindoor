import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { projectCompletionToClientFormat, responsesApiToOpenAICompletion } from "../../open-sse/translator/response/completionProjector.js";
import { openAIResponsesBodyToOpenAI, openAIResponsesBodyToClaude } from "../../open-sse/translator/response/openai-responses-nonstream.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const text = [{ type: "message", content: [{ type: "output_text", text: "partial" }] }];
const tool = [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" }];
const response = (status, reason, output = text) => ({ id: "resp_1", status, incomplete_details: reason ? { reason } : null, output });
const finish = (body) => responsesApiToOpenAICompletion(body).choices[0].finish_reason;

describe("existing Responses and Claude stop reasons", () => {
  it("projects known incomplete causes and preserves successful and error statuses", () => {
    expect(finish(response("incomplete", "max_output_tokens"))).toBe("length");
    expect(finish(response("incomplete", "content_filter"))).toBe("content_filter");
    expect(finish(response("incomplete", "max_output_tokens", tool))).toBe("length");
    expect(finish(response("completed", null))).toBe("stop");
    expect(finish(response("completed", null, tool))).toBe("tool_calls");
    expect(finish(response("failed", null, tool))).toBe("failed");
    expect(finish(response("incomplete", "other"))).toBe("incomplete");
  });

  it("retains existing direct non-stream and Claude mappings", () => {
    expect(openAIResponsesBodyToOpenAI(response("incomplete", "max_output_tokens")).choices[0].finish_reason).toBe("length");
    expect(openAIResponsesBodyToClaude(response("incomplete", "content_filter")).stop_reason).toBe("refusal");
    for (const [reason, expected] of [["stop", "end_turn"], ["length", "max_tokens"], ["tool_calls", "tool_use"], ["refusal", "refusal"], ["content_filter", "end_turn"]]) {
      const completion = { choices: [{ message: { content: "partial" }, finish_reason: reason }] };
      expect(projectCompletionToClientFormat(completion, FORMATS.CLAUDE).stop_reason).toBe(expected);
      const events = openaiToClaudeResponse({ choices: [{ delta: {}, finish_reason: reason }] }, {});
      expect(events.find((event) => event.type === "message_delta").delta.stop_reason).toBe(expected);
    }
  });

  it("emits a filtered stream finish and keeps errors as errors", () => {
    const chunk = openaiResponsesToOpenAIResponse({ type: "response.incomplete", response: response("incomplete", "content_filter") }, {});
    expect(chunk.choices[0].finish_reason).toBe("content_filter");
    const events = openaiToClaudeResponse({ choices: [{ delta: {}, finish_reason: "error" }] }, {});
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(events.some((event) => event.type === "message_delta")).toBe(false);
  });
});
