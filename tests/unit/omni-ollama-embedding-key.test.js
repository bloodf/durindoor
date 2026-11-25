import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ refreshCredentials: vi.fn().mockResolvedValue(null) })),
  hasSpecializedExecutor: vi.fn(() => false),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn().mockResolvedValue(null),
}));

import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";

describe("Ollama Local embedding authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [{ apiKey: "synthetic-ollama-key" }, "Bearer synthetic-ollama-key"],
    [{}, undefined],
  ])("sends the expected authorization header for supplied credentials", async (credentials, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ model: "nomic-embed-text", embeddings: [[0.1]] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleEmbeddingsCore({
      body: { model: "nomic-embed-text", input: "hello" },
      modelInfo: { provider: "ollama-local", model: "nomic-embed-text" },
      credentials: { ...credentials, providerSpecificData: { baseUrl: "http://ollama.test:11434" } },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://ollama.test:11434/api/embed");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(expected);
  });
});
