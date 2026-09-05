import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest, openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";

/**
 * Guards fix for issue #2311:
 * The OpenAI Responses API → Chat Completions translator was forwarding
 * `client_metadata` (and other Responses-API-only fields) to upstream
 * providers. NVIDIA NIM rejects such fields with:
 *   "Validation: Unsupported parameter(s): `client_metadata`" (400)
 *
 * Fix: delete client_metadata, background, and truncation in the cleanup
 * phase of openaiResponsesToOpenAIRequest.
 */
describe("openaiResponsesToOpenAIRequest — strips Responses-API-only fields", () => {
  const baseBody = {
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    model: "gpt-4o",
    client_metadata: { caller: "codex-cli", version: "0.5.15" },
    background: false,
    truncation: "auto",
    store: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: "abc123",
  };

  it("strips client_metadata from the forwarded body", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("client_metadata");
  });

  it("strips background from the forwarded body", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("background");
  });

  it("strips truncation from the forwarded body", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("truncation");
  });

  it("preserves the already-handled fields except input, store, and include", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("input");
    expect(result).not.toHaveProperty("store");
    expect(result).not.toHaveProperty("include");
    expect(result).toHaveProperty("prompt_cache_key", "abc123");
  });

  it("preserves the converted messages content", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.some(m => m.role === "user")).toBe(true);
  });

  it("does not strip unrelated fields like temperature or max_tokens", () => {
    const bodyWithExtra = {
      ...baseBody,
      temperature: 0.7,
      max_tokens: 512,
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", bodyWithExtra, false, {});
    // temperature and max_tokens are passed through (not Responses-API-only)
    // We can't assert they ARE present since the translator may not copy them,
    // but we assert they are not erroneously deleted when they exist.
    if ("temperature" in bodyWithExtra) {
      expect(result.temperature).toBe(0.7);
    }
  });
});

describe("convertResponsesApiFormat — prompt cache key", () => {
  it("preserves a supplied prompt cache key during Responses endpoint lowering", () => {
    const result = convertResponsesApiFormat({
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      prompt_cache_key: "stable-cache-key",
    });

    expect(result.prompt_cache_key).toBe("stable-cache-key");
  });
});

describe("openaiToOpenAIResponsesRequest — prompt cache key", () => {
  it("preserves a supplied prompt cache key", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-4o", {
      messages: [{ role: "user", content: "hi" }],
      prompt_cache_key: "stable-cache-key",
    }, false, {});

    expect(result.prompt_cache_key).toBe("stable-cache-key");
  });

  it("omits prompt cache key when the client did not supply one", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-4o", {
      messages: [{ role: "user", content: "hi" }],
    }, false, {});

    expect(result).not.toHaveProperty("prompt_cache_key");
  });
});
