import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const schema = { type: "object", properties: { color: { type: "string" } }, required: ["color"], additionalProperties: false };

describe("vendor capability parity", () => {
  it("keeps a native Claude JSON schema while normalizing adaptive reasoning", () => {
    const result = translateRequest("openai", "claude", "claude-sonnet-5-5", {
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "Identify the color" }],
      reasoning_effort: "high",
      response_format: { type: "json_schema", json_schema: { name: "color", strict: true, schema } },
    }, false, { apiKey: "fixture-key" }, "anthropic");
    expect(result.output_config.format).toEqual({ type: "json_schema", schema });
    expect(result.output_config.effort).toBe("high");
  });

  it("preserves a native video input on a MiniMax multimodal request", () => {
    const video = { type: "video_url", video_url: { url: "mm_file://fixture", fps: 2 } };
    const result = translateRequest("openai", "openai", "MiniMax-M3.1-Flash-Preview", {
      model: "MiniMax-M3.1-Flash-Preview",
      messages: [{ role: "user", content: [{ type: "text", text: "Summarize this video" }, video] }],
      reasoning_effort: "max",
    }, false, { apiKey: "fixture-key" }, "minimax");
    expect(result.messages[0].content).toContainEqual(video);
    expect(result.reasoning_effort).toBe("max");
    expect(result.thinking).toEqual({ type: "adaptive" });
  });

  it("does not give generation models chat tools or fabricated token ceilings", () => {
    expect(getCapabilitiesForModel("minimax", "image-01")).toMatchObject({ vision: true, imageOutput: true, tools: false, reasoning: false, contextWindow: null, maxOutput: null });
    expect(getCapabilitiesForModel("minimax", "speech-2.8-hd")).toMatchObject({ audioOutput: true, tools: false, reasoning: false, contextWindow: null, maxOutput: null });
    expect(getCapabilitiesForModel("minimax", "MiniMax-H3")).toMatchObject({ videoOutput: true, tools: false, reasoning: false, contextWindow: null, maxOutput: null });
  });

  it("resolves a multi-agent request alias to the same capability and token limits", () => {
    const caps = getCapabilitiesForModel("xai", "grok-4.20-multi-agent-latest");
    const limits = resolveModelLimits("xai", "grok-4.20-multi-agent-latest");
    expect(caps.contextWindow).toBe(1000000);
    expect(limits.contextWindow).toBe(caps.contextWindow);
    expect(limits.maxOutput).toBeUndefined();
  });

  it("keeps unknown restricted-model limits unknown instead of matching a family glob", () => {
    const limits = resolveModelLimits("anthropic", "claude-mythos-preview");
    expect(limits).toMatchObject({ known: false, source: "provider" });
    expect(limits.contextWindow).toBeUndefined();
    expect(limits.maxOutput).toBeUndefined();
  });

  it("keeps the authenticated OAuth window separate from the direct API window", () => {
    expect(resolveModelLimits("anthropic", "claude-sonnet-4-5-20250929").contextWindow).toBe(200000);
    expect(resolveModelLimits("claude", "claude-sonnet-4-5-20250929").contextWindow).toBe(1000000);
  });
});
