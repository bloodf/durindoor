import { describe, expect, it } from "vitest";
import {
  getCapabilitiesForModel,
  resolveModelLimits,
} from "../../open-sse/providers/capabilities.js";

describe("context-window sanity", () => {
  it.each([
    "@cf/qwen/qwen2.5-coder-32b-instruct",
    "cf/@cf/qwen/qwen2.5-coder-32b-instruct",
  ])("uses Cloudflare's published 32K window for %s", (model) => {
    expect(getCapabilitiesForModel("cf", model).contextWindow).toBe(32768);
    expect(resolveModelLimits("cf", model)).toMatchObject({
      contextWindow: 32768,
      known: true,
    });
  });

  it.each(["MiniMax-M2", "MiniMax-M2.1"])(
    "%s uses MiniMax's published 204800-token window",
    (model) => {
      expect(getCapabilitiesForModel("minimax", model).contextWindow).toBe(204800);
      expect(resolveModelLimits("minimax", model).contextWindow).toBe(204800);
    },
  );

  it.each(["gpt-5.5-medium", "gpt-5.5-high", "gpt-5.5-xhigh"])(
    "cx/%s inherits the tighter ChatGPT subscription window",
    (model) => {
      // Source: chatgpt.com/backend-api/codex/models; this does not change the
      // direct OpenAI API's separately-tested 1.05M contract.
      expect(getCapabilitiesForModel("cx", model).contextWindow).toBe(272000);
      expect(resolveModelLimits("cx", model).contextWindow).toBe(272000);
    },
  );

  it("does not advertise chat limits for an Ollama embedding model", () => {
    const model = "nomic-embed-text:latest";
    expect(getCapabilitiesForModel("ollama-local", model).contextWindow).toBeNull();
    expect(resolveModelLimits("ollama-local", model).known).toBe(false);
  });

  it.each(["gpt-5.4-mini", "gpt-5.4-nano"])(
    "keeps openai/%s at its published 400K window",
    (model) => {
      expect(getCapabilitiesForModel("openai", model).contextWindow).toBe(400000);
    },
  );
});
