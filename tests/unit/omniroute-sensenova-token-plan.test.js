import { describe, it, expect } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

function getEntry() {
  const entry = REGISTRY.find((p) => p.id === "sensenova");
  expect(entry, "sensenova should be registered").toBeTruthy();
  return entry;
}

describe("OmniRoute #6330 — SenseNova Token Plan support", () => {
  it("points SenseNova at the Token Plan chat-completions endpoint", () => {
    const entry = getEntry();
    expect(entry.transport.baseUrl).toBe(
      "https://token.sensenova.cn/v1/chat/completions",
    );
  });

  it("clamps request max_tokens to 65536 at the provider level", () => {
    const entry = getEntry();
    expect(entry.transport.requestDefaults).toEqual({ maxTokens: 65536 });
  });

  it("exposes only the three validated Token Plan chat models", () => {
    const entry = getEntry();
    const modelIds = entry.models.map((m) => m.id);
    expect(modelIds).toEqual([
      "sensenova-6.7-flash-lite",
      "deepseek-v4-flash",
      "glm-5.2",
    ]);
  });

  it("does not expose removed legacy SenseNova / SenseChat models", () => {
    const entry = getEntry();
    const modelIds = new Set(entry.models.map((m) => m.id));
    const removed = [
      "SenseNova-V6.5-Pro",
      "SenseNova-V6.5-Turbo",
      "SenseChat-5",
      "SenseChat-5-Cantonese",
      "SenseChat-Turbo",
      "SenseChat-Vision",
      "SenseChat-Character",
      "sensechat",
    ];
    for (const id of removed) {
      expect(modelIds.has(id), `${id} should not be present`).toBe(false);
    }
  });

  it("sets vision and tool support on sensenova-6.7-flash-lite", () => {
    const model = getEntry().models.find((m) => m.id === "sensenova-6.7-flash-lite");
    expect(model).toMatchObject({
      contextLength: 262144,
      maxOutputTokens: 65536,
      supportsVision: true,
      toolCalling: true,
    });
  });

  it("sets reasoning and reasoning_content interleave on deepseek-v4-flash", () => {
    const model = getEntry().models.find((m) => m.id === "deepseek-v4-flash");
    expect(model).toMatchObject({
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    });
  });

  it("sets reasoning and reasoning_content interleave on glm-5.2", () => {
    const model = getEntry().models.find((m) => m.id === "glm-5.2");
    expect(model).toMatchObject({
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    });
  });

  it("capability layer reflects Token Plan model overrides", () => {
    const flashLite = getCapabilitiesForModel(
      "sensenova",
      "sensenova-6.7-flash-lite",
    );
    expect(flashLite.vision).toBe(true);
    expect(flashLite.contextWindow).toBe(262144);
    expect(flashLite.maxOutput).toBe(65536);

    const deepSeek = getCapabilitiesForModel("sensenova", "deepseek-v4-flash");
    expect(deepSeek.reasoning).toBe(true);
    expect(deepSeek.contextWindow).toBe(1048576);
    expect(deepSeek.maxOutput).toBe(65536);

    const glm = getCapabilitiesForModel("sensenova", "glm-5.2");
    expect(glm.reasoning).toBe(true);
    expect(glm.contextWindow).toBe(1048576);
    expect(glm.maxOutput).toBe(65536);
  });

  it("DefaultExecutor applies the 65536 max_tokens ceiling when missing", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = { model: "sensenova-6.7-flash-lite", messages: [] };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect(body.max_tokens).toBe(65536);
  });

  it("DefaultExecutor leaves an explicit max_tokens value untouched", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = {
      model: "sensenova-6.7-flash-lite",
      messages: [],
      max_tokens: 8192,
    };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect(body.max_tokens).toBe(8192);
  });
});
