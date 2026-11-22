// A Gemini stream can re-send a growing snapshot of a function call under the
// same id. Claude clients must see one tool_use; a second block runs the call twice.
import { describe, expect, it } from "vitest";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";
import { getGeminiThoughtSignature } from "../../open-sse/services/geminiThoughtSignatureStore.js";

function chunk(id, args, extra = {}) {
  const part = { functionCall: { name: "edit", args } };
  if (id) part.functionCall.id = id;
  Object.assign(part, extra);
  return { response: { candidates: [{ content: { parts: [part] } }] } };
}

function toolUses(events) {
  return (events || []).filter((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use");
}

describe("geminiToClaudeResponse repeated function call (#20790)", () => {
  it("emits one tool_use for a re-sent id and keeps a later different id", () => {
    const state = { signatureNamespace: "portor-20790-resent" };
    const first = geminiToClaudeResponse(chunk("call-edit-1", { path: "a" }), state);
    const resent = geminiToClaudeResponse(chunk("call-edit-1", { path: "a", line: 2 }, { thoughtSignature: "sig-a" }), state);
    const next = geminiToClaudeResponse(chunk("call-b", { path: "b" }), state);

    expect(toolUses(first).map((event) => event.content_block.id)).toEqual(["call-edit-1"]);
    expect(toolUses(resent)).toEqual([]);
    expect(toolUses(next).map((event) => event.content_block.id)).toEqual(["call-b"]);
    expect(getGeminiThoughtSignature("portor-20790-resent:call-edit-1")).toBe("sig-a");
    expect(getGeminiThoughtSignature("portor-20790-resent:call-b")).toBeNull();
  });

  it("still emits each call that has no id", () => {
    const state = { signatureNamespace: "portor-20790-noid" };
    const first = geminiToClaudeResponse(chunk(null, { n: 1 }), state);
    const second = geminiToClaudeResponse(chunk(null, { n: 2 }), state);
    const ids = [...toolUses(first), ...toolUses(second)].map((event) => event.content_block.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
