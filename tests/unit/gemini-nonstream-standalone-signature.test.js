import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { decodeToolCallId } from "../../open-sse/translator/concerns/signatureTransport.js";

const SIGNATURE = "provider-signature";
const CALL = { id: "gemini-call-1", name: "read_file", args: { path: "a.js" } };

function callIds(parts) {
  const response = {
    responseId: "resp-1",
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
  };
  const out = translateNonStreamingResponse(response, FORMATS.ANTIGRAVITY, FORMATS.OPENAI);
  return out.choices[0].message.tool_calls.map((call) => decodeToolCallId(call.id));
}

describe("upstream decolua/9router#3645 - non-streaming standalone thought signature", () => {
  it.each([
    ["a bare signature part", { thoughtSignature: SIGNATURE }],
    ["a signed empty text part", { text: "", thoughtSignature: SIGNATURE }],
    ["a snake_case signature part", { thought_signature: SIGNATURE }],
  ])("carries the signature from %s to the next call", (_label, signedPart) => {
    expect(callIds([signedPart, { functionCall: CALL }])).toEqual([
      { id: CALL.id, signature: SIGNATURE },
    ]);
  });

  it("gives the held signature to one call only", () => {
    const [first, second] = callIds([
      { thoughtSignature: SIGNATURE },
      { functionCall: CALL },
      { functionCall: { ...CALL, id: "gemini-call-2" } },
    ]);

    expect(first.signature).toBe(SIGNATURE);
    expect(second).toEqual({ id: "gemini-call-2", signature: null });
  });
});
