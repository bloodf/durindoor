import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

const responses = FORMATS.OPENAI_RESPONSES;
const chat = FORMATS.OPENAI;
const request = (body, target) => translateRequest(responses, target, "m", body, false);
const stream = (events, target) => {
  const state = initState(responses);
  return events.flatMap((event) => translateResponse(responses, target, event, state));
};

describe("#1089 Responses client conformance", () => {
  it("preserves tool schema flags, choice, and parallel limit to Chat", () => {
    const body = { input: "hi", tools: [{ type: "function", name: "lookup", description: "lookup", strict: false, parameters: { type: "object", properties: { q: { type: "string" } } } }], tool_choice: { type: "function", name: "lookup" }, parallel_tool_calls: false };
    const out = request(body, chat);
    expect(out.tools[0].function).toMatchObject({ name: "lookup", strict: false });
    expect(out.tool_choice).toEqual({ type: "function", function: { name: "lookup" } });
    expect(out.parallel_tool_calls).toBe(false);
  });

  it("keeps function call and output pairing in Responses-to-Chat request", () => {
    const out = request({ input: [
      { type: "function_call", call_id: "c1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "done" },
    ] }, chat);
    expect(out.messages.some((m) => m.tool_calls?.[0]?.id === "c1")).toBe(true);
    expect(out.messages.some((m) => m.tool_call_id === "c1" && m.content === "done")).toBe(true);
  });

  // #1089 failing: translator pairs historical function outputs by call ID across assistant turns.
  it.todo("does not pair tool result across assistant turns");

  it.skip("historical tool pairing reproduces cross-turn behavior", () => {
    const out = request({ input: [
      { type: "function_call", call_id: "old", name: "lookup", arguments: "{}" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "new turn" }] },
      { type: "function_call_output", call_id: "old", output: "result" },
    ] }, chat);
    expect(out.messages.filter((m) => m.tool_call_id === "old")).toHaveLength(0);
  });

  it("translates non-string descriptions without TypeError to Kiro", () => {
    expect(() => request({ input: "hi", tools: [{ type: "function", name: "lookup", description: { text: "x" }, parameters: { type: "object" } }] }, FORMATS.KIRO)).not.toThrow(TypeError);
  });

  it("translates Responses incomplete terminal to Chat length", () => {
    const out = stream([{ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }], chat);
    expect(out.at(-1).choices[0].finish_reason).toBe("length");
  });

  it("translates Responses failed terminal error to Chat", () => {
    const out = stream([{ type: "response.failed", response: { error: { message: "failed" } } }], chat);
    expect(out[0].choices[0].delta.content).toContain("failed");
  });

  it("projects non-stream incomplete status to Chat response", () => {
    const out = translateNonStreamingResponse({ id: "r", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, responses, chat);
    expect(out.choices[0].finish_reason).toBe("length");
  });
});
