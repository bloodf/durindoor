// Smoke tests for the new OpenAI/Anthropic parity handler cores.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  deriveImageEditsUrl,
  handleImageEditCore,
} from "../../open-sse/handlers/imageEditCore.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { handleMusicGenerationCore } from "../../open-sse/handlers/musicGenerationCore.js";

import {
  deriveModerationsUrl,
  handleModerationsCore,
} from "../../open-sse/handlers/moderationsCore.js";
import {
  deriveRerankUrl,
  handleRerankCore,
} from "../../open-sse/handlers/rerankCore.js";
import {
  deriveCountTokensUrl,
  estimateTokens,
  handleCountTokensCore,
} from "../../open-sse/handlers/countTokensCore.js";

describe("imageEditCore", () => {
  it("deriveImageEditsUrl maps /generations to /edits", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://api.openai.com/v1/images/generations" }))
      .toBe("https://api.openai.com/v1/images/edits");
  });

  it("deriveImageEditsUrl returns null for non-generations URL", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://example.com/v1/images/variations" })).toBeNull();
  });

  it("sends xAI image edits as documented JSON sources", async () => {
    const fixture = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const accepted = body.model === "grok-imagine-image-2.0" && body.prompt === "edit it" && Array.isArray(body.images) && body.images.length === 2 && body.images[0]?.url === "https://example.com/a.png" && body.images[1]?.file_id === "file_123" && !body.image;
      return new Response(JSON.stringify({ data: [] }), { status: accepted ? 200 : 400, headers: { "Content-Type": "application/json" } });
    });
    const restoreFetch = __setOriginalFetchForTesting(fixture);
    try {
      const formData = new FormData();
      formData.append("model", "xai/grok-imagine-image-2.0");
      formData.append("prompt", "edit it");
      formData.append("image", "json-image");
      const result = await handleImageEditCore({ formData, jsonBody: { model: "xai/grok-imagine-image-2.0", prompt: "edit it", images: ["https://example.com/a.png", { file_id: "file_123" }], n: 2, response_format: "url", quality: "high", resolution: "2k", aspect_ratio: "16:9" }, modelInfo: { provider: "xai", model: "grok-imagine-image-2.0" }, credentials: { apiKey: "key", providerSpecificData: { vercelRelayUrl: "https://relay.test/forward", disableEnvProxy: true } } });
      expect(result.success).toBe(true);
      const [url, init] = fixture.mock.calls[0];
      expect(url).toBe("https://relay.test/forward");
      expect(init.headers.get("x-relay-target")).toBe("https://api.x.ai");
      expect(JSON.parse(init.body)).toEqual({ model: "grok-imagine-image-2.0", prompt: "edit it", images: [{ url: "https://example.com/a.png" }, { file_id: "file_123" }], n: 2, response_format: "url", quality: "high", resolution: "2k", aspect_ratio: "16:9" });
    } finally {
      restoreFetch();
    }
  });

  it("rejects xAI raw source arrays", async () => {
    const formData = new FormData();
    formData.append("model", "xai/grok-imagine-image-2.0");
    formData.append("prompt", "edit it");
    formData.append("image", "json-image");
    const result = await handleImageEditCore({ formData, jsonBody: { model: "xai/grok-imagine-image-2.0", prompt: "edit it", image: ["https://example.com/a.png"] }, modelInfo: { provider: "xai", model: "grok-imagine-image-2.0" }, credentials: { apiKey: "key" } });
    expect(result.status).toBe(400);
  });
});

describe("MiniMax music core", () => {
  it("normalizes official hex audio", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio: "0001" }, base_resp: { status_code: 0 } })));
    const result = await handleMusicGenerationCore({ provider: "minimax", model: "music-3.0", body: { prompt: "song" }, credentials: { apiKey: "key" } });
    expect(await result.response.json()).toMatchObject({ data: [{ b64_json: "AAE=" }] });
    global.fetch = originalFetch;
  });
});

describe("moderationsCore", () => {
  it("deriveModerationsUrl maps /chat/completions to /moderations", () => {
    expect(deriveModerationsUrl("https://api.openai.com/v1/chat/completions"))
      .toBe("https://api.openai.com/v1/moderations");
  });

  it("deriveModerationsUrl handles /openai segment", () => {
    expect(deriveModerationsUrl("https://api.deepinfra.com/v1/openai/chat/completions"))
      .toBe("https://api.deepinfra.com/v1/openai/moderations");
  });
});

describe("rerankCore", () => {
  it("deriveRerankUrl maps chat completions base to /rerank", () => {
    expect(deriveRerankUrl({ baseUrl: "https://api.cohere.com/v1/chat/completions" }, {}))
      .toBe("https://api.cohere.com/v1/rerank");
  });

  it("deriveRerankUrl maps embeddings base to /rerank", () => {
    expect(deriveRerankUrl(null, { embeddingConfig: { baseUrl: "https://api.voyageai.com/v1/embeddings" } }))
      .toBe("https://api.voyageai.com/v1/rerank");
  });

  it("deriveRerankUrl returns null when no endpoint derivable", () => {
    expect(deriveRerankUrl(null, {})).toBeNull();
  });
});

describe("countTokensCore", () => {
  it("deriveCountTokensUrl maps Claude /messages to /messages/count_tokens", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.anthropic.com/v1/messages", format: "claude" }))
      .toBe("https://api.anthropic.com/v1/messages/count_tokens");
  });

  it("deriveCountTokensUrl returns null for non-Claude provider", () => {
    expect(deriveCountTokensUrl({ baseUrl: "https://api.openai.com/v1/chat/completions", format: "openai" }))
      .toBeNull();
  });

  it("estimateTokens approximates from string content", () => {
    const body = { messages: [{ role: "user", content: "abcd" }] };
    expect(estimateTokens(body)).toBe(1);
  });

  it("estimateTokens sums text array parts", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "abcdefgh" }] }] };
    expect(estimateTokens(body)).toBe(2);
  });

  it("estimateTokens returns at least 1 for empty body", () => {
    expect(estimateTokens({})).toBe(1);
  });
});
