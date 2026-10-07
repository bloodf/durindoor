import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

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
    const limits = resolveModelLimits("openai", "gpt-rosalind-research");
    expect(limits).toMatchObject({ known: false, source: "provider" });
    expect(limits.contextWindow).toBeUndefined();
    expect(limits.maxOutput).toBeUndefined();
  });

  it("keeps the authenticated OAuth window separate from the direct API window", () => {
    expect(resolveModelLimits("anthropic", "claude-sonnet-4-5-20250929").contextWindow).toBe(200000);
    expect(resolveModelLimits("claude", "claude-sonnet-4-5-20250929").contextWindow).toBe(1000000);
  });

  it("retains Codex image input without promoting its text-only Spark variant", () => {
    expect(getCapabilitiesForModel("codex", "gpt-5.3-codex-high").vision).toBe(true);
    expect(getCapabilitiesForModel("cx", "gpt-5.3-codex-spark").vision).toBe(false);
  });

  it("recognizes verified GPT-6 models on compatible routes without replacing live limits", () => {
    expect(getCapabilitiesForModel("openai-compatible-test", "gpt-6.1-sol")).toMatchObject({
      vision: true, structuredOutput: true, promptCaching: true,
      contextWindow: 1050000, maxOutput: 128000,
    });
    expect(resolveModelLimits("openai-compatible-test", "gpt-6.1-sol", null, null, {
      contextWindow: 262144, maxOutput: 32000,
    })).toMatchObject({ contextWindow: 262144, maxOutput: 32000, source: "live" });
  });

  it.each(["minimax", "minimax-cn"])("advertises only native Flash Preview modalities on %s", (provider) => {
    const caps = getCapabilitiesForModel(provider, "MiniMax-M3.1-Flash-Preview");
    expect(caps).toMatchObject({
      contextWindow: 1000000, maxOutput: null, vision: true, videoInput: true,
      audioInput: false, imageOutput: false, audioOutput: false, videoOutput: false,
      tools: true, reasoning: true, thinkingCanDisable: false,
      thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(resolveModelLimits(provider, "MiniMax-M3.1-Flash-Preview").maxOutput).toBeUndefined();
    expect(resolveModelLimits(provider, "MiniMax-M2").maxOutput).toBe(128000);
    expect(getCapabilitiesForModel(provider, "MiniMax-M2.7")).toMatchObject({
      vision: false, videoInput: false, audioInput: false, tools: true, promptCaching: true,
    });
  });

  it.each(["codex", "cx"])("retains API capacities and separate Codex-only contracts on %s", (provider) => {
    for (const model of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
      expect(getCapabilitiesForModel(provider, `${model}-review`)).toMatchObject({
        contextWindow: 1050000, maxInput: 922000, maxOutput: 128000,
      });
      expect(resolveModelLimits(provider, `${model}-review`)).toMatchObject({
        contextWindow: 1050000, maxOutput: 128000, known: true,
      });
    }
    expect(getCapabilitiesForModel(provider, "gpt-6.1-sol")).toMatchObject({
      contextWindow: 1050000, maxOutput: 128000,
      thinkingEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    });
    expect(resolveModelLimits(provider, "gpt-5.3-codex-high")).toMatchObject({
      contextWindow: 400000, maxOutput: 128000,
    });
    expect(getCapabilitiesForModel(provider, "gpt-5.3-codex-spark")).toMatchObject({
      vision: false, contextWindow: 128000, maxOutput: null,
    });
    expect(resolveModelLimits(provider, "gpt-reserve")).toMatchObject({
      contextWindow: undefined, maxOutput: undefined, known: false,
    });
  });

  it("does not mistake native K3's output default for its published maximum", () => {
    expect(getCapabilitiesForModel("kimi", "kimi-k3")).toMatchObject({
      contextWindow: 1048576, maxOutput: 1048576, defaultOutput: 131072, structuredOutput: true,
      promptCaching: true, videoInput: true, audioInput: false, thinkingCanDisable: false,
    });
    expect(resolveModelLimits("kimi", "kimi-k3")).toMatchObject({
      contextWindow: 1048576, maxOutput: 1048576,
    });
  });

  it("keeps Coding-plan aliases and K3-256k video restrictions separate", () => {
    expect(getCapabilitiesForModel("kimi-coding", "for-coding")).toMatchObject({
      vision: true, videoInput: true, contextWindow: 1048576,
      thinkingEfforts: ["low", "high", "max"], maxOutput: null,
    });
    expect(resolveModelLimits("kimi-coding", "for-coding-highspeed")).toMatchObject({
      contextWindow: 262144, maxOutput: undefined,
    });
    expect(getCapabilitiesForModel("kimi-coding", "k3-256k")).toMatchObject({
      vision: true, videoInput: false, contextWindow: 262144, maxOutput: null,
    });
    expect(resolveModelLimits("kimi-coding", "k3", null, null, {
      contextWindow: 262144,
    }).contextWindow).toBe(262144);
    for (const model of ["k3", "k3-256k", "for-coding", "for-coding-highspeed", "kimi-for-coding", "kimi-for-coding-highspeed"]) {
      const caps = getCapabilitiesForModel("kimi-coding", model);
      expect(caps.maxOutput).toBeNull();
      expect(caps.defaultOutput).toBeUndefined();
    }
  });

  it.each([
    ["grok-4.7-high", 500000, true],
    ["grok-4.6-latest", 500000, true],
    ["grok-4.5-latest", 500000, true],
    ["grok-4.3-latest", 1000000, true],
    ["grok-4.20-non-reasoning", 1000000, false],
    ["grok-code-fast-1", 256000, true],
    ["grok-code-fast-1-0825", 256000, true],
    ["grok-build-latest", 500000, true],
  ])("keeps %s's alias-specific window and JSON/cache capabilities", (model, contextWindow, reasoning) => {
    expect(getCapabilitiesForModel("xai", model)).toMatchObject({
      contextWindow, reasoning, structuredOutput: true, promptCaching: true,
      imageOutput: false, audioInput: false, videoInput: false,
    });
    expect(resolveModelLimits("xai", model)).toMatchObject({
      contextWindow, maxOutput: undefined,
    });
  });

  it("retains verified native metadata when a compatible route has no provider override", () => {
    expect(getCapabilitiesForModel("openai-compatible-test", "MiniMax-M3.1-Flash-Preview")).toMatchObject({
      vision: true, videoInput: true, contextWindow: 1000000, maxOutput: null,
      thinkingCanDisable: false,
    });
    expect(getCapabilitiesForModel("openai-compatible-test", "claude-sonnet-5-5")).toMatchObject({
      structuredOutput: true, promptCaching: true, contextWindow: 1000000, maxOutput: 128000,
    });
    expect(resolveModelLimits("openai-compatible-test", "claude-sonnet-4-5-20250929")).toMatchObject({
      contextWindow: 200000, maxOutput: 64000,
    });
  });

  it("keeps hosted generation tools distinct from native image output", () => {
    const caps = getCapabilitiesForModel("openai", "gpt-6-astra");
    expect(caps.supportedTools).toContain("image_generation");
    expect(caps).toMatchObject({ vision: true, imageOutput: false, audioInput: false, videoInput: false });
  });

  it.each(["gpt-5-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3-mini", "o1"])(
    "retains published prompt caching for %s", (model) => {
      expect(getCapabilitiesForModel("openai", model).promptCaching).toBe(true);
    },
  );

  it("preserves explicit operator keys over live metadata without promoting inherited values", () => {
    const custom = { contextWindow: 160000, maxOutput: 128000, customKeys: new Set(["contextWindow"]) };
    expect(resolveModelLimits("openai", "gpt-6.1-sol", custom, null, {
      contextWindow: 262144, maxOutput: 32000,
    })).toMatchObject({ contextWindow: 160000, maxOutput: 32000, source: "custom" });
    expect(resolveModelLimits("openai", "gpt-6.1-sol", {
      contextWindow: 160000, maxOutput: 24000, customKeys: new Set(["contextWindow", "maxOutput"]),
    }, null, { contextWindow: 262144, maxOutput: 32000 })).toMatchObject({
      contextWindow: 160000, maxOutput: 24000,
    });
  });

  it("keeps strict schema availability snapshot-specific", () => {
    expect(getCapabilitiesForModel("openai", "gpt-4o-2024-05-13").structuredOutput).toBe(false);
    expect(getCapabilitiesForModel("openai", "gpt-4o-2024-08-06").structuredOutput).toBe(true);
  });

  it("distinguishes cache support from cached-token discounts", () => {
    expect(getCapabilitiesForModel("openai", "gpt-5.5-pro")).toMatchObject({
      promptCaching: true, contextWindow: 1050000, maxOutput: 128000,
    });
  });

  it("declares native speech-to-speech modalities and tools", () => {
    expect(getCapabilitiesForModel("xai", "grok-voice-think-fast-2.0")).toMatchObject({
      audioInput: true, audioOutput: true, imageOutput: false, tools: true,
    });
  });

  it("retains a declared output ceiling even when the input window is unknown", () => {
    expect(resolveModelLimits("minimax", "M2-her")).toMatchObject({
      contextWindow: undefined, maxOutput: 2048, known: true, source: "provider",
    });
  });

  it("distinguishes transport defaults from declared model capacity", () => {
    const registry = {
      id: "capacity-fixture",
      transport: { defaultContextLength: 4096 },
      models: [
        { id: "opaque-capacity-model" },
        { id: "gpt-6.1-sol-fixture-snapshot" },
        { id: "declared-capacity-model", contextLength: 8192, maxOutputTokens: 2048 },
        { id: "output-only-capacity-model", maxOutputTokens: 2048 },
      ],
    };
    const find = vi.spyOn(REGISTRY, "find").mockReturnValue(registry);
    try {
      expect(resolveModelLimits(registry.id, "opaque-capacity-model")).toMatchObject({
        contextWindow: undefined, maxOutput: undefined, known: false, source: "default",
      });
      expect(resolveModelLimits(registry.id, "gpt-6.1-sol-fixture-snapshot")).toMatchObject({
        contextWindow: 1050000, maxOutput: 128000, known: true, source: "pattern",
      });
      expect(resolveModelLimits(registry.id, "declared-capacity-model")).toMatchObject({
        contextWindow: 8192, maxOutput: 2048, known: true, source: "registry",
      });
      expect(resolveModelLimits(registry.id, "output-only-capacity-model")).toMatchObject({
        contextWindow: undefined, maxOutput: 2048, known: true, source: "registry",
      });
      expect(resolveModelLimits(registry.id, "declared-capacity-model", {
        contextWindow: 16000, maxOutput: 1000, customKeys: new Set(["contextWindow", "maxOutput"]),
      }, null, { contextWindow: 32000, maxOutput: 4000 })).toMatchObject({
        contextWindow: 16000, maxOutput: 1000, source: "custom",
      });
      expect(resolveModelLimits(registry.id, "opaque-capacity-model", {
        contextWindow: 4096, maxOutput: 64000, customKeys: new Set(),
      }, null, { contextWindow: 32000, maxOutput: 4000 })).toMatchObject({
        contextWindow: 32000, maxOutput: 4000, known: true, source: "live",
      });
    } finally {
      find.mockRestore();
    }
  });

  it("does not manufacture token guarantees for unknown models", () => {
    expect(getCapabilitiesForModel("openai-compatible-test", "opaque-private-model")).toMatchObject({
      contextWindow: null, maxOutput: null,
    });
    expect(resolveModelLimits("openai-compatible-test", "opaque-private-model")).toMatchObject({
      contextWindow: undefined, maxOutput: undefined, known: false, source: "default",
    });
    expect(resolveModelLimits("openai-compatible-test", "gpt-rosalind-research")).toMatchObject({
      contextWindow: undefined, maxOutput: undefined, known: false, source: "exact",
    });
    expect(resolveModelLimits("openai-compatible-test", "opaque-private-model", {
      maxOutput: 24000, customKeys: new Set(["maxOutput"]),
    })).toMatchObject({
      contextWindow: undefined, maxOutput: 24000, known: true, source: "custom",
    });
    expect(resolveModelLimits("ollama-local", "local-model", {
      contextWindow: 200000, maxOutput: 64000, customKeys: new Set(),
    }, null, { contextWindow: 32768, maxOutput: 8192 })).toMatchObject({
      contextWindow: 32768, maxOutput: 8192, source: "live",
    });
  });
});
