// Port of decolua/9router #4499: translated Responses output items carry `status`.
import { describe, it, expect } from "vitest";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const run = (chunks) => {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  return chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
};
const find = (events, name, type) => events.find((e) => e.event === name && e.data.item?.type === type);

describe("OpenAI Chat stream to Responses: output item status", () => {
  it("function_call items carry in_progress on added and completed on done", () => {
    const events = run([
      { id: "cmb-status", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: "" } }] }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"filePath":"/etc/hostname"}' } }] }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    expect(find(events, "response.output_item.added", "function_call").data.item.status).toBe("in_progress");
    expect(find(events, "response.output_item.done", "function_call").data.item.status).toBe("completed");
  });

  it("message items carry in_progress on added and completed on done", () => {
    const events = run([
      { id: "cmb-status", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
    expect(find(events, "response.output_item.added", "message").data.item.status).toBe("in_progress");
    expect(find(events, "response.output_item.done", "message").data.item.status).toBe("completed");
  });

  it("reasoning items carry in_progress on added and completed on done", () => {
    const events = run([
      { id: "cmb-status", choices: [{ index: 0, delta: { reasoning_content: "thinking about it" }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
    expect(find(events, "response.output_item.added", "reasoning").data.item.status).toBe("in_progress");
    expect(find(events, "response.output_item.done", "reasoning").data.item.status).toBe("completed");
  });
});
