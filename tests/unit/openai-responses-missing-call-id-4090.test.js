/**
 * Regression (port of decolua/9router#4090): a Responses API `function_call_output`
 * item that arrives WITHOUT `call_id` (Droid, OpenCode and similar agent CLIs have
 * been observed dropping it) used to be translated into a Chat Completions tool
 * message carrying `tool_call_id: undefined` — a key `JSON.stringify` silently
 * removes. Strict upstreams then reject the WHOLE request:
 *
 *   NVIDIA NIM  400 "Failed to deserialize the JSON body into the target type:
 *                   missing field `tool_call_id`"
 *
 * One malformed item therefore killed every model in a combo fallback. The
 * correlation id must be recovered by pairing the output with the oldest
 * unanswered function_call — or the request must stop carrying an unpairable
 * tool message at all.
 */
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { convertResponsesApiFormat, repairMissingResponsesCallIds } from "../../open-sse/translator/formats/responsesApi.js";

const TOOLS = [
  {
    type: "function",
    name: "exec_command",
    description: "run a command",
    parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
  },
];

const user = (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const call = (callId) => ({
  type: "function_call",
  name: "exec_command",
  arguments: JSON.stringify({ cmd: "ls" }),
  ...(callId ? { call_id: callId } : {}),
});
const toolMessages = (body) => body.messages.filter((m) => m.role === "tool");
/** every tool message must survive serialization with a non-empty string id */
const serializedToolIds = (body) =>
  JSON.parse(JSON.stringify(body))
    .messages.filter((m) => m.role === "tool")
    .map((m) => m.tool_call_id);

describe("Responses tool output without call_id (openai-responses.js)", () => {
  it("pairs the orphan output with the pending function_call", () => {
    const body = openaiResponsesToOpenAIRequest(
      "nvidia/z-ai/glm-5.3",
      { input: [user("used a tool"), call("call_abc"), { type: "function_call_output", output: "ok" }], tools: TOOLS },
      false,
      {}
    );

    const toolMsgs = toolMessages(body);
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].tool_call_id).toBe("call_abc");
    const assistantCallIds = body.messages
      .filter((m) => m.role === "assistant" && m.tool_calls)
      .flatMap((m) => m.tool_calls.map((tc) => tc.id));
    expect(assistantCallIds).toContain("call_abc");
    expect(serializedToolIds(body).every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("keeps ids consistent when the function_call item itself lost call_id", () => {
    const body = openaiResponsesToOpenAIRequest(
      "nvidia/z-ai/glm-5.3",
      { input: [user("used a tool"), call(), { type: "function_call_output", output: "ok" }], tools: TOOLS },
      false,
      {}
    );

    const [assistantCallId] = body.messages
      .filter((m) => m.role === "assistant" && m.tool_calls)
      .flatMap((m) => m.tool_calls.map((tc) => tc.id));
    const [toolId] = serializedToolIds(body);
    expect(typeof assistantCallId).toBe("string");
    expect(toolId).toBe(assistantCallId);
  });

  it("preserves parallel outputs in order", () => {
    const body = openaiResponsesToOpenAIRequest(
      "m",
      {
        input: [
          user("used two tools"),
          call("call_1"),
          call("call_2"),
          { type: "function_call_output", output: "first" },
          { type: "function_call_output", output: "second" },
        ],
        tools: TOOLS,
      },
      false,
      {}
    );

    expect(toolMessages(body).map((m) => [m.tool_call_id, m.content])).toEqual([
      ["call_1", "first"],
      ["call_2", "second"],
    ]);
  });

  it("still drops a true orphan output that has no matching function_call", () => {
    const body = openaiResponsesToOpenAIRequest(
      "m",
      { input: [user("hi"), { type: "function_call_output", output: "late result" }], tools: TOOLS },
      false,
      {}
    );

    expect(toolMessages(body)).toHaveLength(0);
    expect(JSON.stringify(body.messages)).not.toContain("late result");
    expect(serializedToolIds(body)).toEqual([]);
  });
});

describe("Responses tool output without call_id (formats/responsesApi.js, responsesHandler path)", () => {
  it("pairs the orphan output with the pending function_call", () => {
    const body = convertResponsesApiFormat({
      input: [user("used a tool"), call("call_abc"), { type: "function_call_output", output: "ok" }],
      tools: TOOLS,
    });

    expect(serializedToolIds(body)).toEqual(["call_abc"]);
  });

  it("never emits an id-less tool message for a genuine orphan", () => {
    const body = convertResponsesApiFormat({
      input: [user("hi"), { type: "function_call_output", output: "late" }],
      tools: TOOLS,
    });

    expect(JSON.parse(JSON.stringify(body)).messages.filter((m) => m.role === "tool")).toEqual([]);
  });
});

describe("repairMissingResponsesCallIds", () => {
  it("returns the same array reference when nothing needs repair", () => {
    const items = [user("hi"), call("call_1"), { type: "function_call_output", output: "ok", call_id: "call_1" }];
    expect(repairMissingResponsesCallIds(items)).toBe(items);
  });

  it("passes through non-array input unchanged", () => {
    expect(repairMissingResponsesCallIds(null)).toBe(null);
  });
});
