import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

const output = (callId, text, type = "function_call_output") => ({ type, call_id: callId, output: text });
const toChat = (body, target = "openai") => translateRequest("openai-responses", target, "m", structuredClone(body), false);
const shape = (messages) => messages.map((m) => [m.role, m.tool_calls?.map((c) => c.id) ?? m.tool_call_id ?? m.content]);

describe("upstream PR #4711: tool results in Responses continuations", () => {
  it("pairs a lone tool result with a placeholder call", () => {
    const { messages } = toChat({ previous_response_id: "resp_x", input: [output("call_a", "{\"ok\":true}")] });

    expect(shape(messages)).toEqual([["assistant", ["call_a"]], ["tool", "call_a"]]);
    expect(messages[0].tool_calls[0].function).toEqual({ name: "unknown_tool", arguments: "{}" });
    expect(messages[1].content).toBe("{\"ok\":true}");
  });

  it("puts parallel results, including custom tool results, in one assistant turn", () => {
    const { messages } = toChat({ previous_response_id: "resp_x", input: [output("call_a", "A"), output("call_b", "B", "custom_tool_call_output")] });

    expect(shape(messages)).toEqual([["assistant", ["call_a", "call_b"]], ["tool", "call_a"], ["tool", "call_b"]]);
  });

  it("keeps a call that is present and adds only the missing one", () => {
    const { messages } = toChat({
      previous_response_id: "resp_x",
      input: [{ type: "function_call", call_id: "call_a", name: "read", arguments: "{}" }, output("call_a", "A"), output("call_b", "B")],
    });

    expect(shape(messages)).toEqual([["assistant", ["call_a", "call_b"]], ["tool", "call_a"], ["tool", "call_b"]]);
    expect(messages[0].tool_calls.map((c) => c.function.name)).toEqual(["read", "unknown_tool"]);
  });

  it("reaches a Gemini upstream as a function call and response", () => {
    const { contents } = toChat({ previous_response_id: "resp_x", input: [output("call_a", "A")] }, "gemini");
    const parts = contents.flatMap((c) => c.parts);

    expect(parts.some((p) => p.functionCall?.name === "unknown_tool")).toBe(true);
    expect(parts.some((p) => p.functionResponse)).toBe(true);
  });

  it("still strips an orphaned result when there is no previous response", () => {
    const { messages } = toChat({ input: [{ type: "message", role: "user", content: "hi" }, output("call_gone", "stale")] });

    expect(JSON.stringify(messages)).not.toContain("call_gone");
  });

  it("keeps Claude targets on user content and direct conversion unchanged", () => {
    const body = { previous_response_id: "resp_x", input: [output("call_a", "A")] };

    expect(JSON.stringify(toChat(body, "claude").messages)).not.toContain("unknown_tool");
    expect(JSON.stringify(openaiResponsesToOpenAIRequest("m", body, false).messages)).not.toContain("unknown_tool");
  });
});
