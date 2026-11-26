import { describe, expect, it } from "vitest";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";

describe("OmniRoute #21279 (888e2e1e547e) unlisted OpenAI GPT-6 and GPT-5.6+ models use Responses", () => {
  it("routes ids that the catalog does not list yet, with or without a thinking suffix", () => {
    for (const id of ["gpt-7-sol", "gpt-6.3-sol", "gpt-6.2-sol-high", "gpt-6.2-sol(high)", "gpt-5.7-sol", "gpt-6"]) {
      expect(getModelTargetFormat("openai", id), id).toBe("openai-responses");
    }
  });

  it("sends a Chat Completions client's unlisted model to the Responses endpoint", () => {
    const { targetFormat, runtimeTransport } = resolveRequestTransport({
      provider: "openai", alias: "openai", model: "gpt-7-sol", sourceFormat: "openai",
      credentials: { apiKey: "test-key" },
    });
    expect(targetFormat).toBe("openai-responses");
    expect(runtimeTransport.baseUrl).toBe("https://api.openai.com/v1/responses");
  });

  it("leaves older unlisted ids and other providers alone", () => {
    for (const id of ["gpt-5.5-custom", "gpt-4.2", "gpt-4o", "o9-mini"]) {
      expect(getModelTargetFormat("openai", id), id).toBeNull();
    }
    expect(getModelTargetFormat("openai-compatible-chat-x", "gpt-7-sol")).toBeNull();
    expect(getModelTargetFormat("openrouter", "gpt-7-sol")).toBeNull();
  });
});
