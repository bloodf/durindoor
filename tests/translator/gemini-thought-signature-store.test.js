// Round-trip test for the persisted thoughtSignature store (upstream c08efdbe)
// on the openai→gemini translator path.
//
// The response translator (gemini→openai) now persists the provider-issued
// thoughtSignature keyed by the raw functionCall id (session-namespaced plus a
// bare fallback) via services/thoughtSignatureStore.js. The request translator
// (openai→gemini) replays it when the client sends back a bare call id that
// carries no transport-encoded signature (signatureTransport.js stays the
// primary channel — see bugs-antigravity.test.js).
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const SESSION = "vitest-thoughtsig-store";
const RAW_ID = "call_store_rt_1";
const SIG = "Ev4CCtestPersistedThoughtSignatureFromGemini=";

function geminiToolCallChunk() {
  return {
    responseId: "resp-store-1",
    candidates: [{
      content: {
        parts: [{
          thoughtSignature: SIG,
          functionCall: { id: RAW_ID, name: "search", args: { q: "x" } },
        }],
      },
      finishReason: "STOP",
    }],
  };
}

function openaiFollowUp(callId) {
  return {
    messages: [
      { role: "user", content: "find x" },
      { role: "assistant", tool_calls: [{ id: callId, type: "function", function: { name: "search", arguments: "{\"q\":\"x\"}" } }] },
      { role: "tool", tool_call_id: callId, content: "result" },
    ],
  };
}

function geminiFunctionCallPart(request) {
  const modelTurn = request.contents.find((c) => c.role === "model" && c.parts.some((p) => p.functionCall));
  return modelTurn?.parts.find((p) => p.functionCall);
}

describe("Gemini thoughtSignature persisted-store round trip (openai path)", () => {
  it("replays a stored signature for a bare call id with no transport-encoded signature", () => {
    // 1. Provider streams a functionCall carrying a thoughtSignature; the
    //    response translator persists it under the raw call id.
    const state = initState(FORMATS.OPENAI);
    state.sessionId = SESSION;
    const events = translateResponse(FORMATS.GEMINI, FORMATS.OPENAI, geminiToolCallChunk(), state);
    const toolChunk = events.find((e) => e?.choices?.[0]?.delta?.tool_calls);
    expect(toolChunk, "no tool_call chunk emitted").toBeTruthy();

    // 2. A later turn references the RAW call id (no agsig1_ transport
    //    encoding), so the request translator must recover the signature from
    //    the persisted store instead of the id.
    const request = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-2.5-flash",
      openaiFollowUp(RAW_ID),
      false,
      { apiKey: "test" },
      "gemini"
    );
    const part = geminiFunctionCallPart(request);
    expect(part, "no functionCall part in gemini request").toBeTruthy();
    expect(part.functionCall.id).toBe(RAW_ID);
    expect(part.thoughtSignature, "stored signature was not replayed").toBe(SIG);
  });

  it("keeps the synthetic default for calls with no stored signature", () => {
    const request = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-2.5-flash",
      openaiFollowUp("call_never_stored_1"),
      false,
      { apiKey: "test" },
      "gemini"
    );
    const part = geminiFunctionCallPart(request);
    expect(part).toBeTruthy();
    expect(typeof part.thoughtSignature, "synthetic default must remain for unknown calls").toBe("string");
    expect(part.thoughtSignature).not.toBe(SIG);
  });
});
