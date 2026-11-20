// Port of OmniRoute #15231 (upstream PR #15231, issue #15216): a historical
// Chat→Responses tool call whose output never arrived must be paired with the
// output item it is missing. Strict Responses upstreams reject the whole
// request with 400 "No tool output found for function call <id>" otherwise.
//
// The repair is the mirror of the orphan-output cleanup: a real output always
// wins, only a truly missing counterpart is filled, and the empty
// compatibility result says no result was received instead of implying the
// tool ran.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

// The established empty compatibility result of this fork, shared with the
// Chat-shaped synthesis in concerns/toolCall.js.
const EMPTY_RESULT = "[No response received]";

// End-to-end path: the Chat-shaped repair in the translator pipeline already
// pairs a Chat-sourced history before the Responses hop.
const toResponses = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", structuredClone(body), false);

// The Responses hop on its own: the shape that reaches the Responses wire
// when the Chat-shaped repair did not run for the source.
const toResponsesDirect = (body) =>
  openaiToOpenAIResponsesRequest("m", structuredClone(body), false, null);

const call = (id, name = "probe") => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});

const toolCalls = (ids, name) => ({ role: "assistant", content: null, tool_calls: ids.map((id) => call(id, name)) });

const itemsOfType = (input, type) => input.filter((item) => item.type === type);
const outputs = (input) => input.filter((item) => item.type === "function_call_output" || item.type === "custom_tool_call_output");

describe("Chat to Responses historical tool pairing (#15231)", () => {
  it("keeps a paired history untouched: real output, real ids, no extra item", () => {
    const out = toResponses({
      messages: [
        { role: "user", content: "Say OK." },
        toolCalls(["call_real"]),
        { role: "tool", tool_call_id: "call_real", content: "real result" },
      ],
    });

    expect(outputs(out.input)).toEqual([
      { type: "function_call_output", call_id: "call_real", output: "real result" },
    ]);
    expect(itemsOfType(out.input, "function_call")).toEqual([
      { type: "function_call", call_id: "call_real", name: "probe", arguments: "{}" },
    ]);
  });

  it("pairs an unpaired trailing call with the empty compatibility result right after it", () => {
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "Say OK." },
        toolCalls(["call_orphan"]),
      ],
    });

    const calls = itemsOfType(out.input, "function_call");
    const callOutputs = outputs(out.input);
    expect(calls).toHaveLength(1);
    expect(callOutputs).toHaveLength(1);
    // The call itself survives — it is repaired, never dropped.
    expect(calls[0]).toEqual({ type: "function_call", call_id: "call_orphan", name: "probe", arguments: "{}" });
    expect(callOutputs[0]).toEqual({ type: "function_call_output", call_id: "call_orphan", output: EMPTY_RESULT });

    const callIndex = out.input.findIndex((item) => item.type === "function_call");
    const outputIndex = out.input.findIndex((item) => item.type === "function_call_output");
    expect(outputIndex).toBe(callIndex + 1);
  });

  it("repairs a mid-history unpaired call in place and leaves later items where they were", () => {
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "calling tool", tool_calls: [call("call_lost")] },
        { role: "user", content: "continue" },
      ],
    });

    const types = out.input.map((item) => item.type);
    const callIndex = types.indexOf("function_call");
    const outputIndex = types.indexOf("function_call_output");
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(outputIndex).toBe(callIndex + 1);
    expect(out.input[outputIndex]).toEqual({ type: "function_call_output", call_id: "call_lost", output: EMPTY_RESULT });

    // The trailing user message keeps its position after the repaired pair.
    const continueIndex = out.input.findIndex((item) => item.type === "message" && item.role === "user" && item.content[0]?.text === "continue");
    expect(continueIndex).toBe(outputIndex + 1);
  });

  it("fills only the missing counterpart of interleaved calls and keeps the real output", () => {
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "Say OK." },
        { role: "assistant", content: null, tool_calls: [call("call_orphan"), call("call_paired")] },
        { role: "tool", tool_call_id: "call_paired", content: "b result" },
      ],
    });

    const callOutputs = outputs(out.input);
    expect(callOutputs).toHaveLength(2);
    expect(callOutputs.find((item) => item.call_id === "call_orphan")).toEqual({
      type: "function_call_output",
      call_id: "call_orphan",
      output: EMPTY_RESULT,
    });
    // The real result is never overwritten by the compatibility result.
    expect(callOutputs.find((item) => item.call_id === "call_paired")).toEqual({
      type: "function_call_output",
      call_id: "call_paired",
      output: "b result",
    });
  });

  it("keeps two fully paired interleaved turns free of any synthesized item", () => {
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: null, tool_calls: [call("call_a"), call("call_b")] },
        { role: "tool", tool_call_id: "call_a", content: "a result" },
        { role: "tool", tool_call_id: "call_b", content: "b result" },
        { role: "user", content: "second" },
        { role: "assistant", content: null, tool_calls: [call("call_c"), call("call_d")] },
        { role: "tool", tool_call_id: "call_c", content: "c result" },
        // call_d never got its output.
      ],
    });

    const callOutputs = outputs(out.input);
    // Every call keeps exactly one output; the fill for call_d lands next to
    // its own call, so the item order of the real outputs is untouched.
    expect(callOutputs.map((item) => item.call_id).sort()).toEqual(["call_a", "call_b", "call_c", "call_d"]);
    expect(callOutputs.filter((item) => item.output === EMPTY_RESULT).map((item) => item.call_id)).toEqual(["call_d"]);
    // The empty compatibility result lands directly after its own call.
    const callIndex = out.input.findIndex((item) => item.type === "function_call" && item.call_id === "call_d");
    expect(out.input[callIndex + 1]).toEqual({ type: "function_call_output", call_id: "call_d", output: EMPTY_RESULT });
  });

  it("gives every call exactly one output when several calls are missing theirs", () => {
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "Say OK." },
        { role: "assistant", content: null, tool_calls: [call("call_x"), call("call_y"), call("call_z")] },
      ],
    });

    const callOutputs = outputs(out.input);
    expect(callOutputs).toHaveLength(3);
    expect(callOutputs.map((item) => item.call_id)).toEqual(["call_x", "call_y", "call_z"]);
    expect(callOutputs.every((item) => item.output === EMPTY_RESULT)).toBe(true);
  });

  it("keeps the orphan-output cleanup: an output whose call is gone stays dropped", () => {
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "Say OK." },
        toolCalls(["call_kept"]),
        // The result of a call that is no longer in the history.
        { role: "tool", tool_call_id: "call_gone", content: "orphan result" },
      ],
    });

    const callOutputs = outputs(out.input);
    expect(callOutputs.some((item) => item.call_id === "call_gone")).toBe(false);
    // The surviving call is still paired, so exactly one output remains.
    expect(callOutputs).toEqual([{ type: "function_call_output", call_id: "call_kept", output: EMPTY_RESULT }]);
  });

  it("pairs an unpaired custom tool call with a custom tool output", () => {
    const out = toResponsesDirect({
      tools: [{ type: "custom", custom: { name: "apply_patch", description: "Apply a patch" } }],
      messages: [
        { role: "user", content: "patch it" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "custom", custom: { name: "apply_patch", input: "patch" } }] },
      ],
    });

    const customCalls = itemsOfType(out.input, "custom_tool_call");
    const customOutputs = itemsOfType(out.input, "custom_tool_call_output");
    expect(customCalls).toHaveLength(1);
    expect(customOutputs).toEqual([{ type: "custom_tool_call_output", call_id: "c1", output: EMPTY_RESULT }]);
  });

  it("does not double-pair a Chat history the Chat-shaped repair already paired", () => {
    const out = toResponses({
      messages: [
        { role: "user", content: "Say OK." },
        toolCalls(["call_once"]),
      ],
    });

    // One output only: the Chat-shaped synthesis owns this pairing, and the
    // Responses-side repair must not add a second one.
    expect(outputs(out.input)).toEqual([
      { type: "function_call_output", call_id: "call_once", output: EMPTY_RESULT },
    ]);
  });

  it("preserves native passthrough: a Responses body is forwarded without pairing", () => {
    const nativeBody = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Say OK." }] },
        { type: "function_call", call_id: "call_native", name: "probe", arguments: "{}" },
      ],
    };
    const out = openaiToOpenAIResponsesRequest("m", nativeBody, false, null);

    // Native Responses input is passed through with the orphan-output cleanup
    // only — a pending call is the native client's own protocol business.
    expect(out.input).toEqual(nativeBody.input);
  });

  it("pairs an unanswered call that reaches the Responses wire through a non-Chat source", () => {
    // Antigravity histories keep their function call in a model turn; the
    // Chat-shaped repair does not run for that source, so the Responses-side
    // repair is the only thing that keeps the request valid.
    const out = translateRequest(FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES, "m", {
      contents: [
        { role: "user", parts: [{ text: "Say OK." }] },
        { role: "model", parts: [{ functionCall: { id: "call_ag_1", name: "probe", args: { q: "alpha" } } }] },
      ],
    }, false);

    expect(outputs(out.input)).toEqual([
      { type: "function_call_output", call_id: "call_ag_1", output: EMPTY_RESULT },
    ]);
  });

  it("keeps the synthesized counterpart on the call id the wire actually uses", () => {
    // A long id is clamped to the Responses limit; the counterpart must carry
    // the clamped id, not the original one.
    const longId = `call_${"x".repeat(90)}`;
    const out = toResponsesDirect({
      messages: [
        { role: "user", content: "Say OK." },
        toolCalls([longId]),
      ],
    });

    const callOutput = outputs(out.input)[0];
    const wireCall = itemsOfType(out.input, "function_call")[0];
    expect(callOutput.call_id).toBe(wireCall.call_id);
    expect(callOutput.call_id.length).toBeLessThanOrEqual(64);
  });
});
