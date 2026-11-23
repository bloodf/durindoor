import { describe, expect, it, vi } from "vitest";
import { GeminiInteractionsExecutor } from "../../open-sse/executors/gemini-interactions.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyProviderThinkingOverride, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chat = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/chat/completions/route.js", () => ({
  OPTIONS: vi.fn(), POST: chat,
}));
const { POST } = await import("@/app/api/v1beta/interactions/route.js");
const model = "gemini-4-hydrogen";
const provider = "gemini-interactions";
const executor = new GeminiInteractionsExecutor();
const body = (effort) => ({ messages: [{ role: "user", content: "Hello" }], ...(effort === undefined ? {} : { reasoning_effort: effort }) });
const mapped = (effort, selectedModel = model, selectedProvider = provider) => {
  const request = body(effort);
  applyThinking(FORMATS.OPENAI, selectedModel, request, selectedProvider);
  return executor.transformRequest(selectedModel, request, false);
};

describe("Hydrogen Interactions effort", () => {
  it("pins the route's levels without changing other capabilities or aliases", () => {
    expect(getThinkingLevels(provider, model)).toEqual(["low", "medium", "high", "xhigh"]);
    // Antigravity levels follow its registry tiers, which include xhigh since #5699.
    // Antigravity registers its own Hydrogen xhigh row (#1072); the Interactions route stays separate.
    expect(getThinkingLevels("antigravity", model)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getModelUpstreamId("ag", model)).toBe("gemini-4-hydrogen-high");
    expect(getCapabilitiesForModel(provider, model).maxOutput).toBe(65536);
  });
  it("pins the Antigravity Hydrogen xhigh tier row", () => {
    expect(getThinkingLevels("antigravity", "gemini-4-hydrogen-xhigh")).toEqual(["low", "medium", "high", "xhigh"]);
  });
  it.each(["low", "medium", "high", "xhigh"])("maps %s through normalization and executor", (level) => {
    expect(mapped(level).generation_config).toEqual({ thinking_level: level });
  });
  it("omits absent, automatic and unsupported efforts, and other models", () => {
    for (const value of [undefined, "auto", "none", "minimal", "max", "banana"]) {
      expect(mapped(value)).not.toHaveProperty("generation_config");
    }
    expect(mapped("xhigh", "gemini-3.8-flash")).not.toHaveProperty("generation_config.thinking_level");
    expect(executor.transformRequest(model, { ...body("high"), max_tokens: 123, temperature: 0.5 }, false).generation_config)
      .toEqual({ max_output_tokens: 123, temperature: 0.5, thinking_level: "high" });
  });
  it("keeps explicit client effort ahead of a provider level and honors provider defaults", () => {
    const explicit = applyProviderThinkingOverride(body("xhigh"), { mode: "low" });
    applyThinking(FORMATS.OPENAI, model, explicit, provider);
    expect(executor.transformRequest(model, explicit, false).generation_config.thinking_level).toBe("xhigh");
    const fallback = applyProviderThinkingOverride(body(), { mode: "medium" });
    applyThinking(FORMATS.OPENAI, model, fallback, provider);
    expect(executor.transformRequest(model, fallback, false).generation_config.thinking_level).toBe("medium");
    expect(applyProviderThinkingOverride(body("high"), { mode: "none" })).not.toHaveProperty("reasoning_effort");
  });
  it("validates the public native setting and forwards it as explicit client intent", async () => {
    chat.mockImplementation(async (request) => {
      const payload = await request.json();
      expect(payload.reasoning_effort).toBe("xhigh");
      expect(mapped(payload.reasoning_effort).generation_config.thinking_level).toBe("xhigh");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] });
    });
    const send = (generation_config) => POST(new Request("https://example.test/v1beta/interactions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: "Hello", generation_config }),
    }));
    expect((await send({ thinking_level: "xhigh" })).status).toBe(200);
    expect((await send({ thinking_level: "max" })).status).toBe(400);
    expect((await send({ thinking_level: "high", temperature: 1 })).status).toBe(400);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
