import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: args } });
const completion = (message, finish = OPENAI_FINISH.TOOL_CALLS) => ({
  id: "chat-1089", model: "m", object: "chat.completion",
  choices: [{ index: 0, message: { role: ROLE.ASSISTANT, ...message }, finish_reason: finish }],
  usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
});
const project = (body, options) =>
  translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, options);

describe("#1089 Chat JSON to Responses client", () => {
  it("keeps parallel call identities, order and usage", () => {
    const out = project(completion({
      content: null, tool_calls: [call("call_a", "search", '{"q":"a"}'), call("call_b", "search", '{"q":"b"}')],
    }));
    expect(out).not.toHaveProperty("choices");
    expect(out.output.map((i) => [i.type, i.call_id, i.arguments])).toEqual([
      ["function_call", "call_a", '{"q":"a"}'], ["function_call", "call_b", '{"q":"b"}'],
    ]);
    expect(out.usage).toMatchObject({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
  });

  it("restores a declared custom tool to raw input and leaves functions alone", () => {
    const out = project(completion({
      content: null,
      tool_calls: [call("call_c", "apply_patch", '{"input":"*** Begin Patch"}'), call("call_f", "search", '{"input":"x"}')],
    }), { customToolNames: ["apply_patch"] });
    expect(out.output[0]).toMatchObject({ type: "custom_tool_call", call_id: "call_c", input: "*** Begin Patch" });
    expect(out.output[1]).toMatchObject({ type: "function_call", call_id: "call_f", arguments: '{"input":"x"}' });
  });

  it("splits a namespaced call using the request's declarations", () => {
    const requestBody = { input: "hi", tools: [{ type: "namespace", name: "collab", tools: [{ name: "spawn" }] }] };
    const out = project(completion({ content: null, tool_calls: [call("call_n", "collab.spawn", "{}")] }), { requestBody });
    expect(out.output[0]).toMatchObject({ type: "function_call", name: "spawn", namespace: "collab" });
  });

  it("does not report a truncated or filtered reply as completed", () => {
    for (const finish of [OPENAI_FINISH.LENGTH, OPENAI_FINISH.CONTENT_FILTER]) {
      const out = project(completion({ content: "partial" }, finish));
      expect(out.status).not.toBe("completed");
      expect(out.output[0].content[0].text).toBe("partial");
    }
  });

  it("maps a clean stop to completed", () => {
    expect(project(completion({ content: "ok" }, OPENAI_FINISH.STOP)).status).toBe("completed");
  });
});

describe("#1089 parallel_tool_calls through every lowering", () => {
  const chat = { messages: [{ role: ROLE.USER, content: "hi" }], tools: [{ type: "function", function: { name: "s", parameters: { type: "object" } } }] };
  it.each([false, true, undefined])("Chat to Responses and back keeps parallel_tool_calls=%s", (flag) => {
    const body = flag === undefined ? chat : { ...chat, parallel_tool_calls: flag };
    const responses = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, false);
    const restored = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", responses, false);
    if (flag === undefined) expect(restored).not.toHaveProperty("parallel_tool_calls");
    else expect(restored.parallel_tool_calls).toBe(flag);
  });
});
