import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admit: vi.fn(), kind: vi.fn(), credentials: vi.fn(), unavailable: vi.fn(),
  embeddingCore: vi.fn(), rerankCore: vi.fn(), moderationCore: vi.fn(),
}));
vi.mock("@/sse/services/admission.js", () => ({ admit: state.admit }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: state.credentials,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: state.unavailable,
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/handlers/modelKind.js", () => ({ modelKindError: state.kind }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: vi.fn(async (value) => {
  const [provider, ...rest] = value.split("/");
  return { provider, model: rest.join("/") };
}) }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: state.embeddingCore }));
vi.mock("open-sse/handlers/rerankCore.js", () => ({ handleRerankCore: state.rerankCore }));
vi.mock("open-sse/handlers/moderationsCore.js", () => ({ handleModerationsCore: state.moderationCore }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
vi.mock("open-sse/services/modelFallback.js", () => ({ runWithModelFallback: (_model, _fallbacks, run) => run(_model) }));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_provider, credentials) => credentials, updateProviderCredentials: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({ request: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

const { handleEmbeddings } = await import("@/sse/handlers/embeddings.js");
const { handleRerank } = await import("@/sse/handlers/rerank.js");
const { handleModerations } = await import("@/sse/handlers/moderations.js");
const jsonRequest = (url, body) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("shared media pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.admit.mockResolvedValue({ settings: {}, apiKey: null, auth: {}, error: null });
    state.credentials.mockReset();
    state.kind.mockResolvedValue(null);
    state.unavailable.mockResolvedValue({ shouldFallback: false });
  });

  it.each([
    ["embeddings", handleEmbeddings, "/v1/embeddings", { model: "provider/model", input: "text" }],
    ["rerank", handleRerank, "/v1/rerank", { model: "provider/model", query: "text", documents: ["text"] }],
    ["moderations", handleModerations, "/v1/moderations", { model: "provider/model", input: "text" }],
  ])("%s handler returns admission failures before routing", async (_kind, handler, url, body) => {
    const expected = Response.json({ error: "missing" }, { status: 401 });
    state.admit.mockResolvedValueOnce({ error: expected });
    expect((await handler(jsonRequest(url, body))).status).toBe(401);
    expect(state.credentials).not.toHaveBeenCalled();
  });

  it("rejects an embedding of the wrong kind before account selection", async () => {
    state.kind.mockResolvedValueOnce(Response.json({ error: "wrong kind" }, { status: 400 }));
    const response = await handleEmbeddings(jsonRequest("/v1/embeddings", { model: "provider/model", input: "text" }));
    expect(response.status).toBe(400);
    expect(state.kind).toHaveBeenCalledWith("provider", "model", {} , "embedding");
    expect(state.credentials).not.toHaveBeenCalled();
  });

  it("rerank handler falls back after an account failure", async () => {
    state.credentials
      .mockResolvedValueOnce({ connectionId: "first", apiKey: "one" })
      .mockResolvedValueOnce(null);
    state.unavailable.mockResolvedValueOnce({ shouldFallback: true });
    state.rerankCore.mockResolvedValueOnce({ success: false, status: 503, error: "down", response: Response.json({ error: "down" }, { status: 503 }) });
    const response = await handleRerank(jsonRequest("/v1/rerank", { model: "provider/model", query: "text", documents: ["text"] }));
    expect(response.status).toBe(503);
    expect(state.credentials).toHaveBeenCalledTimes(2);
    expect(state.credentials).toHaveBeenNthCalledWith(2, "provider", new Set(["first"]), "model", expect.any(Object));
    expect(state.rerankCore).toHaveBeenCalledOnce();
    expect(state.unavailable).toHaveBeenCalledWith("first", 503, "down", "provider", "model", null, expect.objectContaining({ usedCredential: "one" }));
  });
});
