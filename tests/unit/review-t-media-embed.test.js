import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admit: vi.fn(), kind: vi.fn(), credentials: vi.fn(), unavailable: vi.fn(),
}));
vi.mock("@/sse/services/admission.js", () => ({ admit: state.admit }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: state.credentials,
  markAccountUnavailable: state.unavailable,
}));
vi.mock("@/sse/handlers/modelKind.js", () => ({ modelKindError: state.kind }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: vi.fn(async (value) => {
  const [provider, ...rest] = value.split("/");
  return { provider, model: rest.join("/") };
}) }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null) }));

const pipeline = await import("@/sse/handlers/media/pipeline.js");

describe("shared media pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.admit.mockResolvedValue({ settings: {}, apiKey: null, auth: {}, error: null });
    state.kind.mockResolvedValue(null);
    state.unavailable.mockResolvedValue({ shouldFallback: false });
  });

  it("admits media endpoints and returns missing-key errors before routing", async () => {
    const expected = Response.json({ error: "missing" }, { status: 401 });
    state.admit.mockResolvedValueOnce({ error: expected });
    const route = vi.fn();
    expect(await pipeline.runMediaEndpoint(new Request("http://localhost"), { kind: "embedding", route })).toBe(expected);
    expect(route).not.toHaveBeenCalled();
  });

  it("rejects models of the wrong media kind before account selection", async () => {
    state.kind.mockResolvedValueOnce(Response.json({ error: "wrong kind" }, { status: 400 }));
    const result = await pipeline.resolveTypedMediaModel(
      new Request("http://localhost"), "provider/model", {}, null, "embedding",
    );
    expect(result.error.status).toBe(400);
    expect(state.kind).toHaveBeenCalledWith("provider", "model", {} , "embedding");
  });

  it("retries the next account after a fallback eligible failure", async () => {
    state.credentials
      .mockResolvedValueOnce({ connectionId: "first", apiKey: "one" })
      .mockResolvedValueOnce(null);
    state.unavailable.mockResolvedValueOnce({ shouldFallback: true });
    const attempt = vi.fn().mockResolvedValue({ result: { status: 503, error: "down" }, dispatch: {} });
    const response = Response.json({ error: "exhausted" }, { status: 503 });
    const actual = await pipeline.runMediaAccounts({
      provider: "provider", model: "model", runAttempt: attempt,
      buildExhaustedResponse: () => response,
    });
    expect(actual).toBe(response);
    expect(attempt).toHaveBeenCalledOnce();
    expect(state.unavailable).toHaveBeenCalledWith("first", 503, "down", "provider", "model", null, expect.objectContaining({ usedCredential: "one" }));
  });
});
