import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
  hasSpecializedExecutor: vi.fn(() => false),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
}));

import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";

function makeProviderResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOptions(overrides = {}) {
  return {
    body: { model: "nomic-embed-text", input: "Hello world" },
    modelInfo: { provider: "ollama-local", model: "nomic-embed-text" },
    credentials: { providerSpecificData: { baseUrl: "http://localhost:11434" } },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onCredentialsRefreshed: vi.fn(),
    onRequestSuccess: vi.fn(),
    ...overrides,
  };
}

describe("ollama-local embeddings adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/embed with no auth header and normalizes response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProviderResponse({
        model: "nomic-embed-text",
        embeddings: [[0.1, 0.2, 0.3]],
        prompt_eval_count: 42,
      })
    );

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    const body = await result.response.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      object: "embedding",
      index: 0,
      embedding: [0.1, 0.2, 0.3],
    });
    expect(body.model).toBe("nomic-embed-text");
    expect(body.usage).toMatchObject({ prompt_tokens: 42, total_tokens: 42 });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/embed");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBeUndefined();
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({ model: "nomic-embed-text", input: "Hello world" });
  });

  it("forwards dimensions when supplied", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProviderResponse({
        model: "nomic-embed-text",
        embeddings: [[0.1]],
      })
    );

    await handleEmbeddingsCore(
      makeOptions({ body: { model: "nomic-embed-text", input: "a", dimensions: 256 } })
    );

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.dimensions).toBe(256);
  });

  it("uses the configured baseUrl from credentials", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProviderResponse({ model: "all-minilm", embeddings: [[0.4, 0.5]] })
    );

    await handleEmbeddingsCore(
      makeOptions({
        credentials: { providerSpecificData: { baseUrl: "http://ollama.test:11434/api/chat" } },
      })
    );

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://ollama.test:11434/api/embed");
  });

  it("forwards array input unchanged", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProviderResponse({
        model: "nomic-embed-text",
        embeddings: [[0.1], [0.2]],
      })
    );

    await handleEmbeddingsCore(
      makeOptions({ body: { model: "nomic-embed-text", input: ["a", "b"] } })
    );

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.input).toEqual(["a", "b"]);
  });

  it("returns provider error when Ollama rejects the request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProviderResponse({ error: "model not found" }, 400)
    );

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });
});
