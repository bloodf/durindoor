import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { resolveKiroModel } from "../../open-sse/config/kiroConstants.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Kiro Claude wire model ids (upstream 9router#2904)", () => {
  it.each([
    ["claude-sonnet.5", "claude-sonnet-5"],
    ["claude-sonnet.5-thinking-agentic", "claude-sonnet-5"],
    ["claude-fable.5", "claude-fable-5"],
    ["claude-opus.4.8", "claude-opus-4.8"],
    ["claude-sonnet-4.5", "claude-sonnet-4.5"],
    ["claude-3.7", "claude-3.7"],
    ["deepseek-3.2", "deepseek-3.2"],
    ["MiniMax-M2.5", "minimax-m2.5"],
  ])("resolves %s to %s", (model, upstream) => {
    expect(resolveKiroModel(model).upstream).toBe(upstream);
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("puts the repaired id on the wire from %s requests", (source) => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const out = translateRequest(source, FORMATS.KIRO, "claude-sonnet.5", body, true, {}, "kiro");

    expect(out.conversationState.currentMessage.userInputMessage.modelId).toBe("claude-sonnet-5");
  });
});
