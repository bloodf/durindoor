import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("getCapabilitiesForModel", () => {
  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("maps Fable-5 to claude-adaptive thinking format", () => {
    expect(getCapabilitiesForModel("claude", "claude-fable-5")).toMatchObject({ reasoning: true, thinkingFormat: "claude-adaptive" });
    expect(getCapabilitiesForModel("claude", "claude-mythos-5")).toMatchObject({ reasoning: true, thinkingFormat: "claude-adaptive" });
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("reports Kiro Claude Sonnet 5 as a 1M adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-agentic")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking-agentic")).toMatchObject(claudeSonnet5Expected);
  });

  // decolua/9router#2596 — every Kiro GPT-5.6 synthetic variant resolves the
  // family's 272k context / 128k output / OpenAI thinking under both provider
  // keys, and a vendor-prefixed id ("openai/gpt-5.6-sol") hits the same
  // provider override as the bare id.
  const kiroGpt56Expected = {
    contextWindow: 272000,
    maxOutput: 128000,
    thinkingFormat: "openai",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("reports Kiro GPT 5.6 models with the Kiro 272k context window", () => {
    // Representative ids across all 3 tiers and all 4 suffix shapes — the
    // exact 12-id contract is pinned in kiro-model-slots.test.js.
    for (const provider of ["kiro", "kr"]) {
      for (const id of [
        "gpt-5.6-sol",
        "gpt-5.6-sol-thinking",
        "gpt-5.6-terra-agentic",
        "gpt-5.6-terra-thinking-agentic",
        "gpt-5.6-luna",
        "gpt-5.6-luna-thinking",
      ]) {
        expect(getCapabilitiesForModel(provider, id), `${provider}/${id}`).toMatchObject(kiroGpt56Expected);
      }
      expect(getCapabilitiesForModel(provider, "openai/gpt-5.6-sol"), `${provider} prefixed`).toMatchObject(kiroGpt56Expected);
    }
  });

  it("uses OpenAI thinking format for NVIDIA-hosted reasoning model families", () => {
    for (const model of [
      "z-ai/glm-5.2",
      "deepseek-ai/deepseek-v4-pro",
      "deepseek-ai/deepseek-v4-flash",
      "moonshotai/kimi-k2.6",
      "nvidia/nemotron-3-nano-30b-a3b",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "qwen/qwen3.5-122b-a10b",
      "stepfun-ai/step-3.7-flash",
    ]) {
      expect(getCapabilitiesForModel("nvidia", model)).toMatchObject({
        reasoning: true,
        thinkingFormat: "openai",
      });
    }
  });

  it("translates NVIDIA reasoning intent to reasoning_effort instead of vendor-native thinking fields", () => {
    const out = translateRequest(
      "openai",
      "openai",
      "mistralai/mistral-medium-3.5-128b",
      {
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        reasoning_effort: "high",
      },
      false,
      null,
      "nvidia",
    );

    expect(out.reasoning_effort).toBe("high");
    expect(out.enable_thinking).toBeUndefined();
    expect(out.thinking).toBeUndefined();
    expect(out.thinking_budget).toBeUndefined();
  });
});

describe("getCapabilitiesForModel — ZenMux / TokenRouter provider overrides", () => {
  it("preserves vision for advertised ZenMux glm-4.6v-flash model despite text-only *glm-4* pattern", () => {
    expect(getCapabilitiesForModel(null, "z-ai/glm-4.6v-flash").vision).toBe(false);
    expect(getCapabilitiesForModel("zenmux", "z-ai/glm-4.6v-flash")).toMatchObject({ vision: true });
  });

  it("does not leak ZenMux vision override onto other providers or GLM models", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "z-ai/glm-4.6v-flash").vision).toBe(false);
    expect(getCapabilitiesForModel("zenmux", "z-ai/glm-5.2").vision).toBe(false);
  });

  it("exposes openai thinkingFormat on the built ZenMux provider transport", () => {
    expect(PROVIDERS.zenmux?.thinkingFormat).toBe("openai");
  });

  it("forces openai thinking format for TokenRouter's DeepSeek reasoning models", () => {
    // registry transport.thinkingFormat: "openai" takes priority over PATTERN_CAPABILITIES'
    // *deepseek* -> thinkingFormat: "deepseek" fallback (verified via resolveFormat in
    // translator/concerns/thinkingUnified.js, exercised through translateRequest below).
    const out = translateRequest(
      "openai",
      "openai",
      "deepseek-v4-pro",
      {
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        reasoning_effort: "high",
      },
      false,
      null,
      "tokenrouter",
    );

    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
    expect(out.enable_thinking).toBeUndefined();
  });
});

describe("getCapabilitiesForModel — MiMo (<think>-tag reasoning, always-on)", () => {
  it("mimo-v2.5 has vision + reasoning + deepseek format, cannot disable", () => {
    const caps = getCapabilitiesForModel(null, "mimo-v2.5");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("mimo-v2.5-pro has vision (matches *mimo*v2.5* pattern)", () => {
    const caps = getCapabilitiesForModel(null, "mimo-v2.5-pro");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("xiaomi/mimo-v2.5-pro (vendor-prefixed) has vision", () => {
    const caps = getCapabilitiesForModel("commandcode", "xiaomi/mimo-v2.5-pro");
    expect(caps.vision).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
  });

  it("mimo-omni-x has audioInput via the omni pattern", () => {
    const caps = getCapabilitiesForModel(null, "mimo-omni-x");
    expect(caps.vision).toBe(true);
    expect(caps.audioInput).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("generic mimo has vision + reasoning (fallback pattern)", () => {
    const caps = getCapabilitiesForModel(null, "mimo");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });
});

describe("getCapabilitiesForModel — Qwen max/plus vision", () => {
  it("qwen3.7-max has vision (*qwen*max* fires before *qwen3.7*)", () => {
    const caps = getCapabilitiesForModel(null, "qwen3.7-max");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
  });

  it("Qwen3.6-Max-Preview has vision (case-insensitive pattern match)", () => {
    const caps = getCapabilitiesForModel("commandcode", "Qwen3.6-Max-Preview");
    expect(caps.vision).toBe(true);
  });

  it("qwen3.7-plus has vision", () => {
    const caps = getCapabilitiesForModel(null, "qwen3.7-plus");
    expect(caps.vision).toBe(true);
  });

  it("qwen3.7 has vision from the qwen3.7 pattern", () => {
    const caps = getCapabilitiesForModel(null, "qwen3.7");
    expect(caps.vision).toBe(true);
  });

  it("qwq has no vision (thinking-only model)", () => {
    const caps = getCapabilitiesForModel(null, "qwq-32b");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });
});

describe("getCapabilitiesForModel — OpenCode Zen", () => {
  it("Big Pickle reports reasoning via provider override", () => {
    const caps = getCapabilitiesForModel("opencode-zen", "big-pickle");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.thinkingCanDisable).toBe(true);
  });
});


describe("getCapabilitiesForModel — MiniMax M2.x vision", () => {
  it("minimax-m2.7 has vision", () => {
    const caps = getCapabilitiesForModel(null, "minimax-m2.7");
    expect(caps.vision).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("minimax-m2.5 has vision", () => {
    const caps = getCapabilitiesForModel(null, "minimax-m2.5");
    expect(caps.vision).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("MiniMax-M2.7 has vision (vendor prefix MiniMaxAI/ stripped by route)", () => {
    const caps = getCapabilitiesForModel("commandcode", "MiniMax-M2.7");
    expect(caps.vision).toBe(true);
  });

  it("minimax-m3 has vision (separate pattern)", () => {
    const caps = getCapabilitiesForModel(null, "minimax-m3");
    expect(caps.vision).toBe(true);
  });
});

describe("getCapabilitiesForModel — DeepSeek V4 text-only", () => {
  it("deepseek-v4-pro has no vision", () => {
    const caps = getCapabilitiesForModel(null, "deepseek-v4-pro");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
  });

  it("deepseek-v4-flash has no vision", () => {
    const caps = getCapabilitiesForModel(null, "deepseek-v4-flash");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
  });

  it("deepseek/deepseek-v4-pro (vendor-prefixed) has no vision", () => {
    const caps = getCapabilitiesForModel(null, "deepseek/deepseek-v4-pro");
    expect(caps.vision).toBe(false);
  });
});

describe("getCapabilitiesForModel — HuggingChat text-only", () => {
  it("huggingchat registry has no models flagged with supportsVision", () => {
    const models = PROVIDER_MODELS.huggingchat || [];
    const visionModels = models.filter((m) => m.supportsVision);
    expect(visionModels).toEqual([]);
  });

  it("every HuggingChat model resolves as vision:false", () => {
    const models = PROVIDER_MODELS.huggingchat || [];
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      const caps = getCapabilitiesForModel("huggingchat", model.id);
      expect(caps.vision, `${model.id} should be text-only`).toBe(false);
    }
  });

  it("huggingchat vision-named model still resolves as vision:false", () => {
    const caps = getCapabilitiesForModel("huggingchat", "CohereLabs/command-a-vision-07-2025");
    expect(caps.vision).toBe(false);
  });

  it("same model id without provider still has vision via pattern match", () => {
    const caps = getCapabilitiesForModel(null, "command-a-vision-07-2025");

    expect(caps.vision).toBe(true);
  });
});

describe("getCapabilitiesForModel — simple provider vision/thinking overrides", () => {
  it("preserves vision for SenseNova sensenova-6.7-flash-lite", () => {
    const caps = getCapabilitiesForModel("sensenova", "sensenova-6.7-flash-lite");
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(262144);
  });
  it("preserves reasoning for SenseNova deepseek-v4-flash", () => {
    const caps = getCapabilitiesForModel("sensenova", "deepseek-v4-flash");
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1048576);
  });
  it("preserves reasoning for SenseNova glm-5.2", () => {
    const caps = getCapabilitiesForModel("sensenova", "glm-5.2");
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1048576);
  });

  it("preserves vision and reasoning for StepFun step-1o-turbo-vision", () => {
    const caps = getCapabilitiesForModel("stepfun", "step-1o-turbo-vision");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("step");
    expect(caps.contextWindow).toBe(32768);
  });

  it("preserves vision and reasoning for Tencent hunyuan-vision", () => {
    const caps = getCapabilitiesForModel("tencent", "hunyuan-vision");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("hunyuan");
  });

  it("keeps Upstage solar-pro3 text-only despite o3 substring", () => {
    // The global *o3* pattern would match "pro3" and incorrectly mark this as vision-capable.
    expect(getCapabilitiesForModel(null, "solar-pro3").vision).toBe(true);
    const caps = getCapabilitiesForModel("upstage", "solar-pro3");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
  });

  it("marks StepFun step-3.7-flash as vision-capable", () => {
    const caps = getCapabilitiesForModel("stepfun", "step-3.7-flash");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("step");
  });

  it("marks Reka Edge 2603 as vision-capable", () => {
    const caps = getCapabilitiesForModel("reka", "reka-edge-2603");
    expect(caps.vision).toBe(true);
  });

  it("keeps ZenMux Grok 4.1 Fast text-only", () => {
    const caps = getCapabilitiesForModel("zenmux", "x-ai/grok-4.1-fast");
    expect(caps.vision).toBe(false);
  });

  it("marks v0-1.5-md and v0-1.5-lg as vision-capable", () => {
    expect(getCapabilitiesForModel("v0-vercel", "v0-1.5-md").vision).toBe(true);
    expect(getCapabilitiesForModel("v0-vercel", "v0-1.5-lg").vision).toBe(true);
  });

  it("marks Qianfan ERNIE multimodal models as vision-capable", () => {
    expect(getCapabilitiesForModel("qianfan", "ernie-5.1").vision).toBe(true);
    expect(getCapabilitiesForModel("qianfan", "ernie-5.0-thinking-latest").vision).toBe(true);
    expect(getCapabilitiesForModel("qianfan", "ernie-x1.1").vision).toBe(true);
  });
});

describe("getCapabilitiesForModel — codebuddy-cn provider overrides", () => {
  it("deepseek-v4-pro via codebuddy-cn uses openai thinking format, cannot disable", () => {
    const caps = getCapabilitiesForModel("codebuddy-cn", "deepseek-v4-pro");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("minimax-m2.7 via codebuddy-cn has vision (provider override)", () => {
    const caps = getCapabilitiesForModel("codebuddy-cn", "minimax-m2.7");
    expect(caps.vision).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("unknown provider falls through to pattern matching", () => {
    const caps = getCapabilitiesForModel("unknown-provider", "mimo-v2.5");
    expect(caps.vision).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
  });
});
