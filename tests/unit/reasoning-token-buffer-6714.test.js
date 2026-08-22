import { describe, expect, it, vi } from "vitest";

import {
  getExplicitModelOutputCap,
  REASONING_BUFFER_MIN_TRIGGER,
  resolveReasoningBufferedMaxTokens,
  toPositiveInteger,
} from "../../open-sse/services/reasoningTokenBuffer.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import {
  MODEL_CAPABILITIES,
  PROVIDER_CAPABILITIES,
} from "../../open-sse/providers/capabilities.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };
// A real combo success carries content; an empty 200 body now triggers the
// empty-body retry (#2689), so use a minimal non-empty body here.
const okResponse = () => new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 });
const errorResponse = () => new Response(null, { status: 503 });


describe("reasoning token buffer (#6714)", () => {
  it("resolves only explicit caps in provider, registry, static order", () => {
    expect(getExplicitModelOutputCap("codebuddy-cn/glm-5.2")).toBe(48000);
    expect(getExplicitModelOutputCap("glmt/glm-5.2")).toBe(131072);
    expect(getExplicitModelOutputCap("charm-hyper/glm-5.2")).toBe(131072);
    expect(getExplicitModelOutputCap("unknown/glm-5.2")).toBe(131072);
    expect(getExplicitModelOutputCap("unknown/minimax-m3-pattern-only-6714")).toBeNull();
  });
  it("falls through malformed provider and registry cap tiers", () => {
    const provider = "cap-tier-provider-6714";
    const providerModel = "malformed-provider-6714";
    const registryModel = "malformed-registry-6714";
    const registryEntry = {
      id: provider,
      models: [
        { id: providerModel, maxOutputTokens: 41000 },
        { id: registryModel, maxOutputTokens: "bad" },
      ],
    };
    const hadProviderCaps = Object.hasOwn(PROVIDER_CAPABILITIES, provider);
    const oldProviderCaps = PROVIDER_CAPABILITIES[provider];
    const hadStaticCaps = Object.hasOwn(MODEL_CAPABILITIES, registryModel);
    const oldStaticCaps = MODEL_CAPABILITIES[registryModel];
    try {
      REGISTRY.push(registryEntry);
      PROVIDER_CAPABILITIES[provider] = {
        [providerModel]: { maxOutput: "bad" },
      };
      MODEL_CAPABILITIES[registryModel] = { maxOutput: 42000 };

      expect(getExplicitModelOutputCap(`${provider}/${providerModel}`)).toBe(41000);
      expect(getExplicitModelOutputCap(`${provider}/${registryModel}`)).toBe(42000);
    } finally {
      const registryIndex = REGISTRY.indexOf(registryEntry);
      if (registryIndex !== -1) REGISTRY.splice(registryIndex, 1);
      if (hadProviderCaps) PROVIDER_CAPABILITIES[provider] = oldProviderCaps;
      else delete PROVIDER_CAPABILITIES[provider];
      if (hadStaticCaps) MODEL_CAPABILITIES[registryModel] = oldStaticCaps;
      else delete MODEL_CAPABILITIES[registryModel];
      vi.restoreAllMocks();
    }
  });

  it("returns exact malformed static caps raw but never buffers with them", () => {
    const model = "malformed-static-cap-6714";
    const hadStaticCaps = Object.hasOwn(MODEL_CAPABILITIES, model);
    const oldStaticCaps = MODEL_CAPABILITIES[model];

    try {
      for (const value of ["bad", 0, -1, NaN, Infinity]) {
        MODEL_CAPABILITIES[model] = { reasoning: true, maxOutput: value };
        expect(getExplicitModelOutputCap(`unknown/${model}`)).toBe(value);
        expect(resolveReasoningBufferedMaxTokens(`unknown/${model}`, 32000)).toBeNull();
      }

      MODEL_CAPABILITIES[model] = { reasoning: true };
      expect(getExplicitModelOutputCap(`unknown/${model}`)).toBeNull();
      expect(resolveReasoningBufferedMaxTokens(`unknown/${model}`, 32000)).toBeNull();
    } finally {
      if (hadStaticCaps) MODEL_CAPABILITIES[model] = oldStaticCaps;
      else delete MODEL_CAPABILITIES[model];
      vi.restoreAllMocks();
    }
  });

  it("resolves exact static thinking support", () => {
    expect(resolveReasoningBufferedMaxTokens("unknown/glm-5.2", 32000)).toBe(48000);
  });

  it("honors explicit reasoning denial before exact static support", () => {
    expect(resolveReasoningBufferedMaxTokens("antigravity/claude-sonnet-4-6", 32000)).toBeNull();
  });

  it("honors synthetic provider reasoning denial with an explicit output cap", () => {
    const provider = "cap-tier-provider-6714";
    const hadProviderCaps = Object.hasOwn(PROVIDER_CAPABILITIES, provider);
    const oldProviderCaps = PROVIDER_CAPABILITIES[provider];

    try {
      PROVIDER_CAPABILITIES[provider] = {
        "denied-reasoning-6714": { reasoning: false, maxOutput: 131072 },
      };

      expect(resolveReasoningBufferedMaxTokens(
        `${provider}/denied-reasoning-6714`,
        32000,
      )).toBeNull();
    } finally {
      if (hadProviderCaps) PROVIDER_CAPABILITIES[provider] = oldProviderCaps;
      else delete PROVIDER_CAPABILITIES[provider];
      vi.restoreAllMocks();
    }
  });


  it("returns null when thinking support is unknown", () => {
    expect(resolveReasoningBufferedMaxTokens("unknown/totally-fictitious-6714", 32000)).toBeNull();
  });

  it("does not infer thinking support from capability patterns", () => {
    expect(getExplicitModelOutputCap("gitlawb/mimo-v2.5")).toBe(131072);
    expect(resolveReasoningBufferedMaxTokens("gitlawb/mimo-v2.5", 32000)).toBeNull();
  });

  it("accepts numeric strings and fractions by flooring", () => {
    expect(toPositiveInteger("32000.9")).toBe(32000);
    expect(toPositiveInteger(32000.9)).toBe(32000);
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", "32000.9")).toBe(48000);
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", 32000.9)).toBe(48000);
  });

  it("rejects values outside the source type guard", () => {
    for (const value of [true, [], [1], { valueOf: () => 1 }, "", "   "]) {
      expect(toPositiveInteger(value)).toBeNull();
    }
  });

  it("honors probe threshold and enabled=false", () => {
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", 1)).toBe(1);
    expect(resolveReasoningBufferedMaxTokens(
      "glmt/glm-5.2",
      REASONING_BUFFER_MIN_TRIGGER - 1,
    )).toBe(REASONING_BUFFER_MIN_TRIGGER - 1);
    expect(resolveReasoningBufferedMaxTokens(
      "glmt/glm-5.2",
      REASONING_BUFFER_MIN_TRIGGER,
    )).toBe(1256);
    expect(resolveReasoningBufferedMaxTokens(
      "glmt/glm-5.2",
      32000,
      { enabled: false },
    )).toBeNull();
  });

  it("keeps current tokens when buffering would exceed an explicit cap", () => {
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", 87381)).toBe(131072);
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", 130000)).toBe(130000);
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", 131072)).toBe(131072);
    expect(resolveReasoningBufferedMaxTokens("glmt/glm-5.2", 131073)).toBe(131072);
  });

  it("returns null when no explicit cap exists", () => {
    expect(getExplicitModelOutputCap("unknown/qwen-fake-6714")).toBeNull();
    expect(resolveReasoningBufferedMaxTokens("unknown/qwen-fake-6714", 32000)).toBeNull();
    expect(resolveReasoningBufferedMaxTokens("unknown/qwen-fake-6714", 1)).toBeNull();
  });

  it("isolates max_tokens buffering across fallback attempts", async () => {
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 45000 };
    const attempts = [];
    const handleSingleModel = vi.fn(async (attemptBody, model) => {
      attempts.push(attemptBody);
      return model === "codebuddy-cn/glm-5.2" ? errorResponse() : okResponse();
    });

    await handleComboChat({
      body,
      models: ["codebuddy-cn/glm-5.2", "glmt/glm-5.2"],
      handleSingleModel,
      log,
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(attempts.map((attempt) => attempt.max_tokens)).toEqual([45000, 67500]);
    expect(attempts[0]).toBe(body);
    expect(attempts[1]).not.toBe(body);
    expect(attempts[1]).not.toBe(attempts[0]);
    expect(body.max_tokens).toBe(45000);
  });
});
