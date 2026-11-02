import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// Issue #1328 / #1089: Chat→Gemini must map OpenAI string tool_choice values to
// Gemini functionCallingConfig.mode (AUTO / NONE / ANY). Named function choice
// already maps to ANY with allowedFunctionNames and must keep working.
//
// These assertions mirror the skipped rows in PR #1322's
// v5-conformance-matrix-chat.test.js. That matrix file is owned by #1322 and
// must not be edited here; flip those it.skip markers after #1322 merges.

const chat = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "hi" }],
  tools: [{
    type: OPENAI_BLOCK.FUNCTION,
    function: {
      name: "ns.search",
      description: "Search",
      parameters: { type: "object", properties: {} },
    },
  }],
  ...extra,
});

const toGemini = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-pro", structuredClone(body), false);

describe("#1328 Chat tool_choice strings to Gemini functionCallingConfig", () => {
  it("maps tool_choice auto to Gemini AUTO mode", () => {
    const out = toGemini(chat({ tool_choice: "auto", parallel_tool_calls: true }));
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
  });

  it("maps tool_choice none to Gemini NONE mode", () => {
    const out = toGemini(chat({ tool_choice: "none" }));
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "NONE" } });
  });

  it("maps tool_choice required to Gemini ANY mode", () => {
    const out = toGemini(chat({ tool_choice: "required", parallel_tool_calls: true }));
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  it("maps named tool_choice to Gemini ANY with allowedFunctionNames", () => {
    const out = toGemini(chat({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
    }));
    expect(out.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["ns.search"] },
    });
  });

  it("leaves toolConfig unset for unknown string tool_choice including prototype keys", () => {
    const out = toGemini(chat({ tool_choice: "toString" }));
    expect(out.toolConfig).toBeUndefined();
  });

  // #1339: string modes must not emit toolConfig without function declarations.
  describe.each(["auto", "none", "required"])("tool_choice %s without declarations", (tool_choice) => {
    it("leaves toolConfig unset when tools is []", () => {
      const out = toGemini(chat({ tools: [], tool_choice }));
      expect(out.tools).toBeUndefined();
      expect(out.toolConfig).toBeUndefined();
    });

    it("leaves toolConfig unset when tools is missing", () => {
      const out = toGemini({
        messages: [{ role: ROLE.USER, content: "hi" }],
        tool_choice,
      });
      expect(out.tools).toBeUndefined();
      expect(out.toolConfig).toBeUndefined();
    });
  });
});
