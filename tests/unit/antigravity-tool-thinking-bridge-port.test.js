import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { getModelUpstreamId, getDispatchUpstreamModelId } from "../../open-sse/config/providerModels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

describe("Antigravity tool and thinking bridge updates", () => {
  it("preserves tool result text and failure markers through the Gemini bridge", () => {
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-4-argon-high", {
      messages: [
        { role: "assistant", tool_calls: [
          { id: "ok1", type: "function", function: { name: "run", arguments: "{}" } },
          { id: "err1", type: "function", function: { name: "run", arguments: "{}" } }
        ] },
        { role: "tool", tool_call_id: "ok1", content: "plain result" },
        { role: "tool", tool_call_id: "err1", content: "failed", is_error: true }
      ]
    }, true, null, "antigravity");
    const responseParts = translated.request.contents.flatMap((c) => c.parts || []).filter((p) => p.functionResponse);
    expect(responseParts[0].functionResponse.response).toEqual({ result: "plain result" });
    expect(responseParts[1].functionResponse.response).toEqual({ result: "[Tool error]\nfailed" });
  });

  it("maps adaptive, disabled, zero budget, auto and none to Antigravity tiers", () => {
    expect(getDispatchUpstreamModelId("ag", "gemini-4-argon", { thinking: { type: "adaptive" } })).toBe("gemini-4-argon-high");
    expect(getDispatchUpstreamModelId("ag", "gemini-4-argon", { thinking: { type: "disabled" } })).toBe("gemini-4-argon-low");
    expect(getDispatchUpstreamModelId("ag", "gemini-4-argon", { thinking: { budget_tokens: 0 } })).toBe("gemini-4-argon-low");
    expect(getDispatchUpstreamModelId("ag", "gemini-4-argon", { reasoning_effort: "auto" })).toBe("gemini-4-argon-high");
    expect(getDispatchUpstreamModelId("ag", "gemini-4-argon", { reasoning_effort: "none" })).toBe("gemini-4-argon-low");
    expect(getModelUpstreamId("ag", "gemini-4-argon")).toBe("gemini-4-argon-high");
  });

  it("uses a thought signature matching the Antigravity model family", () => {
    const makeBody = () => ({ request: { contents: [
      { role: "model", parts: [{ functionCall: { id: "sig-test", name: "run", args: {} } }] }
    ] } });
    const exec = new AntigravityExecutor();
    expect(exec.transformRequest("gemini-4-argon-high", makeBody(), true, {}).request.contents[0].parts[0].thoughtSignature)
      .toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
    expect(exec.transformRequest("claude-sonnet-5-5-high", makeBody(), true, {}).request.contents[0].parts[0].thoughtSignature)
      .toBe(DEFAULT_THINKING_AG_SIGNATURE);
  });

  it("uses Antigravity's 64k Claude response ceiling when max_tokens is omitted", () => {
    const request = translateRequest(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, "claude-sonnet-5-5-high", {
      messages: [{ role: "user", content: "write" }]
    }, true, null, "antigravity");
    expect(request.request.generationConfig.maxOutputTokens).toBe(64000);
  });
});
