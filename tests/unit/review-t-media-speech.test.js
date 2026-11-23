import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), mark: vi.fn(), ttsCore: vi.fn(), sttCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true }),
  getApiKeyByKey: async () => null,
  getComboForModel: async () => null,
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async (request) => request.headers.has("authorization")
    ? { apiKey: "client-key", auth: { ok: true, apiKeyId: "key-id", billingEpoch: null } }
    : { apiKey: null, auth: { ok: false, reason: "missing" } },
  getProviderCredentialsWithQuotaPreflight: mocks.select,
  getNoAuthProviderCredentials: mocks.select,
  markAccountUnavailable: mocks.mark,
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (id) => ({ provider: "openai", model: id.split("/").at(-1) }),
  getComboModels: async () => null,
  getComboCanonicalName: async () => null,
}));
vi.mock("@/sse/handlers/modelKind.js", () => ({
  modelKindError: async (_provider, model) => model === "chat"
    ? Response.json({ error: { message: "Model cannot be used for speech" } }, { status: 400 }) : null,
}));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null,
  recordApiKeyUsageForResponse: async (_key, response) => response,
}));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({
  captureRequestBillingEpoch: async () => {}, getRequestId: () => "speech-test",
  withRequestCorrelation: (handler) => handler,
}));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: mocks.ttsCore }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.sttCore }));
vi.mock("open-sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false }));

const { handleTts } = await import("@/sse/handlers/tts.js");
const { handleStt } = await import("@/sse/handlers/stt.js");

function ttsRequest({ key = true, model = "openai/voice" } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("authorization", "Bearer client-key");
  return new Request("http://localhost/v1/audio/speech", {
    method: "POST", headers, body: JSON.stringify({ model, input: "hello" }),
  });
}

function sttRequest({ key = true, model = "openai/whisper-1" } = {}) {
  const headers = new Headers();
  if (key) headers.set("authorization", "Bearer client-key");
  const body = new FormData();
  body.append("model", model);
  body.append("file", new Blob(["audio"], { type: "audio/wav" }), "audio.wav");
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockImplementation(async (_provider, excluded, _model, options = {}) => ({
    connectionId: excluded?.size ? "account-2" : options.strictConnectionId || "account-1",
    apiKey: "provider-key",
  }));
  mocks.mark.mockResolvedValue({ shouldFallback: true });
  mocks.ttsCore.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
  mocks.sttCore.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
});

describe.each([
  ["TTS", handleTts, ttsRequest, mocks.ttsCore],
  ["STT", handleStt, sttRequest, mocks.sttCore],
])("%s shared media pipeline", (_name, handler, makeRequest, core) => {
  it("rejects a missing key before selecting credentials", async () => {
    expect((await handler(makeRequest({ key: false }))).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects a wrong-kind model before selecting credentials", async () => {
    expect((await handler(makeRequest({ model: "openai/chat" }))).status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("falls back to another account through the shared account loop", async () => {
    core.mockResolvedValueOnce({ success: false, status: 401, error: "expired" });
    const response = await handler(makeRequest());
    expect(response.status).toBe(200);
    expect(core).toHaveBeenCalledTimes(2);
    expect(mocks.mark).toHaveBeenCalledOnce();
    expect(mocks.mark.mock.calls[0].slice(0, 5)).toEqual(["account-1", 401, "expired", "openai", expect.any(String)]);
  });
});
