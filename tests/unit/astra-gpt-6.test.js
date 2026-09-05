import { describe, it, expect } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getPricingForModel, calculateCostFromTokens } from "../../open-sse/providers/pricing.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getDefaultModel } from "../../open-sse/config/providerModels.js";
import openaiRegistry from "../../open-sse/providers/registry/openai.js";
import codexRegistry from "../../open-sse/providers/registry/codex.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { fallbackConnectionModels } from "../../src/app/(dashboard)/dashboard/cli-tools/connectionModels.js";

// GPT-6 Astra: direct OpenAI API is 1.05M context / 922K input / 128K output;
// Codex serves own 272K context with no published output ceiling. Sources:
// developers.openai.com/api/docs/models/gpt-6-astra; pinned openai/codex
// models.json at commit 3921a30.
describe("GPT-6 Astra provider limits", () => {
  it("direct OpenAI API resolves published limits, image input, and web search", () => {
    const caps = getCapabilitiesForModel("openai", "gpt-6-astra");
    expect(caps.contextWindow).toBe(1050000);
    expect(caps.maxInput).toBe(922000);
    expect(caps.maxOutput).toBe(128000);
    expect(caps.vision).toBe(true);
    expect(caps.search).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("Codex keeps only its published capability limits", () => {
    for (const provider of ["codex", "cx"]) {
      const caps = getCapabilitiesForModel(provider, "gpt-6-astra");
      expect(caps.contextWindow).toBe(272000);
      expect(caps.maxOutput).toBeUndefined();
      expect(caps.maxInput).toBeUndefined();
      expect(caps.vision).toBe(true);
      expect(caps.search).toBe(false);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingCanDisable).toBe(false);
    }
  });

  it("is a registered built-in default model for both OpenAI and Codex", () => {
    expect(openaiRegistry.models[0].id).toBe("gpt-6-astra");
    expect(codexRegistry.models[0].id).toBe("gpt-6-astra");
    expect(getDefaultModel("openai")).toBe("gpt-6-astra");
    expect(getDefaultModel("codex")).toBe("gpt-6-astra");
    expect(getDefaultModel("cx")).toBe("gpt-6-astra");
  });
});

describe("GPT-6 Astra reasoning effort levels", () => {
  it("direct API accepts low/medium/high/xhigh/max but not ultra", () => {
    const levels = getThinkingLevels("openai", "gpt-6-astra");
    expect(levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(levels).not.toContain("ultra");
  });

  it("Codex accepts the extra ultra alias on top of the API set", () => {
    for (const provider of ["codex", "cx"]) {
      expect(getThinkingLevels(provider, "gpt-6-astra")).toEqual([
        "low", "medium", "high", "xhigh", "max", "ultra",
      ]);
    }
  });
});

describe("GPT-6 Astra unsupported effort wire clamping", () => {
  it.each(["none", "minimal"])("applies %s as low through applyThinking", (effort) => {
    const body = { reasoning_effort: effort };
    applyThinking("openai", "gpt-6-astra", body, "openai");
    expect(body.reasoning_effort).toBe("low");
  });

  it.each(["none", "minimal"])("applies Codex client %s as low through executor", (effort) => {
    const body = new CodexExecutor().transformRequest("gpt-6-astra", {
      model: "gpt-6-astra", input: "hi", reasoning_effort: effort,
    }, true, {});
    expect(body.reasoning.effort).toBe("low");
  });

  it("preserves Astra max through applyThinking and Codex executor", () => {
    const direct = { reasoning_effort: "max" };
    applyThinking("openai", "gpt-6-astra", direct, "openai");
    const codex = new CodexExecutor().transformRequest("gpt-6-astra", {
      model: "gpt-6-astra", input: "hi", reasoning_effort: "max",
    }, true, {});
    expect(direct.reasoning_effort).toBe("max");
    expect(codex.reasoning.effort).toBe("max");
  });
});

describe("GPT-6 Astra Codex default effort", () => {
  it("keeps Codex executor's effective low fallback without Astra metadata", () => {
    const body = new CodexExecutor().transformRequest("gpt-6-astra", {
      model: "gpt-6-astra", input: "hi",
    }, true, {});
    expect(body.reasoning.effort).toBe("low");
  });
});

describe("GPT-6 Astra pricing tiers", () => {
  it("standard tier prices at the published per-million rates", () => {
    const pricing = getPricingForModel("openai", "gpt-6-astra");
    expect(pricing).toMatchObject({ input: 10, cached: 1, cache_creation: 12.5, output: 50 });
  });

  it("charges standard rates at or under the 272K long-context threshold", () => {
    const pricing = getPricingForModel("openai", "gpt-6-astra");
    const cost = calculateCostFromTokens({ prompt_tokens: 272000, completion_tokens: 1000 }, pricing);
    expect(cost).toBeCloseTo(272000 * (10 / 1e6) + 1000 * (50 / 1e6), 6);
  });

  it("doubles all input/cache rates and 1.5x's output above the 272K threshold", () => {
    const pricing = getPricingForModel("openai", "gpt-6-astra");
    const tokens = { prompt_tokens: 300000, cached_tokens: 100000, cache_creation_input_tokens: 50000, completion_tokens: 1000, reasoning_tokens: 400 };
    const cost = calculateCostFromTokens(tokens, pricing);
    const expected = 150000 * (20 / 1e6) + 100000 * (2 / 1e6) + 50000 * (25 / 1e6) + 600 * (75 / 1e6) + 400 * (75 / 1e6);
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("does not invent a Codex billing override", () => {
    expect(getPricingForModel("codex", "gpt-6-astra")).toBeNull();
  });
});

describe("GPT-6 Astra request sanitization", () => {
  it("strips unsupported sampling and Chat logprob controls on the direct API", () => {
    const body = { temperature: 0.7, top_p: 0.9, top_logprobs: 3, logprobs: true, messages: [] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body).toEqual({ messages: [] });
  });

  it("drops only the message.output_text.logprobs Responses include entry", () => {
    const body = { include: ["reasoning.encrypted_content", "message.output_text.logprobs"] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("removes include entirely when it becomes empty", () => {
    const body = { include: ["message.output_text.logprobs"] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body.include).toBeUndefined();
  });

  it("does not strip Chat-only logprobs from a Responses-shaped body", () => {
    const body = { logprobs: true, input: [] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body).toEqual({ logprobs: true, input: [] });
  });

  it("leaves unrelated OpenAI models' sampling params untouched", () => {
    const body = { temperature: 0.7, top_p: 0.9 };
    stripUnsupportedParams("openai", "gpt-5.6", body);
    expect(body).toEqual({ temperature: 0.7, top_p: 0.9 });
  });
});

describe("GPT-6 Astra final OpenAI request path", () => {
  it("strips Chat logprobs through DefaultExecutor", () => {
    const body = new DefaultExecutor("openai").transformRequest("gpt-6-astra", {
      messages: [{ role: "user", content: "hi" }], logprobs: true, top_logprobs: 2,
    });
    expect(body.logprobs).toBeUndefined();
    expect(body.top_logprobs).toBeUndefined();
  });
});

// Registry default only affects new connections and the picker suggestion.
// Existing connection.defaultModel remains source of truth for that connection.
describe("GPT-6 Astra registry default preserves saved connections", () => {
  it("keeps a saved prior default model in connection model fallback", () => {
    const savedConnection = { defaultModel: "gpt-5.6", providerSpecificData: {} };
    expect(fallbackConnectionModels(savedConnection)).toEqual([
      { id: "gpt-5.6", name: "gpt-5.6" },
    ]);
    expect(savedConnection).toEqual({ defaultModel: "gpt-5.6", providerSpecificData: {} });
  });
});
