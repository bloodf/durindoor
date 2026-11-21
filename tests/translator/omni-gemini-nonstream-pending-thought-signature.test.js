import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { decodeToolCallId } from "../../open-sse/translator/concerns/signatureTransport.js";

const signatures = ["opaque_fixture_sig_A7", "opaque_fixture_sig_B9"];

function response(parts) {
  return {
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
  };
}

function adapter(parts) {
  return translateNonStreamingResponse(response(parts), FORMATS.GEMINI, FORMATS.OPENAI);
}

function followUp(id, name) {
  return { messages: [
    { role: "assistant", tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] },
    { role: "tool", tool_call_id: id, content: "ok" },
  ] };
}

describe("Gemini non-streaming pending thought signature", () => {
  it.each(["thoughtSignature", "thought_signature"])("encodes and replays a preceding thinking-part %s", (key) => {
    const parts = [
      { thought: true, text: "thinking", [key]: signatures[0] },
      { functionCall: { id: "raw_fixture_call", name: "lookup", args: { q: "x" } } },
    ];
    const result = adapter(parts);
    const call = result.choices[0].message.tool_calls[0];
    expect(decodeToolCallId(call.id)).toEqual({ id: "raw_fixture_call", signature: signatures[0] });

    const replay = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-pro", followUp(call.id, "lookup"), true, null, "gemini");
    const replayCall = replay.contents.flatMap((turn) => turn.parts).find((part) => part.functionCall);
    expect(replayCall.functionCall).toEqual({ id: "raw_fixture_call", name: "lookup", args: {} });
    expect(replayCall.thoughtSignature).toBe(signatures[0]);
  });

  it("prefers the call signature, consumes pending once, and never leaks across candidates or requests", () => {
    const pending = { thought: true, text: "thinking", thoughtSignature: signatures[0] };
    const ownSigned = { functionCall: { id: "raw_direct", name: "first", args: {} }, thought_signature: signatures[1] };
    const later = { functionCall: { id: "raw_later", name: "second", args: {} } };
    const result = adapter([pending, ownSigned, later]);
    const calls = result.choices[0].message.tool_calls;
    expect(decodeToolCallId(calls[0].id)).toEqual({ id: "raw_direct", signature: signatures[1] });
    expect(decodeToolCallId(calls[1].id)).toEqual({ id: "raw_later", signature: null });

    const otherCandidate = adapter([pending, { functionCall: { id: "raw_other_candidate", name: "other", args: {} } }]);
    expect(decodeToolCallId(otherCandidate.choices[0].message.tool_calls[0].id).signature).toBe(signatures[0]);
    const withUnselectedCandidate = translateNonStreamingResponse({
      candidates: [
        { content: { role: "model", parts: [{ functionCall: { id: "raw_selected", name: "selected", args: {} } }] }, finishReason: "STOP" },
        { content: { role: "model", parts: [pending] }, finishReason: "STOP" },
      ],
    }, FORMATS.GEMINI, FORMATS.OPENAI);
    expect(decodeToolCallId(withUnselectedCandidate.choices[0].message.tool_calls[0].id)).toEqual({ id: "raw_selected", signature: null });
    const nextRequest = adapter([{ functionCall: { id: "raw_next_request", name: "next", args: {} } }]);
    expect(decodeToolCallId(nextRequest.choices[0].message.tool_calls[0].id)).toEqual({ id: "raw_next_request", signature: null });
  });
});
