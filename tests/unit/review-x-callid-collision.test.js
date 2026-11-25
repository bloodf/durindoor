import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { clampResponsesCallId } from "../../open-sse/translator/formats/responsesApi.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../../open-sse/translator/schema/index.js";

describe("Responses call ID collisions", () => {
  it("reserves short IDs and pairs each output deterministically", () => {
    const longId = "a".repeat(65);
    const shortId = clampResponsesCallId(longId);
    const call = (id) => ({ id, type: OPENAI_BLOCK.FUNCTION, function: { name: "probe", arguments: "{}" } });
    const body = { messages: [
      { role: ROLE.ASSISTANT, tool_calls: [call(longId), call(shortId)] },
      { role: ROLE.TOOL, tool_call_id: longId, content: "long" },
      { role: ROLE.TOOL, tool_call_id: shortId, content: "short" },
    ] };
    const convert = () => openaiToOpenAIResponsesRequest("model", body, false).input;
    const items = convert();
    const calls = items.filter((item) => item.type === RESPONSES_ITEM.FUNCTION_CALL);
    const outputs = items.filter((item) => item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT);
    expect(calls).toHaveLength(2);
    expect(outputs).toHaveLength(2);
    expect(calls[0].call_id).not.toBe(calls[1].call_id);
    expect(calls[1].call_id).toBe(shortId);
    expect(outputs.map((item) => item.call_id)).toEqual(calls.map((item) => item.call_id));
    expect(calls.every((item) => item.call_id.length <= 64)).toBe(true);
    expect(convert()).toEqual(items);
  });
});
